# CLAUDE.md — Instruções pro Claude Code

Esse arquivo orienta o Claude ao mexer no App GEH. O `README.md` na raiz é
o guia humano com a visão completa do produto, fluxos e modelo de dados —
leia ele primeiro pra entender o domínio.

## Stack em uma linha

Web app vanilla HTML/JS (ES Modules nativos) + Firebase (Hosting + Auth +
Firestore + App Check com reCAPTCHA v3). PWA com Service Worker. Sem
bundler, sem framework, sem `package.json` na raiz, sem suite de testes.

## Comandos do dia-a-dia

```bash
firebase serve                           # dev local em http://localhost:5000
firebase deploy                          # tudo (hosting + rules + indexes)
firebase deploy --only hosting           # só o site
firebase deploy --only firestore:rules   # só as regras
firebase deploy --only firestore:indexes # só os índices (~1min na 1ª vez)
```

**Importante:** mudanças em `firestore.rules` precisam de
`firebase deploy --only firestore:rules` pra valer em produção. Sem isso,
as rules antigas continuam ativas mesmo após push do código.

## Estrutura por papel

- `index.html` — landing, escolhe o perfil
- `operador/`, `caixa/`, `recepcao/` — apps sem login, mobile-first
- `admin/` — apps com login, desktop-first, navegação via sidebar (`_nav.js`)
- `js/` — módulos compartilhados:
  - `firebase-config.js` — init + re-export do SDK
  - `auth-guard.js` — `requireAuth({ papel })`
  - `ui.js` — `toast`, `enhanceTable`, `confirmarAsync`, `abrirDetalhe`, skeleton
  - `helpers.js` — `fmtBRL`, `esc` (formatters genéricos)
  - `icons.js` — sprite SVG Lucide
  - `shortcuts.js`, `install-banner.js`, `scanner.js`
- `css/style.css` — tokens globais (paleta, sombras, radius) + tema claro/escuro
- `css/dashboard.css`, `css/vender.css` — CSS por página pra telas grandes
- `firestore.rules` — única defesa real, valida papel + tipos
- `firestore.indexes.json` — composite indexes (Firestore avisa link no console quando faltar)
- `sw.js` — Service Worker (NÃO cacheia Firestore)

## Convenções já estabelecidas (NÃO violar)

### JavaScript
- **ES Modules nativos** com `<script type="module">`. Imports relativos com
  extensão `.js` explícita.
- **fmtBRL e esc** ficam em [js/helpers.js](js/helpers.js) — nunca redefina
  inline. `esc()` é obrigatório ao interpolar dados do Firestore em
  `innerHTML` (XSS).
- **Confirmações destrutivas** usam `confirmarAsync` de [js/ui.js](js/ui.js),
  nunca `confirm()` nativo.
- **Tabelas** ganham busca + ordenação + CSV automáticos via `enhanceTable`
  / `enhanceAllTables`. Placeholder `<tr><td colspan="N">Carregando...</td></tr>`
  vira skeleton automaticamente.
- **Operações financeiras** (saldo/venda/recarga/transfer) sempre dentro de
  `runTransaction`. Capture valores no início do handler (`const idAlvo =
  cliente.id`) pra evitar stale closure durante `await`.

### CSS
- Cores via `var(--azul)`, `var(--verde)`, etc — nunca hex hardcoded.
- Para tons que dependem do tema, use `var(--amarelo-acento)` (ele inverte
  no dark). NÃO duplique regras `:root[data-theme="dark"]` desnecessariamente.
- `:focus-visible` com `outline: 3px solid var(--amarelo)`. Inputs também
  têm `box-shadow: 0 0 0 3px rgba(251,191,36,0.45)` como fallback.

### HTML
- `<label for="...">` associado a cada `<input>` / `<select>` / `<textarea>`.
- Botões icon-only precisam de `aria-label`.
- Páginas admin importam `_nav.js` no início do `<script type="module">`
  pra montar a sidebar.

### Firestore rules
- Sempre validar papel via `isAdmin()`, `isOperador()`, `isCaixa()`,
  `isRecepcao()`, `isEquipe()`.
- Em coleções financeiras, validar `valor is number && valor > 0` no
  create. Em update de `clientes`, validar `affectedKeys().hasOnly([...])`.

## Workflow preferido pela Juliana

- **PT-BR** em código e comentários, sem acentos nos comentários longos
  (Juliana prefere ASCII em commits e comentários extensos).
- **Sempre proponha uma commit message pronta** ao final de cada ajuste —
  Juliana copia e cola direto.
- **Pular preview tools** (`preview_start`, etc) — Juliana valida no
  `firebase serve` dela. Não rodar verificação via browser.
- **Worktrees**: quando trabalhar isolado, lembrar de `cp` pra main antes
  do deploy.
- **Não criar arquivos a mais** sem necessidade (planos, decisões, análises) —
  se for útil, é commit message, não doc.

## O que NÃO mexer

- `firestore.rules` sem validar manualmente o impacto — ela é a única
  proteção real entre o operador comum e o banco.
- `firebase-config.js` — apiKey é pública por design no Firebase web,
  está ok versionada. Não tentar "esconder" em `.env`.
- `sw.js` cache list — adicionar/remover sem entender o impacto no PWA
  offline pode quebrar acesso pra usuários instalados.
- `auth-guard.js` `SUPER_ADMIN_EMAIL` — é o bootstrap da Juliana, não
  remover.

## Atalho mental: "quem faz o quê"

- **Operador** vende (`vendas`) e atualiza `produtos.estoque` + `clientes.saldo`
- **Caixa** recarrega (`movimentacoes_saldo`) e atualiza `clientes.saldo`
- **Recepção** check-in (`convites_antecipados.presente`) + vende na porta (`vendas_porta`)
- **Admin** faz tudo, incluindo `ajustes_saldo` (auditoria imutável) e
  CRUDs de produtos/clientes/eventos/usuarios
