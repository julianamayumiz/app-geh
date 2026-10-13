# Relatório — Teste de carga App GEH

**Última atualização:** 2026-10-13 (rodadas 1-2 de 2026-04-16 + projeção para evento de 300 pessoas)
**Ambiente dos testes:** projeto Firebase `app-geh-dev` (isolado de produção)
**Ferramenta:** [run.js](run.js) + [seed.js](seed.js) (Node, SDK `firebase` v10; recriados em 2026-10-13 pro PDV e o evento de 300 pessoas)
**Responsável:** Juliana (diretoria GEH)

> Seções 1-3 são o teste original (abril, 15 produtos, 50 clientes, telas antigas
> `vender.html` / `carregar.html`). Seções 4-8 reavaliam o app para o evento
> grande: **31 produtos, ~300 pessoas, estoque de R$ 65 mil**, já com o PDV de
> página única.

---

## 1. Objetivo

Validar se o app aguenta o cenário real de um evento escoteiro com múltiplos operadores vendendo e recarregando saldo ao mesmo tempo, sem:

- Perda de integridade (saldo ou estoque ficando inconsistente)
- Falhas em massa
- Latência inviável pra fila de atendimento

---

## 2. Metodologia (teste de abril)

- **Seed de dados fake** via [seed.html](../seed.html): 1 evento ativo, 15 produtos, 50 clientes (GEH001–GEH050) com saldos entre R$0 e R$500.
- **Script simula operadores** executando as **mesmas transações** do app real (`runTransaction` de venda e de recarga).
- **Mix de operações:** 70% vender · 20% carregar · 10% consultar saldo.
- **Jitter humano:** 50–250 ms entre operações do mesmo operador.
- **Check de integridade:** Δ total de saldos precisa bater com (carregado − vendido).

---

## 3. Resultados (abril)

| métrica | 30 VUs | 50 VUs |
|---|---:|---:|
| operações | 600 | 1 000 |
| throughput | 37,5 ops/s | 41,0 ops/s |
| p50 vender | 170 ms | 308 ms |
| p95 vender | 3 117 ms | 4 381 ms |
| erros genuínos (contenção) | 1 (0,2 %) | 5 (0,7 %) |
| integridade (Δ saldos) | R$0,00 ✅ | R$0,00 ✅ |

Os ~30 % de erro restantes eram regra de negócio (`saldo_insuf`, `estoque_insuf`) — esperado, bots vendem aleatório até acabar saldo/estoque.

Conclusões que continuam valendo:

- Transações do Firestore seguram concorrência; saldo bateu em centavos nas 1 600 ops.
- O teto de throughput (~40 ops/s) é do Firestore sob contenção artificial, não do cliente.
- Contenção só aparece quando bots batem no mesmo produto em milissegundos; operador humano leva ≥10 s por venda.

---

## 4. Perfil do evento grande

Cardápio levantado com a diretoria (planilha de estoque/preço):

| grupo | itens | unidades | valor em estoque |
|---|---:|---:|---:|
| Salgados / comida | 12 | 2 340 | R$ 40.988 |
| Doces / bebidas especiais | 8 | 1 470 | R$ 18.900 |
| Bebidas | 11 | 508 | R$ 5.160 |
| **Total** | **31** | **4 318** | **R$ 65.048** |

Conferido item a item: as somas de cada bloco batem com a planilha.

Comparado ao teste de abril: **2× produtos, 6× clientes, ~100× em valor**.

### 4.1. Produtos "quentes" (maior estoque = mais vendas no mesmo documento)

| produto | estoque | observação |
|---|---:|---|
| Choux Cream | 700 | maior volume do evento, R$ 12 |
| Potato Mochi | 400 | R$ 7, ticket baixo, compra por impulso |
| Ika | 300 | R$ 30, maior preço unitário da comida |
| Carne / Dorayaki / Dango / Hiyashi | 150-200 | volume médio |

Cada venda de um produto = 1 escrita no documento dele. Os 3 primeiros concentram ~1 400 das 4 318 unidades (~32 %).

### 4.2. Premissas da projeção (ajustar se a diretoria souber melhor)

| premissa | valor | porquê |
|---|---|---|
| duração das vendas | 4 h | confirmado: 11h30 às 15h30 |
| itens por venda | 2,5 | carrinho de comida + bebida |
| vendas totais (estoque 100 % vendido) | ~1 730 | 4 318 ÷ 2,5 — **teto**, nem tudo vende |
| recargas | ~600 | 300 pessoas × 2 recargas |
| pico vs média | 3× | fila na abertura e no intervalo |
| operadores / caixas simultâneos | 8 + 4 | a confirmar |

Observação: R$ 65 mil ÷ 300 pessoas = **R$ 217 por pessoa** se tudo vender. O
estoque é capacidade máxima, não previsão de consumo. Vale a diretoria
confirmar a expectativa real de gasto/pessoa (se for ~R$ 80, a carga cai ~60 %).

---

## 5. Análise de capacidade

### 5.1. Vazão: sobra de ~100×

| | ops/s |
|---|---:|
| média (1 730 vendas + 600 recargas em 4 h) | 0,16 |
| **pico (3×)** | **0,49** |
| medido no teste de abril | 37-41 |

Mesmo com premissas pessimistas (estoque 100 % vendido em 3 h, pico 5×) o
evento fica em ~1 ops/s: **40× abaixo** do que o teste já provou aguentar.

### 5.2. Contenção em produto quente

Firestore recomenda ≤ ~1 escrita/s sustentada por documento. No pior caso,
Choux Cream (700 un., ~280 vendas se 2,5 un/venda) em 4 h = 1 venda a cada
~51 s; no pico 3× = 1 venda a cada ~17 s. Para dois operadores colidirem é
preciso duas finalizações na mesma janela de ~300 ms: probabilidade na casa de
**1 em 70 mil**. Contenção não é risco real. Shards de estoque continuam
desnecessários.

### 5.3. Integridade

Mudou desde abril, para melhor: a transação de venda em
[js/views/venda.js:652](../../js/views/venda.js:652) agora tem **ID de venda
idempotente** (se a rede cai e o operador reenvia, não cobra duas vezes),
**trava de preço** (promoção mudou no meio do carrinho → não cobra) e checagem
de saldo/estoque dentro da transação. Recarga e transferência seguem o mesmo
padrão. Nada disso depende de volume.

### 5.4. ⚠️ Ponto de atenção real: cota de leituras do Firestore

**Esta é a única coisa que o evento grande realmente ameaça.** O teste de
abril não media leituras. O plano grátis (Spark) dá **50 mil leituras/dia e
20 mil escritas/dia**, e a auditoria de 2026-09-16 já mostrava o projeto em
~49 mil leituras/dia num dia comum.

O PDV recarrega a lista inteira de produtos a cada venda
([js/views/venda.js:30](../../js/views/venda.js:30), `getDocs(collection(db,'produtos'))`,
chamado a cada abertura da view em [venda.js:764](../../js/views/venda.js:764)
por decisão consciente: a página não recarrega e o estoque precisa estar fresco).

| item | abril (15 produtos) | evento (31 produtos) |
|---|---:|---:|
| leituras da lista de produtos por venda | 15 | **31** |
| leituras da transação (cliente + venda + ~1,8 produto) | ~4 | ~4 |
| leituras da consulta de saldo / histórico (até 30 + 30) | até ~60 | até ~60 |
| **leituras por venda (sem consulta)** | ~19 | **~35** |

Projeção para 1 730 vendas: **~60 mil leituras só nas vendas**, mais consulta
de saldo, dashboard admin (`onSnapshot` em vendas/movimentações) e recargas.
**Passa de 50 mil/dia no plano grátis** e, depois da cota, o Firestore
**recusa as operações** — em pleno evento.

Escritas: venda = cliente + venda + ~1,8 produtos ≈ 3,8; recarga = 2.
1 730 × 3,8 + 600 × 2 ≈ **7,8 mil** — confortável abaixo de 20 mil.

**Mitigação, em ordem de custo/benefício:**

1. **Migrar o projeto de produção pro plano Blaze (pay-as-you-go)** com
   alerta de orçamento em ~US$ 5. É a mais simples e elimina o risco de
   bloqueio: 100 mil leituras extras custam centavos de dólar (~US$ 0,06 por
   100 mil). O evento inteiro ficaria na casa de poucos centavos a poucos reais.
2. **Reduzir a releitura de produtos por venda**: só buscar do servidor se o
   cache tiver > 30-60 s, ou ler só os produtos do carrinho (a transação já
   revalida estoque e preço de qualquer jeito, então o risco de cache velho é
   só mostrar estoque desatualizado na grade). Corta ~30 leituras/venda →
   total do evento cai para ~15 mil.
3. Fazer a P1.3 da auditoria (coleção `clientes` inteira em `admin/clientes`
   e `caixa/transferir`): com 300 clientes cada abertura custa 300 leituras.

Recomendação: **fazer o item 1 antes do evento** (não envolve código) e o 2 se
quiser folga. Qualquer um dos dois resolve; o 1 sozinho é suficiente.

---

## 6. Recomendações

### Antes do evento (prioridade alta)
1. **Plano Blaze + alerta de orçamento** no projeto de produção (seção 5.4).
2. **Teste de carga com o volume real** (seção 7) no `app-geh-dev`, medindo
   leituras no console do Firebase (Usage) além de latência.
3. **Conferir o estoque cadastrado** no sistema contra a planilha (31 itens,
   4 318 un.) — erro de digitação em estoque vira `estoque_insuf` no balcão.

### Opcional
4. Reduzir releitura de produtos por venda (seção 5.4, item 2).
5. Shards de estoque por produto — **não necessário** (seção 5.2).

### Não fazer
6. Não migrar pra outro banco ou framework — Firestore provou aguentar.
7. Não adicionar camadas de cache ou fila além do ajuste de leitura acima.

### Já resolvido desde abril
- ~~Humanizar mensagem de erro de contenção~~ — feito: contenção
  (`failed-precondition` / `aborted`) agora avisa que a venda não foi cobrada
  ([venda.js:729](../../js/views/venda.js:729)).
- ~~Rules de prod no dev~~ — rules migraram para custom claims e têm suíte de
  testes (`dev-tools/rules-tests`, `npm test`).

---

## 7. Plano de nova rodada (evento de 300 pessoas)

Cenário a executar no `app-geh-dev`:

| parâmetro | valor |
|---|---|
| seed | 31 produtos (planilha acima), **300 clientes** (GEH001–GEH300), saldos R$ 50-300 |
| operadores simultâneos | 12 VUs (8 vender + 4 recarga) — e uma rodada de estresse com 50 |
| duração | 30 min sintéticos com jitter humano de 8-20 s (realista) |
| mix | 70 % vender · 20 % carregar · 10 % consultar |
| carrinho | 1-4 itens, ponderado pelo estoque (Choux/Mochi/Ika mais frequentes) |
| medir | latência p50/p95, erros genuínos, integridade, **leituras/escritas no console Firebase** |

Critérios de aprovação:

- Integridade: Δ saldos = R$ 0,00
- Erros genuínos (contenção) < 0,5 %
- p95 vender < 2 s na carga realista
- Leituras extrapoladas para o evento completo < 50 mil (ou projeto em Blaze)

---

## 8. Pendências

- [x] Plano Blaze ativado na produção (confirmar que o alerta de orçamento existe)
- [ ] Confirmar com a diretoria: expectativa de gasto por pessoa e nº de operadores/caixas (duração já confirmada: 11h30-15h30)
- [x] Script de carga recriado em `run.js` + `seed.js` (espelham as transacoes do PDV, imitam o cache de 60 s e conferem saldo, estoque e contagem de docs). Uso no cabecalho do `run.js`; so roda em `app-geh-dev`
- [ ] Rodar a rodada 7 e anexar resultados aqui
- [x] Reduzir `getDocs(produtos)` por venda: cache de 60 s em `venda.js` (`PRODUTOS_TTL_MS`); falha na venda forca releitura. Cai de ~35 para ~5 leituras por venda no uso normal
- [ ] Opcional: rodar com 80 VUs só pra achar o ponto de ruptura
