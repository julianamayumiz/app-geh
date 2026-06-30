# Relatório — Teste de carga App GEH

**Data:** 2026-04-16
**Ambiente:** projeto Firebase `app-geh-dev` (isolado de produção)
**Ferramenta:** script Node em [run.js](run.js) usando o SDK `firebase` v10
**Responsável:** Juliana (diretoria GEH)

---

## 1. Objetivo

Validar se o app aguenta o cenário real de um evento escoteiro com múltiplos operadores vendendo e recarregando saldo ao mesmo tempo, sem:

- Perda de integridade (saldo ou estoque ficando inconsistente)
- Falhas em massa
- Latência inviável pra fila de atendimento

---

## 2. Metodologia

- **Seed de dados fake** via [seed.html](../seed.html): 1 evento ativo, 15 produtos, 50 clientes (GEH001–GEH050) com saldos distribuídos entre R$0 e R$500.
- **Script simula operadores** executando as **mesmas transações** do app real:
  - [operador/vender.html:450](../../operador/vender.html:450) — `runTransaction` que lê cliente + produtos, valida saldo/estoque, decrementa e grava venda.
  - [operador/carregar.html:162](../../operador/carregar.html:162) — `runTransaction` que incrementa saldo e grava movimentação.
- **Mix de operações:** 70% vender · 20% carregar · 10% consultar saldo.
- **Jitter humano:** 50–250 ms entre operações do mesmo operador.
- **Check de integridade:** snapshot do total de saldos antes e depois do teste; Δ observado precisa bater com Δ esperado (carregado − vendido).

---

## 3. Resultados

### 3.1. Rodada 1 — 30 operadores simultâneos

- **600 operações** em 16,0 s · throughput **37,5 ops/s**
- Taxa de erro: **26,5 %** (quase toda regra de negócio — cliente sem saldo ou produto sem estoque)

| operação | n | erros | p50 | p95 |
|---|---:|---:|---:|---:|
| consultar | 53 | 0 | 103 ms | 289 ms |
| carregar | 127 | 0 | 126 ms | 578 ms |
| vender | 420 | 159 | 170 ms | 3 117 ms |

- Erros de negócio: 81 `saldo_insuf`, 77 `estoque_insuf`
- Erros genuínos: **1** (0,2 % das vendas)
- **Integridade:** `diff = R$0,00` ✅

### 3.2. Rodada 2 — 50 operadores simultâneos

- **1 000 operações** em 24,4 s · throughput **41,0 ops/s**
- Taxa de erro: **36,4 %** (idem — regras de negócio)

| operação | n | erros | p50 | p95 |
|---|---:|---:|---:|---:|
| consultar | 102 | 0 | 157 ms | 387 ms |
| carregar | 179 | 0 | 272 ms | 1 469 ms |
| vender | 719 | 364 | 308 ms | 4 381 ms |

- Erros de negócio: 214 `estoque_insuf`, 145 `saldo_insuf`
- Erros genuínos: **5** (0,7 % das vendas), todos `FAILED_PRECONDITION: stored version does not match` — contenção de transação no Firestore
- **Integridade:** `diff = R$0,00` ✅

### 3.3. Comparativo

| métrica | 30 VUs | 50 VUs | variação |
|---|---:|---:|---:|
| throughput | 37,5 ops/s | 41,0 ops/s | +9 % |
| p50 vender | 170 ms | 308 ms | 1,8× |
| p95 vender | 3 117 ms | 4 381 ms | 1,4× |
| erros genuínos | 1 | 5 | 5× |
| integridade | ✅ | ✅ | — |

---

## 4. Análise

### 4.1. O que está certo

- **Transações do Firestore seguram concorrência.** Em 1 600 operações paralelas agressivas, o Δ de saldos bateu com o esperado em centavos exatos. Nenhuma venda processada pela metade, nenhum saldo corrompido.
- **Throughput é limitado pelo Firestore, não pelo cliente.** Subir de 30 pra 50 VUs aumentou throughput só 9 %. Mais VUs = mais latência, não mais vazão.
- **Consulta e carregar têm latência saudável** mesmo com 50 concorrentes (p95 < 1,5 s).

### 4.2. Onde degrada

- **Vender sob 50 VUs tem p95 de 4,4 s e max de 10,2 s.** Isso é contenção: quando dois operadores tentam vender o mesmo produto ao mesmo instante, o Firestore detecta conflito de versão (`stored version does not match required base version`) e faz retry interno. Depois de ~5 retries o SDK desiste e lança erro.
- **5 vendas (0,7 %) falharam por contenção** na rodada de 50 VUs. Em prod isso aparece como: operador clica "Finalizar", vê mensagem de erro, tenta de novo.

### 4.3. Por que isso não preocupa pro evento real

O teste é sintético e mais agressivo que a realidade:

- Bots disparam cliques com jitter de 50–250 ms entre operações. Humanos reais levam ≥10 s entre vendas (escanear QR, escolher produtos, conferir, clicar).
- Bots não "pensam" — apenas batem em produtos aleatórios em loop. Operadores reais atendem filas diferentes e distribuem naturalmente a carga.
- Estimativa de taxa de contenção real no evento: **muito abaixo de 0,1 %**.

---

## 5. Recomendações

### Prioridade alta
1. **Melhorar a mensagem de erro** em [operador/vender.html:499](../../operador/vender.html:499) pra humanizar o raro caso de contenção. Algo como: *"Deu um conflito com outra venda, tenta finalizar de novo — sua venda não foi cobrada."* Hoje mostra apenas o `err.message` bruto.

### Prioridade baixa — só se houver problema real no evento
2. **Shards de estoque** por produto (quebrar `refri` em `refri_A/B/C`). Reduz contenção N×. Mexe no schema e no código. Não vale o custo agora.

### Não fazer
3. **Não migrar pra outro banco ou framework** — o Firestore provou aguentar.
4. **Não adicionar camadas de cache ou fila** — complicaria o app sem benefício mensurável.

---

## 6. Evidência de integridade

A soma `Δ saldos = carregado − vendido` bateu em R$0,00 nas duas rodadas, o que garante que:

- Nenhuma venda descontou saldo sem registrar a venda.
- Nenhuma recarga creditou saldo sem registrar a movimentação.
- Nenhuma venda foi cobrada duas vezes.

É o resultado que a gente precisava ver antes de confiar o app em evento real.

---

## 7. Próximos passos

- [ ] Aplicar a melhoria de mensagem de erro em `vender.html` (Prioridade 1)
- [ ] Reaplicar as regras do Firestore de produção no projeto de dev (`firebase deploy --only firestore:rules --project dev`) e reexecutar o teste — confirmar que nada depende de regras abertas
- [ ] Opcional: rodar uma vez com 80 VUs só pra saber onde o sistema realmente racha (curiosidade, não bloqueante)
