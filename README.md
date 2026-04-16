# App GEH — Grupo Escoteiro Hokkaido
Sistema de gerenciamento de vendas em eventos do Grupo Escoteiro Hokkaido.
Substitui o AppSheet anterior com uma solução própria, mais funcional e bonita.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript puro |
| Banco de dados | Firebase Firestore |
| Autenticação | Firebase Auth (Google + email/senha) |
| Hospedagem | Firebase Hosting |
| Scanner QR | html5-qrcode |
| PWA | Service Worker + manifest.json |

---

## Funcionalidades

### 📱 Operador (mobile, sem login)
- Tela inicial mostra o **evento ativo** em tempo real
- **Scanner de QR code** pela câmera do celular (+ entrada manual de ID)
- **Carrinho de compras** estilo delivery — botões +/− direto nos cards de produto
- Badge de **promoção** com preço riscado e preço novo em vermelho
- Aviso de **estoque baixo** (⚠️ Restam X) nos produtos
- **Carregar saldo** no QR do cliente (dinheiro, Pix ou cartão)
- **Consultar saldo** sem fazer venda

### 🖥️ Admin/Diretoria (desktop, com login)
- Login via **Google** (conta corporativa) ou email/senha
- **📅 Eventos** — criar, ativar e encerrar eventos; histórico com receita por evento
- **📊 Dashboard** — visão em tempo real: total vendido, nº de vendas, saldo em circulação, clientes ativos, últimas vendas
- **📦 Produtos** — CRUD completo; cadastro em lote (CSV); promoções com preço especial; badge de estoque baixo/sem estoque
- **👥 Clientes** — cadastro por ID do QR; cadastro em lote (um ID por linha); busca; exclusão
- **🔍 Histórico** — busca por ID do cliente, mostra todas as recargas e vendas com data e itens
- **🛒 Compras** — registro de entrada de estoque (produto, quantidade, custo, fornecedor); atualiza estoque automaticamente
- **📈 Relatório** — filtrado por evento; receita, custo, lucro bruto, saldo em circulação; ranking de mais vendidos; recargas por forma de pagamento; exportação CSV; **impressão/PDF** formatada com logo

---

## Estrutura de arquivos

```
App GEH/
├── index.html                  # Landing — escolher Operador ou Admin
├── manifest.json               # Configuração do PWA
├── sw.js                       # Service Worker (cache offline)
├── firebase.json               # Config do Firebase Hosting
├── .firebaserc                 # Projeto Firebase vinculado
│
├── css/
│   └── style.css               # Estilos globais + paleta GEH
│
├── js/
│   └── firebase-config.js      # Inicialização do Firebase + exports
│
├── operador/
│   ├── index.html              # Home do operador (evento ativo + ações)
│   ├── scanner.html            # Scanner de QR code
│   ├── vender.html             # Carrinho de venda
│   └── carregar.html           # Recarga / consulta de saldo
│
├── admin/
│   ├── login.html              # Login Google / email
│   ├── _nav.js                 # Navegação e autenticação compartilhados
│   ├── eventos.html            # Gerenciar eventos
│   ├── dashboard.html          # Visão geral em tempo real
│   ├── produtos.html           # Gerenciar produtos
│   ├── clientes.html           # Gerenciar clientes
│   ├── historico.html          # Histórico por cliente
│   ├── compras.html            # Entrada de estoque
│   └── relatorio.html          # Relatório financeiro + impressão
│
└── assets/
    └── logo.png                # Logo do Grupo Escoteiro Hokkaido
```

---

## Modelo de dados (Firestore)

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

## Como rodar localmente

```bash
# Instalar Firebase CLI (só na primeira vez)
npm install -g firebase-tools

# Login
firebase login

# Servidor local
firebase serve

# Acesse em http://localhost:5000
```

## Como fazer deploy

```bash
firebase deploy
```

URL de produção: **https://app-geh-cc577.web.app**

---

## Regras do Firestore

O operador não tem login — as regras permitem leitura/escrita pública nas coleções operacionais. O controle de acesso é físico (só operadores credenciados têm o link no evento).

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /produtos/{doc}            { allow read, write: if true; }
    match /clientes/{doc}            { allow read, write: if true; }
    match /vendas/{doc}              { allow read, write: if true; }
    match /movimentacoes_saldo/{doc} { allow read, write: if true; }
    match /compras/{doc}             { allow read, write: if true; }
    match /eventos/{doc}             { allow read, write: if true; }
    match /config/{doc}              { allow read, write: if true; }
  }
}
```

---

## Fluxo de uso no evento

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

## PWA — Instalar no celular

**Android (Chrome):** abre o site → menu ⋮ → "Adicionar à tela inicial"

**iOS (Safari):** abre o site → botão compartilhar → "Adicionar à Tela de Início"

O app funciona instalado como se fosse um app nativo, sem barra do navegador.
