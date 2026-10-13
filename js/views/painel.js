// ============================================================
// View "painel" do PDV (operador) — vendido x planejado por produto
// ============================================================
// Le so `produtos` (~30 docs): estoque (restante), vendidos (contador gravado
// na TX de venda) e estoquePlanejado (admin). Calculos em js/painel-calc.js.
//
// Atualizacao (nunca os dois ao mesmo tempo - ver parar()/iniciar*):
//  - manual (padrao): getDocs ao abrir, ao voltar a aba (se > 60 s) e no botao;
//  - ao vivo: onSnapshot enquanto a aba esta visivel; desliga sozinho em 15 min.
// Frescor honesto: so dado vindo do servidor (nao do cache) conta como
// "atualizado". Em erro/offline os ultimos dados ficam na tela, esmaecidos e
// com aviso. Favoritos/busca/abas/filtros sao 100% locais (zero leituras).
// ============================================================

import { db, collection, getDocs, onSnapshot } from '../firebase-config.js';
import { icon, renderIcons } from '../icons.js';
import { esc } from '../helpers.js';
import {
  analisarProduto, resumo, agrupar, soFavoritos, frescor, assinatura, ST
} from '../painel-calc.js';

const FAV_KEY = 'pdv.painel.favoritos';
const REFRESH_AO_VOLTAR_MS = 60000;
const LIVE_MAX_MS = 15 * 60 * 1000;
const TICK_MS = 20000;

const STATUS_UI = {
  [ST.OK]:       { rot: 'Tranquilo',     ic: 'check-circle',  cls: 'ok' },
  [ST.ACABANDO]: { rot: 'Acabando',      ic: 'alert-triangle', cls: 'baixo' },
  [ST.ESGOTADO]: { rot: 'Esgotado',      ic: 'x-circle',      cls: 'fim' },
  [ST.INVALIDO]: { rot: 'Dado inválido', ic: 'alert-triangle', cls: 'inv' }
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtHora = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function lerFavoritos() {
  try {
    const arr = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function salvarFavoritos(set) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch { /* sem storage: so nao persiste */ }
}

const TEMPLATE = `
  <div class="pn">
    <div class="pn-topo">
      <div class="pn-fresco" id="pn-fresco" role="status" aria-live="polite"></div>
      <div class="pn-acoes">
        <button type="button" class="pn-btn" id="pn-live" aria-pressed="false">
          <span class="pn-dot" aria-hidden="true"></span>Ao vivo
        </button>
        <button type="button" class="pn-btn" id="pn-refresh" aria-label="Atualizar agora">
          <span data-icon="refresh-cw" data-size="16"></span><span class="pn-btn-txt">Atualizar</span>
        </button>
      </div>
    </div>
    <div id="pn-banner"></div>
    <div id="pn-resumo"></div>
    <div class="pn-abas" id="pn-abas" role="tablist" aria-label="Visão do painel"></div>
    <div class="busca-wrapper">
      <span class="busca-icon" data-icon="search" data-size="18"></span>
      <label for="pn-busca" class="sr-only">Buscar produto</label>
      <input type="search" id="pn-busca" placeholder="Buscar produto..." autocomplete="off">
      <button type="button" class="busca-clear" id="pn-busca-clear" aria-label="Limpar busca"><span data-icon="x" data-size="16"></span></button>
    </div>
    <div id="pn-cats" class="cat-bar" aria-label="Filtro de categorias"></div>
    <div id="pn-lista" aria-live="off">
      <div class="pn-card"><span class="skel skel-text" style="width:55%"></span><span class="skel skel-text" style="width:35%"></span><span class="skel skel-text" style="width:100%"></span></div>
      <div class="pn-card"><span class="skel skel-text" style="width:50%"></span><span class="skel skel-text" style="width:30%"></span><span class="skel skel-text" style="width:100%"></span></div>
    </div>
  </div>`;

export async function montar(container, ctx) {
  ctx.setTitulo('Painel de vendas');
  container.innerHTML = TEMPLATE;
  renderIcons(container);

  const $ = (id) => container.querySelector(`#${id}`);

  // ---- estado ----
  let analises = [];
  let sig = null;
  let favoritos = lerFavoritos();
  let aba = null;              // 'fav' | 'atencao' | 'todos' (definida no 1o dado)
  let busca = '';
  let categoria = 'Todas';
  let modo = 'manual';         // 'manual' | 'live'
  let ultimaServidor = 0;
  let erro = null;             // Error | null
  let offline = false;
  let avisoLive = '';          // por que o ao vivo desligou
  let liveSuspenso = false;    // ao vivo pausado porque a aba ficou oculta
  let buscando = false;
  let ativo = true;
  let unsub = null;
  let liveTimer = null;
  let cacheTimer = null;       // carencia antes de chamar de "offline" (1o snapshot vem do cache)

  // ---- controle de atualizacao: um mecanismo por vez ----
  function parar() {
    if (unsub) { try { unsub(); } catch { /* ja encerrado */ } unsub = null; }
    clearTimeout(liveTimer); liveTimer = null;
    clearTimeout(cacheTimer); cacheTimer = null;
  }

  // Snapshot do servidor = atual. Do cache = so vira "offline" se persistir
  // alguns segundos (o 1o snapshot do listener costuma vir do cache).
  function marcarServidor() {
    clearTimeout(cacheTimer); cacheTimer = null;
    offline = false; erro = null; ultimaServidor = Date.now();
  }
  function marcarCache() {
    if (offline || cacheTimer) return;
    cacheTimer = setTimeout(() => { cacheTimer = null; offline = true; renderTopo(); renderBanner(); }, 4000);
  }

  function aplicarDocs(docs) {
    analises = docs.map(d => analisarProduto({ id: d.id, ...d.data() }));
    if (aba === null) aba = favoritos.size > 0 ? 'fav' : 'todos';
    const nova = assinatura(analises);
    if (nova !== sig) { sig = nova; renderDados(); }
  }

  async function carregarManual() {
    if (!ativo || buscando) return;
    parar();
    modo = 'manual';
    buscando = true;
    renderTopo();
    try {
      const snap = await getDocs(collection(db, 'produtos'));
      if (!ativo) return;
      if (snap.metadata.fromCache) { offline = true; }
      else marcarServidor();
      aplicarDocs(snap.docs);
    } catch (e) {
      if (!ativo) return;
      console.warn('[painel] falha ao ler produtos:', e);
      erro = e;
    } finally {
      buscando = false;
      if (ativo) { renderTopo(); renderBanner(); renderEstadoVazio(); }
    }
  }

  function iniciarLive() {
    if (!ativo) return;
    parar();
    modo = 'live';
    avisoLive = '';
    liveSuspenso = false;
    liveTimer = setTimeout(() => {
      parar(); modo = 'manual';
      avisoLive = 'Ao vivo desligado após 15 minutos para poupar leituras. Ligue de novo se precisar.';
      renderTopo(); renderBanner();
    }, LIVE_MAX_MS);
    unsub = onSnapshot(collection(db, 'produtos'), { includeMetadataChanges: true },
      (snap) => {
        if (!ativo) return;
        if (snap.metadata.fromCache) marcarCache(); else marcarServidor();
        aplicarDocs(snap.docs);
        renderTopo(); renderBanner();
      },
      (e) => {
        if (!ativo) return;
        console.warn('[painel] listener caiu:', e);
        parar(); modo = 'manual'; erro = e;
        avisoLive = 'O modo ao vivo caiu. Os dados abaixo podem estar desatualizados.';
        renderTopo(); renderBanner(); renderEstadoVazio();
      });
    renderTopo(); renderBanner();
  }

  // ---- render: topo / banner / resumo ----
  function estadoFrescor() {
    return frescor({ modo, ultimaServidor, erro, offline, agora: Date.now() });
  }

  function textoFresco() {
    if (!ultimaServidor) return buscando ? 'Carregando…' : 'Sem dados ainda';
    const seg = Math.round((Date.now() - ultimaServidor) / 1000);
    if (modo === 'live' && !offline && !erro) return `Ao vivo - confirmado às ${fmtHora(ultimaServidor)}`;
    if (seg < 45) return 'Atualizado agora';
    if (seg < 3600) return `Atualizado há ${Math.max(1, Math.round(seg / 60))} min (${fmtHora(ultimaServidor)})`;
    return `Atualizado às ${fmtHora(ultimaServidor)}`;
  }

  function renderTopo() {
    const f = estadoFrescor();
    const el = $('pn-fresco');
    el.textContent = textoFresco();
    el.classList.toggle('antigo', f.antigo && !!ultimaServidor);
    const live = $('pn-live');
    live.setAttribute('aria-pressed', String(modo === 'live'));
    live.classList.toggle('on', modo === 'live');
    $('pn-refresh').disabled = buscando || modo === 'live';
    $('pn-lista').classList.toggle('pn-antigo', f.antigo && !!ultimaServidor);
    $('pn-resumo').classList.toggle('pn-antigo', f.antigo && !!ultimaServidor);
  }

  function renderBanner() {
    const f = estadoFrescor();
    const hora = ultimaServidor ? fmtHora(ultimaServidor) : null;
    let msg = '';
    if (erro) msg = avisoLive || (hora ? `Não foi possível atualizar. Mostrando dados de ${hora}.` : 'Não foi possível carregar os produtos.');
    else if (offline) msg = hora ? `Sem conexão com o servidor. Os dados de ${hora} podem estar desatualizados.` : 'Sem conexão com o servidor.';
    else if (f.antigo && f.motivo === 'velho') msg = `Dados de ${hora}. Toque em Atualizar para ver os valores de agora.`;
    else if (avisoLive) msg = avisoLive;
    const box = $('pn-banner');
    if (!msg) { box.innerHTML = ''; return; }
    const grave = !!erro || offline;
    box.innerHTML = `
      <div class="pn-banner ${grave ? 'grave' : ''}" role="alert">
        <span class="pn-banner-ic">${icon('alert-triangle', { size: 18 })}</span>
        <span class="pn-banner-tx">${esc(msg)}</span>
        <button type="button" class="pn-btn" id="pn-retry">Tentar de novo</button>
      </div>`;
    $('pn-retry').onclick = () => { avisoLive = ''; if (modo === 'live') iniciarLive(); else carregarManual(); };
  }

  function renderResumo() {
    const r = resumo(analises);
    const C = 2 * Math.PI * 30;
    const dash = r.pct == null ? 0 : (r.pct / 100) * C;
    const notas = [];
    if (r.semPlanejado) notas.push(`${r.semPlanejado} sem planejado fora do total`);
    if (r.invalidos) notas.push(`${r.invalidos} com dado inválido`);
    $('pn-resumo').innerHTML = `
      <div class="pn-resumo">
        <svg class="pn-anel" width="84" height="84" viewBox="0 0 84 84" role="img" aria-label="${r.pct == null ? 'Sem planejado' : r.pct + ' por cento vendido do planejado'}">
          <circle cx="42" cy="42" r="30" class="pn-anel-fundo" fill="none" stroke-width="9"/>
          <circle cx="42" cy="42" r="30" class="pn-anel-val" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 42 42)"/>
          <text x="42" y="47" text-anchor="middle" class="pn-anel-tx">${r.pct == null ? '—' : r.pct + '%'}</text>
        </svg>
        <div class="pn-resumo-tx">
          <div class="pn-rot">Vendido do planejado</div>
          <div class="pn-grande">${r.planejado > 0 ? `${r.vendidos} <span>de ${r.planejado}</span>` : '—'}</div>
          <div class="pn-rot">${r.planejado > 0 ? `Em estoque: ${r.emEstoque}` : 'Defina o planejado no cadastro do produto'}</div>
          ${notas.length ? `<div class="pn-nota">${esc(notas.join(' · '))}</div>` : ''}
        </div>
      </div>`;
  }

  // ---- render: abas / categorias / lista ----
  function renderAbas() {
    const criticos = analises.filter(a => a.critico).length;
    const defs = [
      { id: 'fav',     rot: 'Favoritos', n: favoritos.size ? analises.filter(a => favoritos.has(a.id)).length : 0 },
      { id: 'atencao', rot: 'Atenção',   n: criticos, alerta: criticos > 0 },
      { id: 'todos',   rot: 'Todos',     n: analises.length }
    ];
    $('pn-abas').innerHTML = defs.map(d => `
      <button type="button" role="tab" class="pn-aba ${aba === d.id ? 'ativa' : ''}" data-aba="${d.id}" aria-selected="${aba === d.id}">
        ${d.rot}<span class="pn-cont ${d.alerta ? 'alerta' : ''}">${d.n}</span>
      </button>`).join('');
  }

  function renderCats() {
    const cats = ['Todas', ...[...new Set(analises.map(a => a.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'))];
    if (!cats.includes(categoria)) categoria = 'Todas';
    $('pn-cats').innerHTML = cats.length > 2
      ? cats.map(c => `<button type="button" class="cat-chip ${c === categoria ? 'ativo' : ''}" data-cat="${esc(c)}" aria-pressed="${c === categoria}">${esc(c)}</button>`).join('')
      : '';
  }

  const passaFiltro = (a) =>
    (categoria === 'Todas' || a.categoria === categoria) &&
    (!busca || norm(a.nome).includes(busca));

  function estrela(a) {
    const on = favoritos.has(a.id);
    return `<button type="button" class="pn-star ${on ? 'on' : ''}" data-fav="${esc(a.id)}" aria-pressed="${on}" aria-label="${on ? 'Remover' : 'Adicionar'} ${esc(a.nome)} ${on ? 'dos' : 'aos'} favoritos">${icon('star', { size: 20 })}</button>`;
  }

  function cartao(a) {
    const ui = STATUS_UI[a.status];
    const vend = a.vendidos == null ? '—' : a.vendidos;
    const barra = a.planejado
      ? `<div class="pn-barra" role="img" aria-label="${a.pct}% do planejado vendido"><i class="${ui.cls}" style="width:${a.pct}%"></i></div>`
      : '';
    const selos = [];
    if (a.acima) selos.push('<span class="pn-selo">Acima do planejado</span>');
    if (!a.planejado && a.status !== ST.INVALIDO) selos.push('<span class="pn-selo">Sem planejado</span>');
    return `
      <div class="pn-card ${a.critico ? 'crit-' + ui.cls : ''}">
        <div class="pn-card-hd">
          ${estrela(a)}
          <span class="pn-nome">${esc(a.nome)}</span>
          <span class="pn-st ${ui.cls}">${icon(ui.ic, { size: 14 })}${ui.rot}</span>
        </div>
        <div class="pn-num"><b>${vend}</b><span>${a.planejado ? `de ${a.planejado} vendidos` : 'vendidos'}</span></div>
        ${barra}
        <div class="pn-card-ft">
          <span>${a.pct == null ? '' : a.pct + '%'}${selos.length ? ' ' + selos.join(' ') : ''}</span>
          <span class="pn-rest">${a.estoque == null ? 'Estoque inválido' : `Restam ${a.estoque}`}</span>
        </div>
      </div>`;
  }

  function linha(a) {
    const ui = STATUS_UI[a.status];
    const vend = a.vendidos == null ? '—' : a.vendidos;
    return `
      <div class="pn-linha">
        ${estrela(a)}
        <span class="pn-nome">${esc(a.nome)}</span>
        ${a.planejado ? `<span class="pn-mini" aria-hidden="true"><i class="${ui.cls}" style="width:${a.pct}%"></i></span>` : '<span class="pn-mini vazio" aria-hidden="true"></span>'}
        <span class="pn-linha-v">${vend}${a.planejado ? '/' + a.planejado : ''}</span>
        <span class="pn-linha-r">${a.estoque == null ? '—' : a.estoque}</span>
      </div>`;
  }

  const secao = (titulo, ic, html) => html ? `<div class="pn-sec">${ic ? icon(ic, { size: 15 }) : ''}${titulo}</div>${html}` : '';
  const vazio = (txt) => `<div class="empty-state"><p>${txt}</p></div>`;

  function renderLista() {
    const filtrados = analises.filter(passaFiltro);
    let html = '';
    if (aba === 'fav') {
      const lista = soFavoritos(filtrados, favoritos);
      html = lista.length
        ? lista.map(cartao).join('')
        : vazio(favoritos.size
          ? 'Nenhum favorito neste filtro.'
          : 'Toque na estrela de um produto, na aba Todos, para acompanhá-lo aqui.');
    } else if (aba === 'atencao') {
      const crit = agrupar(filtrados, favoritos).criticos;
      html = crit.length ? crit.map(cartao).join('') : vazio('Nenhum produto esgotado ou acabando agora.');
    } else {
      const g = agrupar(filtrados, favoritos);
      html = secao('Precisa de atenção', 'alert-triangle', g.criticos.map(cartao).join(''))
        + secao('Favoritos', 'star', g.favoritos.map(cartao).join(''))
        + secao('Outros produtos', null, g.demais.length
          ? `<div class="pn-cab"><span>Produto</span><span class="pn-cab-v">Vend.</span><span class="pn-cab-r">Restam</span></div>${g.demais.map(linha).join('')}`
          : '');
      if (!html) html = vazio('Nenhum produto encontrado.');
    }
    $('pn-lista').innerHTML = html;
  }

  function renderDados() {
    renderResumo(); renderAbas(); renderCats(); renderLista();
  }

  function renderEstadoVazio() {
    // Falha antes de qualquer dado: mostra erro em vez de ficar no esqueleto.
    if (analises.length || !erro) return;
    $('pn-lista').innerHTML = vazio('Não foi possível carregar os produtos. Use "Tentar de novo" acima.');
  }

  // ---- eventos ----
  $('pn-refresh').onclick = () => { avisoLive = ''; carregarManual(); };
  $('pn-live').onclick = () => { if (modo === 'live') { parar(); modo = 'manual'; renderTopo(); renderBanner(); } else iniciarLive(); };

  $('pn-abas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aba]');
    if (!b || b.dataset.aba === aba) return;
    aba = b.dataset.aba; renderAbas(); renderLista();
  });
  $('pn-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    categoria = b.dataset.cat; renderCats(); renderLista();
  });
  $('pn-busca').addEventListener('input', (e) => { busca = norm(e.target.value.trim()); renderLista(); });
  $('pn-busca-clear').addEventListener('click', () => { $('pn-busca').value = ''; busca = ''; renderLista(); $('pn-busca').focus(); });
  $('pn-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    const id = b.dataset.fav;
    if (favoritos.has(id)) favoritos.delete(id); else favoritos.add(id);
    salvarFavoritos(favoritos);
    renderAbas(); renderLista();
  });

  // Um unico handler de visibilidade (removido no desmontar).
  const aoMudarVisibilidade = () => {
    if (!ativo) return;
    if (document.hidden) {
      if (modo === 'live') { parar(); modo = 'manual'; liveSuspenso = true; renderTopo(); }
      return;
    }
    if (liveSuspenso) { iniciarLive(); return; }
    if (modo === 'manual' && Date.now() - ultimaServidor > REFRESH_AO_VOLTAR_MS) carregarManual();
    else { renderTopo(); renderBanner(); }
  };
  document.addEventListener('visibilitychange', aoMudarVisibilidade);

  // Atualiza so o texto de "ha X min" (nao le nada do Firestore).
  const tick = setInterval(() => { if (ativo && !document.hidden) { renderTopo(); renderBanner(); } }, TICK_MS);

  renderTopo();
  carregarManual();

  return {
    desmontar() {
      ativo = false;
      parar();
      clearInterval(tick);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    }
  };
}
