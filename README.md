# App GEH — Grupo Escoteiro Hokkaido

Sistema de gerenciamento de vendas em eventos do **Grupo Escoteiro Hokkaido**.
Substitui o AppSheet anterior com uma solução própria — mais rápida, mais bonita e feita sob medida pro fluxo do grupo.

🔗 **Produção:** https://app-geh-cc577.web.app

---

## ✨ Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript puro (ES Modules) |
| Tipografia | Inter (Google Fonts) |
| Ícones | Lucide (SVG sprite inline, zero dependências) |
| Banco de dados | Firebase Firestore (tempo real) |
| Autenticação | Firebase Auth (Google + email/senha) |
| Hospedagem | Firebase Hosting |
| Scanner QR | html5-qrcode |
| PWA | Service Worker + manifest.json (cache offline + banner de instalação) |

Sem bundler, sem framework. Tudo ES Modules nativos, servidos direto pelo Firebase Hosting.

---

## 🗺️ Visão geral — quem usa o quê

A landing (`index.html`) é o ponto de entrada e oferece quatro perfis. Cada um tem um app próprio, otimizado pro contexto:

| Perfil | Onde usa | Login | O que faz |
|---|---|---|---|
| **Operador de venda** | celular, no balcão | não | escaneia QR do cliente e registra venda/recarga |
| **Caixa** | celular/tablet | não | recarga de saldo, consulta de extrato |
| **Recepção** | celular/tablet, na porta | não | check-in dos antecipados + venda de convite na porta |
| **Diretoria (Admin)** | desktop | sim (Google ou email/senha; perfil precisa estar ativo) | tudo o resto: cadastros, financeiro, relatórios |

---

## 🎯 Funcionalidades por módulo

### 📱 Operador (`operador/`, sem login)

- Tela inicial mostra o **evento ativo** em tempo real.
- **Scanner de QR code** pela câmera (+ entrada manual de ID).
- **Carrinho estilo delivery** — botões +/− nos cards, barra POS fixa com total e quantidade.
- Badge de **promoção** (preço riscado + preço novo em vermelho).
- Aviso de **estoque baixo** (⚠️ Restam X) e **sem estoque** (botão desabilita).
- **Carregar saldo** no QR do cliente (dinheiro, Pix ou cartão).
- **Consultar saldo** sem precisar vender.
- **Toasts com vibração háptica** — feedback claro no barulho do evento, mão única.

### 💰 Caixa (`caixa/`, sem login)

- Versão dedicada de recarga/consulta separada do fluxo de venda.
- **Scanner próprio** + **carregar saldo** com extrato resumido (últimas movimentações + últimas vendas) na mesma tela.

### 🚪 Recepção (`recepcao/`, sem login)

- **Conferência de antecipados** — escaneia/lista o convite pago antes do evento e marca check-in.
- **Venda de convite na porta** — registro rápido (forma de pagamento, valor, observação) que alimenta o painel ao vivo da diretoria.
- Banner de instalação PWA + funciona offline (Service Worker cacheia os HTMLs/JS principais).

### 🖥️ Admin / Diretoria (`admin/`, com login)

Sidebar agrupada por área de responsabilidade:

**Operação**
- 📊 **Dashboard** — visão em tempo real: total vendido, nº de vendas, saldo em circulação, clientes ativos, últimas vendas.
- 📈 **Comparativo** — confronta eventos lado a lado (vendas com saldo, vendas na porta, despesas).
- 📅 **Eventos** — criar, ativar e encerrar; histórico com receita por evento.
- 🔍 **Histórico** — busca por cliente, mostra recargas e vendas com data e itens.

**Cadastros**
- 📦 **Produtos** — CRUD; cadastro em lote (CSV); promoções; badges de estoque baixo/sem estoque.
- 👥 **Clientes** — cadastro por ID do QR (individual ou em lote); busca; exclusão.
- 👨‍👩‍👧 **Famílias** — cadastro permanente, gera link de acesso público + convites em branco numerados pro evento.

**Recepção**
- 🚪 **Painel ao vivo** — quantos antecipados chegaram, vendas na porta em tempo real, edição rápida de estoque/preço da porta.
- 🎟️ **Convites antecipados** — importação em lote, status de pagamento, marcação manual.
- 📋 **Histórico de recepção** — check-ins e vendas na porta por evento, com export CSV.

**Financeiro**
- 📦 **Estoque** — entrada de mercadoria (compras): produto, qtd, custo, fornecedor; atualiza estoque.
- 💸 **Despesas** — lançamento de despesas e insumos do evento (com categorias e import em lote).
- ✏️ **Ajuste de saldo** — correção manual de saldo de cliente com histórico auditável.
- 📈 **Relatório** — filtra por evento; receita, custo, lucro bruto, saldo em circulação; ranking dos mais vendidos; recargas por forma de pagamento; export CSV; **impressão/PDF** com logo.
- 📄 **Fechamento** — consolidação financeira do evento (vendas + porta + despesas + ajustes).

**Sistema**
- 👤 **Usuários** — gestão dos perfis admin (papel + ativo/inativo).

**Conveniências globais do admin**
- Login via **Google** ou email/senha; perfil precisa estar `ativo: true` (auth-guard.js bloqueia o resto).
- **Tema claro/escuro** com toggle, persiste em `localStorage`.
- **Busca + ordenação + export CSV** em todas as tabelas (basta marcar `data-search` / `data-sort`).
- **Atalhos de teclado** (`/` foca busca, `g d`/`g h` navegam, `?` lista — ver `js/shortcuts.js`).
- **Skeleton loaders** automáticos enquanto carrega.
- **Prefetch** dos links da sidebar no hover/touch.

---

## 📁 Estrutura de arquivos

```
App GEH/
├── index.html                  # Landing — escolher perfil (Operador/Caixa/Recepção/Diretoria)
├── 404.html                    # Página de erro
├── manifest.json               # Configuração do PWA
├── sw.js                       # Service Worker (cache offline)
├── firebase.json               # Config do Firebase Hosting
├── firestore.rules             # Regras de segurança do Firestore
├── firestore.indexes.json      # Índices compostos
├── .firebaserc                 # Projeto Firebase vinculado
│
├── css/
│   └── style.css               # Estilos globais, paleta GEH, tema claro/escuro
│
├── js/
│   ├── firebase-config.js      # Inicialização do Firebase + exports
│   ├── auth-guard.js           # requireAuth({ papel }) — checa login + perfil ativo
│   ├── ui.js                   # Toasts, busca/ordenação/export CSV, skeleton
│   ├── icons.js                # Sprite SVG Lucide (inlinado)
│   ├── shortcuts.js            # Atalhos de teclado globais
│   └── install-banner.js       # Banner "Instalar app" do PWA
│
├── operador/
│   ├── index.html              # Home do operador (evento ativo + ações)
│   ├── scanner.html            # Scanner de QR
│   ├── vender.html             # Carrinho de venda (barra POS fixa)
│   ├── carregar.html           # Recarga de saldo
│   └── consultar.html          # Consulta de extrato
│
├── caixa/
│   ├── index.html              # Home do caixa
│   ├── scanner.html            # Scanner
│   └── carregar.html           # Recarga + extrato
│
├── recepcao/
│   ├── index.html              # Home da recepção
│   ├── conferencia.html        # Check-in dos antecipados
│   └── venda-porta.html        # Venda de convite na porta
│
├── familia/
│   └── convites.html           # Portal público — família preenche convidados dos seus convites
│
├── admin/
│   ├── login.html              # Login Google / email
│   ├── _nav.js                 # Sidebar agrupada + auth + tema
│   ├── dashboard.html          # Visão em tempo real
│   ├── comparativo.html        # Comparativo entre eventos
│   ├── eventos.html            # Gerenciar eventos
│   ├── historico.html          # Histórico por cliente
│   ├── produtos.html           # CRUD de produtos
│   ├── clientes.html           # CRUD de clientes
│   ├── familias.html           # CRUD de famílias + geração de convites em branco
│   ├── recepcao-painel.html    # Painel ao vivo da recepção
│   ├── convites-antecipados.html
│   ├── historico-recepcao.html
│   ├── estoque.html            # Entrada de estoque (compras)
│   ├── despesas.html           # Despesas e insumos
│   ├── ajuste-saldo.html       # Ajuste manual de saldo
│   ├── relatorio.html          # Relatório financeiro + impressão
│   ├── fechamento.html         # Fechamento do evento
│   └── usuarios.html           # Perfis admin (papel + ativo)
│
├── assets/
│   └── logo.png                # Logo do GEH
│
└── dev-tools/
    └── load-test/              # Scripts de teste de carga (interno)
```

---

## 🗄️ Modelo de dados (Firestore)

| Coleção | Quem escreve | Campos principais |
|---|---|---|
| `eventos` | admin | nome, data, status (ativo/encerrado), criadoEm |
| `config/eventoAtivo` | admin | id, nome, data do evento em andamento |
| `produtos` | admin (CRUD) · operador (estoque) | nome, preco, precoPromo, promocao, estoque, categoria |
| `clientes` | admin (cadastro) · operador/caixa (saldo) | saldo |
| `vendas` | operador | clienteId, eventoId, eventoNome, itens[], total, criadoEm |
| `movimentacoes_saldo` | operador/caixa | clienteId, tipo, valor, forma, eventoId, criadoEm |
| `compras` | admin | produtoId, produtoNome, qtd, custoTotal, fornecedor, criadoEm |
| `despesas` | admin | descricao, categoria, valor, data, eventoId |
| `insumos` | admin | nome, categoria (catálogo de despesas recorrentes) |
| `ajustes_saldo` | admin | clienteId, valorAntes, valorDepois, motivo, eventoId, criadoEm |
| `familias` | admin | nome, ativo (ID do doc = código de acesso público) |
| `convites_antecipados` | admin · recepção (check-in) · família (preenche convidado) | eventoId, familia, familiaId, numero, nome, categoria, pago, presente, checkInEm, checkInPor, criadoEm |
| `vendas_porta` | recepção | eventoId, valor, formaPagamento, observacao, criadoEm |
| `usuarios` | admin | email, nome, papel (admin/…), ativo |

---

## 🚀 Como rodar localmente

```bash
# Instalar Firebase CLI (só na primeira vez)
npm install -g firebase-tools

# Login
firebase login

# Servidor local
firebase serve

# Acesse em http://localhost:5000
```

## 📤 Como fazer deploy

```bash
firebase deploy                          # tudo (hosting + regras + índices)
firebase deploy --only hosting           # só o site
firebase deploy --only firestore:rules   # só regras
firebase deploy --only firestore:indexes # só índices (~1min na 1ª vez)
```

URL de produção: **https://app-geh-cc577.web.app**

---

## 🔒 Segurança (Firestore rules)

Regras versionadas em [`firestore.rules`](firestore.rules), índices em [`firestore.indexes.json`](firestore.indexes.json).

**Modelo de acesso:**
- **Operador / Caixa / Recepção** (sem login) leem o necessário e escrevem só o mínimo do fluxo: `UPDATE` em `produtos` (estoque) e `clientes` (saldo), `CREATE` em `vendas`, `movimentacoes_saldo`, `vendas_porta`; `UPDATE` em `convites_antecipados` (check-in).
- **Admin** (autenticado + perfil em `usuarios` com `ativo: true` e `papel: 'admin'`) pode tudo.

Isso bloqueia ataques drive-by (delete em massa, hijack do evento ativo) sem quebrar o fluxo dos perfis sem login. Fluxos sensíveis que ainda ficam abertos (ex.: criar venda falsa, zerar saldo via DevTools) exigiriam Cloud Functions.

---

## 🎪 Fluxo de uso no evento

```
PRÉ-EVENTO (Admin no PC)
  1. Criar evento em "Eventos" → ativar
  2. Cadastrar produtos (ou importar em lote)
  3. Cadastrar QR codes dos clientes (ou importar em lote)
  4. Importar lista de antecipados em "Convites antecipados"

DURANTE O EVENTO
  Recepção (celular)
    5. Conferência: escaneia/lista convite → marca check-in
    6. Venda na porta: registra valor + forma de pagamento
  Caixa (celular)
    7. Carrega saldo no QR do cliente
  Operador (celular)
    8. Vende: escaneia QR → adiciona produtos → finaliza
  Diretoria (PC)
    9. Acompanha tudo em tempo real no Dashboard e no Painel ao vivo

PÓS-EVENTO (Admin no PC)
  10. Lançar despesas do evento
  11. Encerrar evento em "Eventos"
  12. Conferir Fechamento → exportar Relatório (CSV ou PDF)
```

---

## 📲 PWA — Instalar no celular

**Android (Chrome):** abre o site → menu ⋮ → *Adicionar à tela inicial* (ou clica no banner que aparece na home).

**iOS (Safari):** abre o site → botão compartilhar → *Adicionar à Tela de Início*.

O app funciona instalado como se fosse nativo, sem barra do navegador. O Service Worker (`sw.js`) guarda os arquivos estáticos em cache, então a tela abre rápido mesmo com conexão ruim — dados do Firestore continuam em tempo real quando há rede.

---

## 🎨 Design system (resumo)

- **Paleta GEH:** azul `#1E3A8A`, azul-escuro `#152C6B`, vermelho `#DC2626`, amarelo `#FBBF24`
- **Tipografia:** Inter (400/500/600/700)
- **Ícones:** sprite SVG inline (Lucide) — uso: `<span data-icon="package" data-size="24"></span>`
- **Toasts:** `toast('Venda concluída', { tipo: 'sucesso' })` com vibração háptica
- **Tabelas:** `data-search="#input"` + `data-sort` nos `<th>` ativam filtro/ordenação/export CSV sem JS adicional
- **Tema:** claro/escuro com toggle na sidebar; persiste em `localStorage`

---

Feito com 💙 pro **Grupo Escoteiro Hokkaido**.
