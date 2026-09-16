# Convites por família — cadastro de convidados pelo próprio app

**Data:** 2026-09-16
**Status:** aprovado, pronto pra virar plano de implementação

## Problema

Hoje cada família do GEH recebe 5 convites por evento pra vender/distribuir. O
controle de quem foi convidado em cada número é feito numa planilha que a
família preenche por fora do app. Isso duplica trabalho (a diretoria depois
precisa importar essa planilha em "Convites antecipados") e é fonte de erro
(número duplicado, planilha desatualizada, arquivo perdido).

## Objetivo

Deixar a família preencher/editar diretamente pelo app quem é o convidado de
cada um dos convites dela, sem depender de planilha. A diretoria continua
enxergando tudo (visão consolidada, export CSV) e o fluxo de check-in da
recepção continua funcionando sem nenhuma mudança.

## Por que reaproveitar `convites_antecipados` em vez de criar algo paralelo

A coleção `convites_antecipados` já existe e já tem exatamente os campos que
essa feature precisa: `eventoId`, `familia`, `numero`, `nome`, `categoria`,
`pago`, `presente`, `checkInEm`. O fluxo de check-in da recepção
(`recepcao/conferencia.html`) já lê dessa coleção. Se a família preenche
`nome` aqui, a recepção já vê isso automaticamente — **zero mudança** no
fluxo de check-in existente. Criar uma coleção paralela duplicaria a lógica
de check-in e a exportação, contrariando a instrução de não duplicar
estruturas existentes.

## Modelo de dados

### Nova coleção `familias`

Cadastro permanente, reaproveitado entre eventos (como os `clientes`) — a
família não precisa ser recriada a cada evento novo.

```
familias/{familiaId}    // familiaId = o próprio código de acesso
  nome: string
  ativo: boolean         // false = bloqueia acesso ao portal, sem apagar histórico
  criadoEm: timestamp
```

`familiaId` **é** o código de acesso — uma string aleatória de alta entropia
(gerada com `crypto.randomUUID()` sem hífens, ou equivalente, ~20+
caracteres). Não é sequencial, não é baseado no nome, não é adivinhável.
Funciona como um "link de convite do Google Docs": quem tem o link, acessa.

### `convites_antecipados` ganha um campo

```
convites_antecipados/{doc}
  eventoId: string          // já existe
  familia: string           // já existe — nome da família (denormalizado, exibição)
  familiaId: string | null  // NOVO — aponta pro doc de familias/
  numero: string            // já existe
  nome: string               // já existe — vazio = convite ainda não preenchido
  categoria: string          // já existe
  pago: boolean               // já existe — sem relação com o preenchimento
  presente: boolean           // já existe — check-in, sem relação com o preenchimento
  checkInEm, checkInPor       // já existem
  criadoEm: timestamp         // já existe
```

Convites importados por planilha (fluxo admin já existente) continuam com
`familiaId: null` — só convites gerados pelo novo fluxo "gerar em branco pra
uma família" ganham o vínculo. Os dois tipos convivem na mesma coleção sem
conflito.

**Status "preenchido / não preenchido"**: não é um campo novo — deriva de
`nome` estar vazio ou não. Evita duplicar informação que já existe.

### Numeração

Sequencial único por evento (não em blocos fixos por família). Guardado como
contador em `eventos/{id}.proximoNumeroConvite` (number), incrementado
sempre que o admin gera convites em branco pra uma família. Garante número
único sem precisar coordenar faixas manualmente.

### Quantidade por família

Não existe campo "quantidade" na família — a quantidade real dela num
evento é simplesmente a contagem de docs `convites_antecipados` com aquele
`familiaId` + `eventoId`. O admin define um padrão (5) ao gerar os convites
em lote pro evento, e pode gerar convites avulsos extras pra uma família
específica depois (ex: Silva com 8 em vez de 5) sem afetar as outras —
cobre "padrão configurável + exceção pontual" sem campo de configuração
redundante que possa desincronizar da realidade.

## Segurança (Firestore rules)

Esse é o primeiro acesso **genuinamente não-autenticado** do sistema.
Operador/caixa/recepção hoje são "sem tela de login" mas ainda são contas
Firebase Auth pré-configuradas no dispositivo — não segregam por família.
Família não pode seguir esse modelo (não dá pra ter 1 conta por família).

**Modelo de confiança:** posse do `familiaId` (código de alta entropia) =
autorização. Mesmo padrão que `pendentes/{email}` já usa hoje no projeto.

```javascript
match /familias/{familiaId} {
  allow get: if true;                 // portal da família valida o código
  allow list: if isAdmin();           // impede enumerar famílias existentes
  allow create, update, delete: if isAdmin();
}

match /convites_antecipados/{doc} {
  allow read: if isRecepcao()
    || (resource.data.familiaId is string && resource.data.familiaId.size() >= 16);

  allow update: if isAdmin()
    || ( /* regra de check-in da recepção — já existe, sem mudança */ )
    || (
      resource.data.familiaId is string
      && resource.data.familiaId.size() >= 16
      && get(/databases/$(database)/documents/familias/$(resource.data.familiaId)).data.ativo == true
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['nome', 'categoria'])
      && request.resource.data.familiaId == resource.data.familiaId   // imutável — nunca migra de família
      && request.resource.data.nome is string
      && request.resource.data.nome.size() >= 2
      && request.resource.data.nome.size() <= 80
    );

  allow create, delete: if isAdmin();   // só admin gera/remove convites
}
```

Cobertura ponto a ponto dos riscos listados:

| Risco | Como é bloqueado |
|---|---|
| Ver convite de outra família | `read` só retorna docs pra quem já sabe o `familiaId` exato usado no `where()` da query |
| Alterar número/família de um convite | `affectedKeys().hasOnly(['nome','categoria'])` — qualquer outro campo é rejeitado, inclusive via chamada direta à API |
| **Transferir convite pra outra família** | **Não existe essa ação em lugar nenhum** (nem admin, nem portal). `familiaId` é travado — `request.resource.data.familiaId == resource.data.familiaId` bloqueia qualquer update que tente mudar o dono do convite |
| Criar convite arbitrário | `create` é admin-only, sem exceção |
| Família desativada continuar editando | `get()` no doc de `familias` exige `ativo == true` |
| Descobrir códigos de outras famílias | `familias.list` é admin-only — não dá pra enumerar |

## Telas

### `admin/familias.html` (nova — grupo "Cadastros" da sidebar)

- Lista de famílias: nome, botão "copiar link de acesso", ativo/inativo,
  contagem de convites (total / preenchidos) no evento ativo.
- "+ Nova família": nome → sistema gera o código sozinho.
- Ação "Gerar convites" por família: pede quantidade (pré-preenchida 5) →
  cria os convites em branco pro evento ativo, numerados em sequência via
  `eventos/{id}.proximoNumeroConvite`.
- Desativar em vez de excluir quando já tem convites vinculados (mesmo
  padrão do campo `ativo` que já existe em `usuarios`).

### `admin/convites-antecipados.html` (ajuste, não reescrita)

- Tabela existente ganha coluna "Preenchido" (badge derivado de `nome`
  vazio/preenchido), ao lado do badge "Presente" que já existe.
- Import por planilha continua igual, pro fluxo que a diretoria já usa.
- Busca (`enhanceTable`, já existe) cobre filtro por família/número/
  convidado/status de graça — o texto do badge entra na busca por texto
  sem precisar de UI de filtro nova.
- Export CSV — automático via `enhanceTable`, sem código extra: a tabela já
  exporta o que está visível, incluindo as colunas novas.

### `familia/` (nova pasta — mobile-first, sem login, como `operador/`)

`familia/convites.html?codigo=XXXX`:

- Header: "Família Silva" + barra de progresso "3/5 convites preenchidos".
- Lista de cards, um por convite:
  `[001] Fulano de Tal ✓` (preenchido) ou `[003] — + Adicionar convidado`.
- Toca no card → modal com campo "Nome do convidado" (+ categoria, se o
  evento tiver `categoriasIngresso` configuradas) → salva.
- Aviso leve (não bloqueante) se o nome digitado já existe em outro convite
  da mesma família — evita duplicidade por engano sem travar o fluxo.
- Link/código inválido ou família inativa → tela amigável pedindo pra falar
  com a diretoria.
- Campo alternativo pra colar o código manualmente (fallback caso o link
  quebre ao compartilhar por WhatsApp).

## Fora de escopo (evolução futura, não faz parte dessa entrega)

- **Geração automática de JPG do convite** (nome do convidado + dados do
  evento numa arte customizada, pra baixar/compartilhar). Tecnicamente
  viável com Canvas API nativa do navegador (sem dependência nova), mas
  exige primeiro definir o template visual (arte-base, posição dos textos)
  — trabalho de design que fica pra depois que o cadastro básico estiver
  rodando.
- Blocos de numeração fixos por família (optamos por sequencial único).
- Autenticação mais forte que "posse do link" (ex: Cloud Function com custom
  token) — decidiu-se não introduzir Cloud Functions no stack pra esse caso
  de uso.

## Consistência — casos considerados

- **Duas pessoas da mesma família editando ao mesmo tempo**: last-write-wins
  (mesmo comportamento que o resto do app tem hoje pra dados não-financeiros
  — não é operação de saldo, não precisa de `runTransaction`).
- **Fechar a página no meio do preenchimento**: sem estado parcial — o
  Firestore só grava quando o formulário do card é confirmado.
- **Excluir uma família**: bloqueado se tiver convites vinculados (usar
  "Desativar" em vez de excluir); exclusão só permitida se zero convites.

## Testes de segurança (extensão da suite existente)

Adicionar à suite `dev-tools/rules-tests/` (que já roda com `npm test` no
emulador — ver [[project_rules_test_suite]]) uma Fase 5 cobrindo:

1. Família não-autenticada consegue ler/editar convite próprio.
2. Família não consegue ler convite de outra família (query sem o
   `familiaId` certo retorna vazio).
3. Família não consegue alterar `numero`, `familia`, `familiaId`, `pago`,
   `presente` via update direto.
4. Família não consegue criar convite novo.
5. Família com `ativo: false` é bloqueada.
6. Não autenticado não consegue listar `familias` (só `get` por ID exato).
7. Admin continua com acesso total (criar família, gerar convites, editar
   qualquer campo).
