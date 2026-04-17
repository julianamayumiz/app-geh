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
| PWA | Service Worker + manifest.json |

Sem bundler, sem framework. Tudo ES Modules nativos, servidos direto pelo Firebase Hosting.

---

## 🎯 Funcionalidades

### 📱 Operador (mobile, sem login)

- Tela inicial mostra o **evento ativo** em tempo real
- **Scanner de QR code** pela câmera do celular (+ entrada manual de ID)
- **Carrinho estilo delivery** — botões +/− direto nos cards de produto, com barra POS fixa mostrando total e qtd
- Badge de **promoção** com preço riscado e preço novo em vermelho
- Aviso de **estoque baixo** (⚠️ Restam X) e **sem estoque** (botão desabilita)
- **Carregar saldo** no QR do cliente (dinheiro, Pix ou cartão)
- **Consultar saldo** sem fazer venda
- **Toasts com vibração háptica** — feedback claro no barulho do evento, mão única

### 🖥️ Admin / Diretoria (desktop, com login)

- Login via **Google** (conta corporativa) ou email/senha
- **Sidebar agrupada** por área (Operação · Cadastros · Financeiro) e **tema claro/escuro**
- **Busca e ordenação automática** em todas as tabelas (basta marcar `data-search` / `data-sort`)
- **📅 Eventos** — criar, ativar e encerrar; histórico com receita por evento
- **📊 Dashboard** — visão em tempo real: total vendido, nº de vendas, saldo em circulação, clientes ativos, últimas vendas
- **📦 Produtos** — CRUD completo; cadastro em lote (CSV); promoções com preço especial; badge de estoque baixo/sem estoque
- **👥 Clientes** — cadastro por ID do QR; cadastro em lote (um ID por linha); busca; exclusão
- **🔍 Histórico** — busca por ID do cliente, mostra todas as recargas e vendas com data e itens
- **🛒 Compras** — registro de entrada de estoque (produto, qtd, custo, fornecedor); atualiza estoque automaticamente
- **📈 Relatório** — filtrado por evento; receita, custo, lucro bruto, saldo em circulação; ranking de mais vendidos; recargas por forma de pagamento; exportação CSV; **impressão/PDF** formatada com logo

---

## 📁 Estrutura de arquivos

```
App GEH/
├── index.html                  # Landing — escolher Operador ou Admin
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
│   ├── ui.js                   # Toasts, busca/ordenação de tabelas, helpers
│   └── icons.js                # Sprite SVG Lucide (ícones inlinados)
│
├── operador/
│   ├── index.html              # Home do operador (evento ativo + ações)
│   ├── scanner.html            # Scanner de QR code
│   ├── vender.html             # Carrinho de venda (barra POS fixa)
│   └── carregar.html           # Recarga / consulta de saldo
│
├── admin/
│   ├── login.html              # Login Google / email
│   ├── _nav.js                 # Sidebar agrupada + auth compartilhada
│   ├── eventos.html            # Gerenciar eventos
│   ├── dashboard.html          # Visão geral em tempo real
│   ├── produtos.html           # Gerenciar produtos
│   ├── clientes.html           # Gerenciar clientes
│   ├── historico.html          # Histórico por cliente
│   ├── compras.html            # Entrada de estoque
│   └── relatorio.html          # Relatório financeiro + impressão
│
├── assets/
│   └── logo.png                # Logo do Grupo Escoteiro Hokkaido
│
└── dev-tools/
    └── load-test/              # Scripts de teste de carga (interno)
```

---

## 🗄️ Modelo de dados (Firestore)

| Coleção | Campos principais |
|---|---|
| `eventos` | nome, data, status (ativo/encerrado) |
| `config/eventoAtivo` | id, nome, data do evento em andamento |
| `produtos` | nome, preco, precoPromo, promocao, estoque, categoria |
| `clientes` | saldo |
| `vendas` | clienteId, eventoId, eventoNome, itens[], total, criadoEm |
| `movimentacoes_saldo` | clienteId, tipo, valor, forma, eventoId, criadoEm |
| `compras` | produtoId, produtoNome, qtd, custoTotal, fornecedor, criadoEm |

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
# Deploy completo (hosting + regras + índices)
firebase deploy

# Só o hosting
firebase deploy --only hosting

# Só as regras do Firestore
firebase deploy --only firestore:rules

# Só os índices (demora ~1min na primeira vez)
firebase deploy --only firestore:indexes
```

URL de produção: **https://app-geh-cc577.web.app**

---

## 🔒 Segurança (Firestore rules)

As regras estão versionadas em [`firestore.rules`](firestore.rules) e os índices compostos em [`firestore.indexes.json`](firestore.indexes.json).

**Modelo de acesso:**
- **Operador** (sem login) lê tudo e só consegue escrever o necessário pra vender/carregar: `UPDATE` em `produtos` (estoque) e `clientes` (saldo), `CREATE` em `vendas` e `movimentacoes_saldo`.
- **Admin** (autenticado) pode tudo. Apagar/criar produtos, clientes, eventos, config e compras exige login.

Isso bloqueia ataques drive-by (delete em massa, hijack do evento ativo) sem quebrar o fluxo do operador. Fluxos sensíveis que ainda ficam abertos (ex.: criar venda falsa, zerar saldo via DevTools) exigiriam Cloud Functions.

---

## 🎪 Fluxo de uso no evento

```
PRÉ-EVENTO (Admin no PC)
  1. Criar evento em "Eventos" → ativar
  2. Cadastrar produtos (ou importar em lote)
  3. Cadastrar QR codes dos clientes (ou importar em lote)

DURANTE O EVENTO (Operador no celular)
  4. Acessar https://app-geh-cc577.web.app → "Sou Operador"
  5. Carregar saldo: escanear QR → digitar valor → confirmar
  6. Vender: escanear QR → adicionar produtos → finalizar

PÓS-EVENTO (Admin no PC)
  7. Encerrar evento em "Eventos"
  8. Ver relatório → filtrar pelo evento → exportar CSV ou imprimir PDF
```

---

## 📲 PWA — Instalar no celular

**Android (Chrome):** abre o site → menu ⋮ → *Adicionar à tela inicial*

**iOS (Safari):** abre o site → botão compartilhar → *Adicionar à Tela de Início*

O app funciona instalado como se fosse um app nativo, sem barra do navegador. O Service Worker guarda os arquivos estáticos em cache, então a tela abre rápido mesmo com conexão ruim (dados do Firestore continuam em tempo real quando há rede).

---

## 🎨 Design system (resumo)

- **Paleta GEH:** azul `#1E3A8A`, azul-escuro `#152C6B`, vermelho `#DC2626`, amarelo `#FBBF24`
- **Tipografia:** Inter (400/500/600/700) em todo o app
- **Ícones:** sprite SVG inline (Lucide) — uso: `<span data-icon="package" data-size="24"></span>`
- **Toasts:** `toast('Venda concluída', { tipo: 'sucesso' })` com vibração háptica
- **Tabelas:** adicione `data-search="#input"` e `data-sort` nos `<th>` pra ativar filtro/ordenação sem JS adicional
- **Tema:** claro/escuro com toggle na sidebar; persiste em `localStorage`

---

Feito com 💙 pro **Grupo Escoteiro Hokkaido**.
