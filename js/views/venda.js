// ============================================================
// View "venda" do PDV (operador) — carrinho + finalizar venda
// ============================================================
// Montada por js/pdv-core.js dentro de #pdv-conteudo (sem recarregar a
// pagina). Garantias:
//  - carrinho vai pro localStorage a cada toque (rascunho) e e restaurado
//    se a pagina recarregar/fechar no meio da venda;
//  - vendaId e gerado UMA vez por carrinho; dentro da transacao, se a venda
//    ja existe, trata como sucesso (nunca cobra duas vezes);
//  - antes da transacao grava "pendente"; se o app morrer no meio, o proximo
//    boot confere no Firestore se a venda foi registrada.
// ============================================================

import {
  db, doc, getDoc, collection, getDocs, serverTimestamp, runTransaction
} from '../firebase-config.js';
import { icon, renderIcons } from '../icons.js';
import { fmtBRL, esc } from '../helpers.js';

const QUEBRA = String.fromCharCode(10);

// Preco efetivo (promocao vale so com precoPromo preenchido). Mesma regra na
// lista e na trava da transacao.
const precoDe = (d) => (d.promocao && d.precoPromo ? d.precoPromo : d.preco);

// Cache so serve pra MOSTRAR a lista na hora enquanto a versao fresca chega;
// toda venda busca de novo (a pagina nao recarrega, entao nao pode confiar nele).
let produtosCache = null;
let produtosEm = 0;
// Dentro dessa janela a lista em memoria vale: nao relê os ~30 produtos do
// Firestore a cada venda. A transacao revalida preco e estoque de qualquer
// jeito (PRECO_MUDOU / Estoque insuficiente) e uma falha forca releitura.
const PRODUTOS_TTL_MS = 60000;
const cacheFresco = () => !!produtosCache && Date.now() - produtosEm < PRODUTOS_TTL_MS;

async function buscarProdutos() {
  const snap = await getDocs(collection(db, 'produtos'));
  const lista = [];
  snap.forEach(d => {
    const p = { id: d.id, ...d.data() };
    p.precoFinal = precoDe(p);
    lista.push(p);
  });
  lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  produtosCache = lista;
  produtosEm = Date.now();
  return lista;
}

const TEMPLATE = `
  <div class="cliente-info sticky">
    <div class="nome" id="cliente-nome"><span class="skel skel-on-dark skel-title" style="width:60%"></span></div>
    <div class="saldo-label">Saldo disponível</div>
    <div class="saldo" id="cliente-saldo"><span class="skel skel-on-dark skel-num" style="width:140px;height:1.8rem"></span></div>
  </div>

  <div id="alerta-venda" class="alert hidden"></div>

  <h3 class="card-title" style="padding-left:0.25rem;margin-bottom:0.5rem;">Produtos</h3>
  <div class="busca-wrapper">
    <span class="busca-icon" data-icon="search" data-size="18"></span>
    <label for="busca-prod" class="sr-only">Buscar produto</label>
    <input type="search" id="busca-prod" placeholder="Buscar produto..." autocomplete="off">
    <button type="button" class="busca-clear" id="busca-clear" aria-label="Limpar busca"><span data-icon="x" data-size="16"></span></button>
  </div>
  <div id="cat-bar" class="cat-bar" role="tablist" aria-label="Filtro de categorias"></div>
  <div id="produtos-container">
    <div class="produtos-grid" role="status" aria-busy="true" aria-label="Carregando produtos">
      <div class="skel-prod-card"><span class="skel skel-text" style="width:80%"></span><span class="skel skel-text" style="width:50%"></span><span class="skel skel-text" style="width:35%"></span></div>
      <div class="skel-prod-card"><span class="skel skel-text" style="width:70%"></span><span class="skel skel-text" style="width:55%"></span><span class="skel skel-text" style="width:40%"></span></div>
      <div class="skel-prod-card"><span class="skel skel-text" style="width:85%"></span><span class="skel skel-text" style="width:45%"></span><span class="skel skel-text" style="width:30%"></span></div>
      <div class="skel-prod-card"><span class="skel skel-text" style="width:75%"></span><span class="skel skel-text" style="width:60%"></span><span class="skel skel-text" style="width:38%"></span></div>
    </div>
  </div>

  <!-- Barra POS do carrinho (fixa no rodape) -->
  <div class="cart-bar" id="cart-bar" role="region" aria-label="Resumo do carrinho">
    <div class="resumo">
      <span class="resumo-label">Total do carrinho</span>
      <span class="resumo-total" id="fab-total">R$ 0,00</span>
      <span class="resumo-qtd" id="fab-qtd-label">0 itens</span>
    </div>
    <button class="btn-ver" id="fab-carrinho" type="button">
      <span data-icon="shopping-cart" data-size="18"></span>
      Ver carrinho
      <span class="badge" id="fab-qtd">0</span>
    </button>
  </div>

  <!-- Modal do carrinho -->
  <div class="modal-overlay" id="modal-overlay">
    <div class="modal-box">
      <div class="modal-titulo">
        <span style="display:inline-flex;align-items:center;gap:0.4rem;"><span data-icon="shopping-cart" data-size="20"></span> Carrinho</span>
        <button type="button" id="btn-fechar-modal" aria-label="Fechar" style="background:none;border:none;cursor:pointer;color:var(--cinza);display:inline-flex;padding:0.25rem;"><span data-icon="x" data-size="22"></span></button>
      </div>
      <div id="modal-itens"></div>
      <div class="modal-total">
        <span>Total</span>
        <span id="modal-total-val">R$ 0,00</span>
      </div>
      <div id="alerta-modal" class="alert hidden"></div>
      <button id="btn-finalizar" class="btn btn-success" type="button"><span data-icon="check" data-size="20"></span> Finalizar Venda</button>
      <button id="btn-limpar" class="btn btn-secondary mt-1" type="button" style="font-size:0.85rem;"><span data-icon="trash-2" data-size="16"></span> Limpar carrinho</button>
    </div>
  </div>

  <!-- Tela de sucesso: curta, volta sozinha pro scanner -->
  <div class="venda-sucesso hidden" id="venda-sucesso" role="status" aria-live="polite">
    <div class="venda-sucesso-box">
      <div class="venda-sucesso-ic">${icon('check-circle', { size: 56 })}</div>
      <div class="venda-sucesso-tit" id="sucesso-titulo">Venda registrada</div>
      <div class="venda-sucesso-val" id="sucesso-total"></div>
      <div class="venda-sucesso-sub">Saldo final</div>
      <div class="venda-sucesso-saldo" id="sucesso-saldo"></div>
      <button type="button" class="btn btn-primary" id="btn-proximo">Voltar ao início</button>
    </div>
  </div>
`;

export async function montar(container, ctx) {
  const { clienteId, perfil, rascunho, pendente } = ctx;

  container.innerHTML = TEMPLATE;
  renderIcons(container);
  ctx.setTitulo('Venda');

  const $ = (id) => container.querySelector(`#${id}`);
  const limpezas = [];            // tudo que o desmontar precisa desfazer
  const carrinho = new Map();     // produtoId -> { produto, qtd }
  let cliente = null;
  let eventoAtivo = null;
  let produtos = [];
  let categoriaAtiva = 'Todos';
  let finalizando = false;
  let avisoInicial = null;   // mensagem de restauracao/descarte do rascunho, mostrada apos a carga
  let vendaId = null;
  let timerSucesso = null;
  let ativo = true;

  const vibrar = (padrao) => { try { navigator.vibrate?.(padrao); } catch (_) {} };

  // Mensagem fixa no topo da venda (sem notificacao flutuante). ms>0 some sozinha.
  let avisoTimer = null;
  function mostrarAlerta(msg, tipo = 'info', ms = 0) {
    clearTimeout(avisoTimer);
    const a = $('alerta-venda');
    a.textContent = msg;
    a.className = `alert alert-${tipo}`;
    a.style.whiteSpace = 'pre-line';
    if (ms > 0) avisoTimer = setTimeout(() => a.classList.add('hidden'), ms);
  }

  // ── Rascunho ─────────────────────────────────────
  function salvarRascunho() {
    if (carrinho.size === 0) { rascunho.limpar(); return; }
    rascunho.gravar({
      tipo: 'venda',
      clienteId,
      opId: vendaId,
      eventoId: eventoAtivo?.id || null,
      temItens: true,
      itens: Array.from(carrinho.values()).map(({ produto, qtd }) => ({ id: produto.id, qtd }))
    });
  }

  function restaurarRascunho() {
    const r = rascunho.ler();
    if (!r || r.tipo !== 'venda') return false;
    if (r.clienteId !== clienteId) { rascunho.limpar(); return false; }
    if ((r.eventoId || null) !== (eventoAtivo?.id || null)) {
      rascunho.limpar();
      avisoInicial = ['O evento ativo mudou. O carrinho anterior foi descartado.', 'warning'];
      return false;
    }
    vendaId = r.opId || null;
    let restaurou = 0;
    (r.itens || []).forEach(({ id, qtd }) => {
      const produto = produtos.find(p => p.id === id);
      if (!produto) return;
      const q = Math.min(Number(qtd) || 0, produto.estoque ?? 0);
      if (q > 0) { carrinho.set(id, { produto, qtd: q }); restaurou++; }
    });
    if (restaurou > 0) avisoInicial = ['Carrinho restaurado.', 'info'];
    return restaurou > 0;
  }

  // ── Cliente ──────────────────────────────────────
  async function carregarCliente() {
    const snap = await getDoc(doc(db, 'clientes', clienteId));
    if (!ativo) return;
    if (!snap.exists()) {
      $('cliente-nome').innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('x-circle', { size: 20 })} Não cadastrado</span>`;
      mostrarAlerta(`Cliente ${clienteId} não encontrado.`, 'danger');
      return;
    }
    cliente = { id: clienteId, ...snap.data() };
    $('cliente-nome').textContent = clienteId;
    atualizarSaldoExibido();
  }

  function atualizarSaldoExibido() {
    $('cliente-saldo').textContent = `R$ ${Number(cliente.saldo || 0).toFixed(2).replace('.', ',')}`;
  }

  // ── Produtos ─────────────────────────────────────
  function renderizarCategorias() {
    const bar = $('cat-bar');
    const cats = Array.from(new Set(
      produtos.map(p => (p.categoria || 'Geral').trim() || 'Geral')
    )).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    if (cats.length <= 1) {
      bar.style.display = 'none';
      categoriaAtiva = 'Todos';
      return;
    }
    bar.style.display = '';

    bar.innerHTML = '';
    ['Todos', ...cats].forEach(cat => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cat-chip' + (cat === categoriaAtiva ? ' ativo' : '');
      chip.textContent = cat;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', cat === categoriaAtiva ? 'true' : 'false');
      chip.onclick = () => {
        categoriaAtiva = cat;
        bar.querySelectorAll('.cat-chip').forEach(c => {
          const ativoChip = c.textContent === cat;
          c.classList.toggle('ativo', ativoChip);
          c.setAttribute('aria-selected', ativoChip ? 'true' : 'false');
        });
        renderizarProdutos();
      };
      bar.appendChild(chip);
    });
  }

  const norm = (s) => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  function renderizarProdutos() {
    const cont = $('produtos-container');
    const termo = norm($('busca-prod').value.trim());
    const porCategoria = categoriaAtiva && categoriaAtiva !== 'Todos'
      ? produtos.filter(p => ((p.categoria || 'Geral').trim() || 'Geral') === categoriaAtiva)
      : produtos;
    const filtrados = termo
      ? porCategoria.filter(p => norm(p.nome).includes(termo) || norm(p.categoria).includes(termo))
      : porCategoria;

    if (filtrados.length === 0) {
      const msg = termo
        ? `Nenhum produto encontrado para "${esc($('busca-prod').value)}".`
        : `Nenhum produto na categoria "${esc(categoriaAtiva)}".`;
      cont.innerHTML = `<div class="empty-state">${icon('search', { size: 32 })}<p>${msg}</p></div>`;
      return;
    }

    const favoritos = filtrados.filter(p => p.favorito);
    const demais    = filtrados.filter(p => !p.favorito);

    cont.innerHTML = '';

    if (termo) {
      const grid = document.createElement('div');
      grid.className = 'produtos-grid';
      filtrados.forEach(p => grid.appendChild(criarCardProduto(p)));
      cont.appendChild(grid);
      carrinho.forEach(({ qtd }, id) => atualizarCardProduto(id, qtd));
      return;
    }

    if (favoritos.length > 0) {
      const titFav = document.createElement('div');
      titFav.className = 'secao-titulo';
      titFav.innerHTML = `${icon('star', { size: 14 })} Favoritos`;
      cont.appendChild(titFav);
      const gridFav = document.createElement('div');
      gridFav.className = 'produtos-grid';
      favoritos.forEach(p => gridFav.appendChild(criarCardProduto(p)));
      cont.appendChild(gridFav);
    }

    if (demais.length > 0) {
      if (favoritos.length > 0) {
        const titAll = document.createElement('div');
        titAll.className = 'secao-titulo';
        titAll.style.color = 'var(--cinza)';
        titAll.textContent = 'Demais produtos';
        cont.appendChild(titAll);
      }
      const gridAll = document.createElement('div');
      gridAll.className = 'produtos-grid';
      demais.forEach(p => gridAll.appendChild(criarCardProduto(p)));
      cont.appendChild(gridAll);
    }

    carrinho.forEach(({ qtd }, id) => atualizarCardProduto(id, qtd));
  }

  $('busca-prod').addEventListener('input', renderizarProdutos);
  $('busca-clear').addEventListener('click', () => {
    $('busca-prod').value = '';
    renderizarProdutos();
    $('busca-prod').focus();
  });

  function criarCardProduto(p) {
    const ESTOQUE_BAIXO = 10;
    const semEstoque = (p.estoque ?? 0) <= 0;
    const estoqueBaixo = !semEstoque && p.estoque <= ESTOQUE_BAIXO;
    const card = document.createElement('div');
    card.className = `prod-card ${semEstoque ? 'sem-estoque' : ''}`;
    card.id = `card-${p.id}`;

    const badgePromo = p.promocao
      ? `<span style="background:var(--vermelho);color:white;font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:999px;display:inline-flex;align-items:center;gap:3px;">${icon('tag', { size: 10 })} PROMO</span>`
      : '';
    const precoHtml = p.promocao && p.precoPromo
      ? `<div class="prod-preco-old">R$ ${Number(p.preco).toFixed(2).replace('.', ',')}</div>
         <div class="prod-preco promo">R$ ${Number(p.precoFinal).toFixed(2).replace('.', ',')}</div>`
      : `<div class="prod-preco">R$ ${Number(p.preco).toFixed(2).replace('.', ',')}</div>`;

    const estoqueHtml = semEstoque
      ? 'Sem estoque'
      : estoqueBaixo
        ? `${icon('alert-triangle', { size: 12 })} Restam ${p.estoque}`
        : `Estoque: ${p.estoque}`;
    const starHtml = p.favorito
      ? `<span class="fav-star" aria-label="Favorito">${icon('star', { size: 14 })}</span>`
      : '';
    card.innerHTML = `
      <span class="qtd-badge" id="badge-${p.id}" aria-hidden="true">0</span>
      ${starHtml}
      ${badgePromo}
      <div class="prod-nome">${esc(p.nome)}</div>
      ${precoHtml}
      <div class="prod-estoque" style="${estoqueBaixo ? 'color:var(--vermelho);font-weight:600;display:inline-flex;align-items:center;gap:3px;' : ''}">
        ${estoqueHtml}
      </div>
      <div class="prod-controle hidden" id="ctrl-${p.id}">
        <button class="btn-qtd btn-menos" data-id="${p.id}" aria-label="Diminuir">${icon('minus', { size: 18 })}</button>
        <span class="qtd-display" id="qtd-${p.id}">0</span>
        <button class="btn-qtd btn-mais" data-id="${p.id}" aria-label="Aumentar">${icon('plus', { size: 18 })}</button>
      </div>
      <button class="btn-adicionar" id="add-${p.id}">${icon('plus', { size: 16 })} Adicionar</button>
    `;

    card.querySelector(`#add-${p.id}`).onclick = () => adicionar(p);
    card.querySelector(`[data-id="${p.id}"].btn-mais`).onclick = () => adicionar(p);
    card.querySelector(`[data-id="${p.id}"].btn-menos`).onclick = () => remover(p.id);

    return card;
  }

  // Troca a lista pela versao fresca preservando o carrinho: itens apontam pro
  // produto novo, qtd e limitada ao estoque atual e o operador e avisado do que mudou.
  function aplicarProdutos(novos) {
    produtos = novos;
    const mudancas = [];
    const nomesPreco = [];
    const nomesEstoque = [];
    Array.from(carrinho.entries()).forEach(([id, item]) => {
      const novo = novos.find(p => p.id === id);
      if (!novo) {
        carrinho.delete(id);
        mudancas.push(`${item.produto.nome} saiu da lista`);
        nomesEstoque.push(item.produto.nome);
        return;
      }
      if (novo.precoFinal !== item.produto.precoFinal) {
        mudancas.push(`${novo.nome}: ${fmtBRL(item.produto.precoFinal)} → ${fmtBRL(novo.precoFinal)}`);
        nomesPreco.push({ nome: novo.nome, de: item.produto.precoFinal, para: novo.precoFinal });
      }
      const max = novo.estoque ?? 0;
      if (item.qtd > max) {
        mudancas.push(`${novo.nome}: estoque agora ${max}`);
        nomesEstoque.push(novo.nome);
        if (max <= 0) carrinho.delete(id); else item.qtd = max;
      }
      if (carrinho.has(id)) item.produto = novo;
    });
    renderizarCategorias();
    renderizarProdutos();
    atualizarFab();
    if ($('modal-overlay').classList.contains('aberto')) atualizarModal();
    if (mudancas.length) {
      salvarRascunho();
      conferir = true;
      // Um bloco por produto: titulo + valor antigo -> valor novo
      const blocos = [];
      nomesPreco.forEach(({ nome, de, para }) => {
        blocos.push([`Atenção: o valor do produto ${nome} mudou!`, `${fmtBRL(de)} -> ${fmtBRL(para)}`].join(QUEBRA));
      });
      nomesEstoque.forEach(nome => {
        blocos.push(`Atenção: o estoque do produto ${nome} mudou!`);
      });
      avisoConferir = [blocos.join(QUEBRA + QUEBRA), 'Confira o total e finalize a compra novamente'].join(QUEBRA);
      if ($('modal-overlay').classList.contains('aberto')) mostrarAvisoConferir();
      mostrarAlerta(blocos.join(QUEBRA + QUEBRA), 'warning');
    }
  }

  // Preco/estoque de item do carrinho mudou: o operador precisa ver e confirmar
  // o novo total (o Finalizar do proximo toque so passa depois do aviso).
  let conferir = false;
  let avisoConferir = '';
  function mostrarAvisoConferir() {
    const a = $('alerta-modal');
    a.textContent = avisoConferir;
    a.className = 'alert alert-warning';
    a.style.whiteSpace = 'pre-line';
  }

  let atualizando = null;
  // Busca produtos frescos (promocao/preco/estoque mudaram). Uma busca por vez;
  // nao mexe na lista durante o envio da venda.
  function atualizarProdutos(forcar = false) {
    if (!ativo || finalizando) return Promise.resolve();
    if (!forcar && cacheFresco()) return Promise.resolve();
    if (atualizando) return atualizando;
    atualizando = buscarProdutos()
      .then(novos => { if (ativo && !finalizando) aplicarProdutos(novos); })
      .catch(e => console.warn('[venda] nao consegui atualizar produtos:', e))
      .finally(() => { atualizando = null; });
    return atualizando;
  }

  const onVisivel = () => { if (document.visibilityState === 'visible') atualizarProdutos(); };
  document.addEventListener('visibilitychange', onVisivel);
  limpezas.push(() => document.removeEventListener('visibilitychange', onVisivel));

  // ── Carrinho ──────────────────────────────────────
  function adicionar(p) {
    const atual = carrinho.get(p.id) || { produto: p, qtd: 0 };
    if (atual.qtd + 1 > p.estoque) {
      mostrarAlerta(`Estoque máximo de ${p.nome} atingido`, 'warning', 3000);
      return;
    }
    if (!vendaId) vendaId = doc(collection(db, 'vendas')).id;
    atual.qtd += 1;
    carrinho.set(p.id, atual);
    atualizarCardProduto(p.id, atual.qtd);
    atualizarFab();
    salvarRascunho();
    vibrar(15);
  }

  function remover(produtoId) {
    const atual = carrinho.get(produtoId);
    if (!atual) return;
    atual.qtd -= 1;
    if (atual.qtd <= 0) carrinho.delete(produtoId);
    else carrinho.set(produtoId, atual);
    atualizarCardProduto(produtoId, atual.qtd <= 0 ? 0 : atual.qtd);
    atualizarFab();
    atualizarModal();
    salvarRascunho();
    vibrar(15);
  }

  function limparCarrinho() {
    carrinho.forEach((_, id) => atualizarCardProduto(id, 0));
    carrinho.clear();
    atualizarFab();
    fecharModal();
    rascunho.limpar();
    conferir = false;
    $('alerta-venda').classList.add('hidden');
  }

  function atualizarCardProduto(id, qtd) {
    const ctrl = $(`ctrl-${id}`);
    const addBtn = $(`add-${id}`);
    const qtdEl = $(`qtd-${id}`);
    const badge = $(`badge-${id}`);
    const card = $(`card-${id}`);
    if (!ctrl) return;
    if (qtd > 0) {
      ctrl.classList.remove('hidden');
      addBtn.classList.add('hidden');
      qtdEl.textContent = qtd;
      if (badge) badge.textContent = qtd;
      card.classList.add('no-carrinho');
    } else {
      ctrl.classList.add('hidden');
      addBtn.classList.remove('hidden');
      card.classList.remove('no-carrinho');
    }
  }

  function totalCarrinho() {
    return Array.from(carrinho.values())
      .reduce((s, { produto, qtd }) => s + (produto.precoFinal ?? produto.preco) * qtd, 0);
  }

  function qtdTotalCarrinho() {
    return Array.from(carrinho.values()).reduce((s, { qtd }) => s + qtd, 0);
  }

  function atualizarFab() {
    const bar = $('cart-bar');
    const qtd = qtdTotalCarrinho();
    if (qtd === 0) {
      bar.classList.remove('aberta');
    } else {
      bar.classList.add('aberta');
      $('fab-qtd').textContent = qtd;
      $('fab-qtd-label').textContent = qtd === 1 ? '1 item' : `${qtd} itens`;
      $('fab-total').textContent = fmtBRL(totalCarrinho());
    }
  }

  function atualizarModal() {
    const itensDiv = $('modal-itens');
    itensDiv.innerHTML = '';
    carrinho.forEach(({ produto, qtd }) => {
      const preco = produto.precoFinal ?? produto.preco;
      const div = document.createElement('div');
      div.className = 'modal-item';
      const promoTag = produto.promocao
        ? ` <span style="color:var(--vermelho);display:inline-flex;vertical-align:middle;">${icon('tag', { size: 12 })}</span>`
        : '';
      div.innerHTML = `
        <div class="modal-item-nome">${esc(produto.nome)}${promoTag}<br>
          <span style="font-size:0.8rem;color:var(--cinza);">${fmtBRL(preco)} cada</span>
        </div>
        <div class="modal-item-ctrl">
          <button class="btn-qtd btn-menos" data-mid="${produto.id}" aria-label="Diminuir">${icon('minus', { size: 18 })}</button>
          <span class="qtd-display">${qtd}</span>
          <button class="btn-qtd btn-mais" data-mid="${produto.id}" aria-label="Aumentar">${icon('plus', { size: 18 })}</button>
        </div>
        <div style="font-weight:700;min-width:64px;text-align:right;">${fmtBRL(preco * qtd)}</div>
      `;
      div.querySelector(`[data-mid="${produto.id}"].btn-mais`).onclick = () => { adicionar(produto); atualizarModal(); };
      div.querySelector(`[data-mid="${produto.id}"].btn-menos`).onclick = () => { remover(produto.id); };
      itensDiv.appendChild(div);
    });
    $('modal-total-val').textContent = fmtBRL(totalCarrinho());
  }

  function fecharModal() { $('modal-overlay').classList.remove('aberto'); }

  $('btn-fechar-modal').onclick = fecharModal;
  $('btn-limpar').onclick = limparCarrinho;
  $('fab-carrinho').onclick = () => {
    atualizarModal();
    $('modal-overlay').classList.add('aberto');
    $('alerta-modal').classList.add('hidden');
    if (conferir) mostrarAvisoConferir();
    atualizarProdutos();   // confere preco/estoque antes de fechar a conta
  };
  $('modal-overlay').onclick = (e) => { if (e.target === $('modal-overlay')) fecharModal(); };

  const onKey = (e) => {
    if (e.key === 'Escape' && $('modal-overlay').classList.contains('aberto')) fecharModal();
  };
  document.addEventListener('keydown', onKey);
  limpezas.push(() => document.removeEventListener('keydown', onKey));

  // ── Sucesso ───────────────────────────────────────
  function mostrarSucesso({ total, saldoFinal, jaRegistrada }) {
    fecharModal();
    const idCurto = (vendaId || '').slice(-6).toUpperCase();
    $('sucesso-titulo').textContent = jaRegistrada
      ? `Venda #${idCurto} já estava registrada`
      : `Venda #${idCurto} registrada`;
    $('sucesso-total').textContent = fmtBRL(total);
    $('sucesso-saldo').textContent = fmtBRL(saldoFinal);
    $('venda-sucesso').classList.remove('hidden');
    $('btn-proximo').focus();
    // Tempo suficiente pra ler o saldo final (feedback #3/#6), depois volta pro scanner.
    timerSucesso = setTimeout(() => ctx.fim(), 4000);
  }
  $('btn-proximo').onclick = () => { clearTimeout(timerSucesso); ctx.fim(); };

  function liberarBotaoFinalizar() {
    $('btn-finalizar').disabled = false;
    $('btn-finalizar').innerHTML = `${icon('check', { size: 20 })} Finalizar Venda`;
  }

  function concluir({ total, saldoFinal, jaRegistrada }) {
    pendente.limpar();
    rascunho.limpar();
    if (cliente) { cliente.saldo = saldoFinal; atualizarSaldoExibido(); }
    mostrarSucesso({ total, saldoFinal, jaRegistrada });
  }

  // ── Finalizar ─────────────────────────────────────
  $('btn-finalizar').onclick = async () => {
    if (finalizando) return;
    const alertaModal = $('alerta-modal');
    if (conferir) {
      // Primeiro toque depois de uma mudanca de preco/estoque: so mostra o aviso.
      conferir = false;
      $('alerta-venda').classList.add('hidden');
      mostrarAvisoConferir();
      atualizarModal();
      return;
    }
    if (!cliente) {
      try { await carregarCliente(); } catch (e) { console.warn(e); }
    }
    if (!cliente) {
      alertaModal.textContent = 'Dados do cliente não carregados. Verifique a conexão e tente de novo.';
      alertaModal.className = 'alert alert-danger';
      return;
    }
    if (carrinho.size === 0) {
      alertaModal.textContent = 'Carrinho vazio.';
      alertaModal.className = 'alert alert-warning';
      return;
    }

    const total = totalCarrinho();

    if ((cliente.saldo || 0) < total) {
      alertaModal.textContent = `Saldo insuficiente. Falta ${fmtBRL(total - cliente.saldo)}`;
      alertaModal.className = 'alert alert-danger';
      return;
    }

    finalizando = true;
    ctx.setOcupado(true);
    $('btn-finalizar').disabled = true;
    $('btn-finalizar').innerHTML = '<div class="loader"></div> Processando...';

    // Se o servidor demorar pra confirmar (wifi/3G ruim), avisa o operador
    // que ainda esta aguardando — nao trava nem cancela a transacao.
    const timerLento = setTimeout(() => {
      $('btn-finalizar').innerHTML = '<div class="loader"></div> Conexão lenta — aguardando servidor…';
    }, 5000);

    const idAlvo = cliente.id;            // captura: nao depende de `cliente` apos awaits
    const idVenda = vendaId || (vendaId = doc(collection(db, 'vendas')).id);
    let saldoFinal = null;
    let jaRegistrada = false;
    let falhou = false;

    try {
      // Tentativa anterior sem resposta (rede caiu): confere se ja foi gravada.
      const pend = pendente.ler();
      if (pend && pend.id === idVenda) {
        const snap = await getDoc(doc(db, 'vendas', idVenda));
        if (snap.exists()) {
          clearTimeout(timerLento);
          const v = snap.data();
          const cSnap = await getDoc(doc(db, 'clientes', idAlvo));
          concluir({ total: v.total ?? total, saldoFinal: cSnap.data()?.saldo ?? cliente.saldo, jaRegistrada: true });
          return;
        }
        pendente.limpar();
      }

      pendente.gravar({ colecao: 'vendas', id: idVenda, rotulo: 'Venda', clienteId: idAlvo, total });

      await runTransaction(db, async (tx) => {
        const clienteRef = doc(db, 'clientes', idAlvo);
        const vendaRef = doc(db, 'vendas', idVenda);
        const itensCarrinho = Array.from(carrinho.values());
        const prodRefs = itensCarrinho.map(({ produto }) => doc(db, 'produtos', produto.id));

        // Firestore exige TODOS os reads antes de qualquer write
        const clienteSnap = await tx.get(clienteRef);
        const vendaSnap = await tx.get(vendaRef);
        const prodSnaps = await Promise.all(prodRefs.map(r => tx.get(r)));

        const saldoAtual = clienteSnap.data().saldo || 0;

        // Trava de preco: o carrinho foi montado com um preco que mudou no
        // banco (promocao entrou/saiu). Nada e cobrado; o operador confere o novo total.
        if (!vendaSnap.exists()) {
          itensCarrinho.forEach(({ produto }, i) => {
            const d = prodSnaps[i].data();
            if (d && precoDe(d) !== produto.precoFinal) throw new Error(`PRECO_MUDOU:${produto.nome}`);
          });
        }

        // Idempotencia: a venda ja foi gravada por uma tentativa anterior.
        if (vendaSnap.exists()) {
          jaRegistrada = true;
          saldoFinal = saldoAtual;
          return;
        }
        jaRegistrada = false;

        if (saldoAtual < total) throw new Error('Saldo insuficiente');

        itensCarrinho.forEach(({ produto, qtd }, i) => {
          // `vendidos` sai do mesmo snapshot lido na TX que o estoque: contencao
          // refaz a TX e nenhum incremento se perde. As rules exigem os dois
          // campos mudando juntos, com o mesmo delta.
          const dados = prodSnaps[i].data();
          const estAtual = dados.estoque || 0;
          if (estAtual < qtd) throw new Error(`Estoque insuficiente: ${produto.nome}`);
          tx.update(prodRefs[i], { estoque: estAtual - qtd, vendidos: (Number(dados.vendidos) || 0) + qtd });
        });

        // Captura o saldo final DA TX — o `cliente.saldo` em memoria pode
        // estar stale se alguma recarga aconteceu em paralelo.
        saldoFinal = saldoAtual - total;
        tx.update(clienteRef, { saldo: saldoFinal });

        tx.set(vendaRef, {
          clienteId: idAlvo,
          clienteNome: idAlvo,   // mesmo valor por ora; campo ja existe pra quando tiver nome
          eventoId: eventoAtivo?.id || null,
          eventoNome: eventoAtivo?.nome || null,
          itens: itensCarrinho.map(({ produto, qtd }) => ({
            produtoId: produto.id,
            nome: produto.nome,
            preco: produto.precoFinal ?? produto.preco,
            promocao: produto.promocao || false,
            qtd,
            subtotal: (produto.precoFinal ?? produto.preco) * qtd
          })),
          total,
          operadorId: perfil?.uid || null,
          operadorNome: perfil?.nome || perfil?.email || 'Operador',
          criadoEm: serverTimestamp()
        });
      });

      clearTimeout(timerLento);
      // Estoque local acompanha a venda (cache entre vendas).
      if (!jaRegistrada) {
        carrinho.forEach(({ produto, qtd }) => { produto.estoque = Math.max(0, (produto.estoque ?? 0) - qtd); });
      }
      concluir({ total, saldoFinal, jaRegistrada });
    } catch (err) {
      clearTimeout(timerLento);
      falhou = true;
      vibrar([100, 50, 100]); // padrao de erro

      // Contencao de transacao (varios operadores no mesmo produto) gera
      // FAILED_PRECONDITION ou ABORTED — a venda NAO foi cobrada, so clicar de novo.
      let mensagem;
      const eContencao = err.code === 'failed-precondition'
                      || err.code === 'aborted'
                      || /stored version/i.test(err.message || '');
      const precoMudou = (err.message || '').startsWith('PRECO_MUDOU:');
      const definitivo = eContencao
                      || precoMudou
                      || err.message === 'Saldo insuficiente'
                      || (err.message || '').startsWith('Estoque insuficiente');
      if (precoMudou) {
        mensagem = `O preço de "${err.message.slice('PRECO_MUDOU:'.length)}" mudou. A venda NÃO foi cobrada — confira o novo total e finalize de novo.`;
      } else if (err.message === 'Saldo insuficiente') {
        mensagem = 'Saldo insuficiente pra essa venda.';
      } else if ((err.message || '').startsWith('Estoque insuficiente')) {
        mensagem = err.message + '. Atualize a tela e tente de novo.';
      } else if (eContencao) {
        mensagem = 'Conflito com outra venda simultânea. A venda NÃO foi cobrada — clique Finalizar de novo.';
      } else {
        mensagem = `Sem confirmação do servidor (${err.message}). Pode clicar Finalizar de novo: se a venda já tiver sido registrada, ela NÃO será cobrada duas vezes.`;
      }
      // Erro definitivo: nada foi gravado. Ambiguo: mantem o pendente pra conferir depois.
      if (definitivo) pendente.limpar();
      $('alerta-modal').textContent = mensagem;
      $('alerta-modal').className = 'alert alert-danger';
      liberarBotaoFinalizar();
    } finally {
      finalizando = false;
      ctx.setOcupado(false);
    }
    // Estoque/preco podem ter causado o erro: puxa a versao atual pro operador ver.
    if (falhou) atualizarProdutos(true);
  };

  // ── Carga inicial ─────────────────────────────────
  // Com cache da venda anterior mostra a lista na hora e busca a versao fresca
  // em paralelo; sem cache (1a venda) espera a busca.
  const tinhaCache = !!produtosCache;
  const precisaBuscar = !cacheFresco();
  const frescoPromise = precisaBuscar ? buscarProdutos() : Promise.resolve(produtosCache);
  const [eventoRes, clienteRes, produtosRes] = await Promise.allSettled([
    ctx.getEvento(),
    carregarCliente(),
    tinhaCache ? Promise.resolve(produtosCache) : frescoPromise
  ]);
  if (!ativo) { frescoPromise.catch(() => {}); return { desmontar() {} }; }

  eventoAtivo = eventoRes.status === 'fulfilled' ? eventoRes.value : null;
  if (clienteRes.status === 'rejected') {
    console.warn('[venda] falha ao carregar cliente:', clienteRes.reason);
    mostrarAlerta('Não consegui carregar o cliente. Verifique a conexão.', 'danger');
  }

  const cont = $('produtos-container');
  if (produtosRes.status === 'rejected') {
    cont.innerHTML = `<div class="empty-state">${icon('alert-triangle', { size: 32 })}<p>Não consegui carregar os produtos.</p></div>`;
  } else if (produtosRes.value.length === 0) {
    cont.innerHTML = `<div class="empty-state">${icon('package', { size: 32 })}<p>Nenhum produto cadastrado.</p></div>`;
  } else {
    produtos = produtosRes.value;
    restaurarRascunho();
    if (avisoInicial) mostrarAlerta(avisoInicial[0], avisoInicial[1], 4000);
    renderizarCategorias();
    renderizarProdutos();
    atualizarFab();
  }

  if (tinhaCache && precisaBuscar) {
    // troca pela versao fresca assim que chegar (re-render + aviso se o carrinho mudou)
    frescoPromise
      .then(novos => { if (ativo && !finalizando) aplicarProdutos(novos); })
      .catch(e => console.warn('[venda] usando produtos da venda anterior:', e));
  }

  return {
    desmontar() {
      ativo = false;
      clearTimeout(timerSucesso);
      clearTimeout(avisoTimer);
      limpezas.forEach(fn => { try { fn(); } catch (_) {} });
      carrinho.clear();
    }
  };
}
