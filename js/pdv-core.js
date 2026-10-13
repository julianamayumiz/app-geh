// ============================================================
// PDV de pagina unica — motor compartilhado (operador e caixa)
// ============================================================
//
// Mantem scanner, venda/recarga e consulta no MESMO documento, trocando
// so o conteudo (sem location.href). Assim a camera fica viva entre uma
// leitura e outra, o Firebase/App Check inicializam uma vez so e o navegador
// nao pede permissao da camera de novo.
//
// Rotas (hash):  #/scan?acao=x   #/<view>/<clienteId>
//
// Cada view e um modulo com:
//   export async function montar(container, ctx) -> { desmontar() }
// ctx: { clienteId, perfil, getEvento(), rascunho, pendente, setOcupado(bool),
//        voltar() }
//
// Persistencia (localStorage, TTL) pra nao perder nada em reload/crash:
//   rascunho  -> carrinho/valor em edicao
//   pendente  -> operacao financeira enviada e ainda sem resposta; no proximo
//                boot confere no Firestore se foi registrada.
// ============================================================

import { db, doc, getDoc } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import { iniciarScanner } from './scanner.js';
import { confirmarAsync } from './ui.js';

const TTL_RASCUNHO_MS = 2 * 60 * 60 * 1000;
const IDLE_CAMERA_MS = 90 * 1000;
const RECARGA_APOS_MS = 6 * 60 * 60 * 1000;

// localStorage pode lancar (modo privado agressivo): nunca derruba o fluxo.
export function armazenar(chave, ttlMs = TTL_RASCUNHO_MS) {
  return {
    ler() {
      try {
        const v = JSON.parse(localStorage.getItem(chave) || 'null');
        if (!v || (ttlMs && Date.now() - (v.ts || 0) > ttlMs)) return null;
        return v;
      } catch { return null; }
    },
    gravar(obj) {
      try { localStorage.setItem(chave, JSON.stringify({ ...obj, ts: Date.now() })); } catch {}
    },
    limpar() {
      try { localStorage.removeItem(chave); } catch {}
    }
  };
}

const enc = encodeURIComponent;

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [caminho, query = ''] = h.split('?');
  const [nome = '', arg = ''] = caminho.split('/');
  let id = '';
  try { id = decodeURIComponent(arg); } catch { id = arg; }
  return { nome, id, params: new URLSearchParams(query) };
}

/**
 * cfg:
 *   papel            'operador' | 'caixa'
 *   hubUrl           pagina inicial do papel (botao voltar na tela de scan)
 *   acoes            { vender: { titulo, view }, consultar: { titulo, view } }
 *   views            { venda: () => import(...), consulta: () => import(...) }
 *   chave            prefixo das chaves de storage (ex.: 'operador')
 *   rascunhoBanner   (rascunho) => { texto, hash } | null  (opcional)
 */
export async function iniciarPdv(cfg) {
  const $ = (id) => document.getElementById(id);
  const el = {
    scan: $('pdv-scan'), conteudo: $('pdv-conteudo'), titulo: $('pdv-titulo'),
    voltar: $('pdv-voltar'), status: $('status-texto'), alerta: $('alerta'),
    dica: $('dica-scan'), banner: $('pdv-banner'),
    btnManual: $('btn-manual'), formManual: $('manual-form'), idManual: $('id-manual'),
    btnCamera: $('btn-reiniciar-camera')
  };

  const rascunho = armazenar(`pdv-rascunho-${cfg.chave}`);
  const pendente = armazenar(`pdv-pendente-${cfg.chave}`, 24 * 60 * 60 * 1000);

  const acaoPadrao = Object.keys(cfg.acoes)[0];
  let acao = acaoPadrao;
  let perfil = null;
  let authOk = false;
  let qrPendente = null;
  let handle = null;
  let viewAtual = null;       // { nome, desmontar }
  let renderSeq = 0;
  let ocupados = 0;
  let idleTimer = null;
  let ultimoScan = { texto: '', quando: 0 };
  const inicio = Date.now();

  // O service worker consulta isso antes de recarregar a pagina sozinho.
  window.pdvOcupado = () => ocupados > 0;

  // ── Scanner ──────────────────────────────────────────────
  function statusScan(txt, cor) {
    el.status.textContent = txt;
    el.status.style.color = cor || '';
  }

  // Mensagem dentro da tela de scan (sem notificacao flutuante). ms=0 deixa fixa
  // ate a proxima mensagem.
  let avisoTimer = null;
  function avisoScan(texto, tipo = 'info', ms = 6000) {
    clearTimeout(avisoTimer);
    el.alerta.textContent = texto;
    el.alerta.className = `alert alert-${tipo} mt-2`;
    if (ms > 0) avisoTimer = setTimeout(() => el.alerta.classList.add('hidden'), ms);
  }

  async function abrirCamera() {
    el.btnCamera?.classList.add('hidden');
    try {
      handle = await iniciarScanner({
        elementId: 'reader',
        manterAberta: true,
        onDetected: aoLer,
        onReady: () => statusScan('Câmera pronta - Aproxime o QR code', 'var(--azul)'),
        onProblema: () => {
          statusScan('Câmera parou', 'var(--vermelho)');
          el.btnCamera?.classList.remove('hidden');
        }
      });
    } catch (err) {
      console.error('Erro ao iniciar scanner:', err);
      el.alerta.textContent = 'Não consegui acessar a câmera. Use o botão abaixo para digitar o ID.';
      el.alerta.className = 'alert alert-warning mt-2';
      el.dica.style.display = 'none';
      statusScan('Câmera indisponível', 'var(--vermelho)');
      el.btnCamera?.classList.remove('hidden');
      handle = null;
    }
  }

  if (el.btnCamera) {
    el.btnCamera.onclick = async () => {
      el.alerta.className = 'alert hidden';
      statusScan('Abrindo câmera…');
      if (handle) { await handle.retomar(); statusScan('Câmera pronta - Aproxime o QR code', 'var(--azul)'); }
      else await garantirCamera();
    };
  }

  // Uma abertura por vez; so abre a camera quando a rota e a de scan.
  let cameraPromise = null;
  function garantirCamera() {
    if (!cameraPromise) cameraPromise = abrirCamera().finally(() => { cameraPromise = null; });
    return cameraPromise;
  }

  // Camera abre EM PARALELO com a checagem de auth (como antes).
  const rotaInicial = parseHash().nome;
  if (!rotaInicial || rotaInicial === 'scan') garantirCamera();

  function aoLer(texto) {
    const agora = Date.now();
    // Anti leitura dupla: mesmo QR em menos de 1,5s e ignorado.
    if (texto === ultimoScan.texto && agora - ultimoScan.quando < 1500) { handle?.retomar(); return; }
    ultimoScan = { texto, quando: agora };
    if (!authOk) { qrPendente = texto; return; }
    usarId(texto);
  }

  async function usarId(bruto) {
    const id = (bruto || '').trim();
    if (!id || id.includes('/')) {
      avisoScan('QR inválido. Tente de novo.', 'danger', 4000);
      handle?.retomar();
      return;
    }
    el.status.textContent = '✓ QR code detectado!';
    el.status.style.color = 'var(--verde)';
    try { navigator.vibrate?.(40); } catch {}

    const a = cfg.acoes[acao] || cfg.acoes[acaoPadrao];
    // Carrinho de outro cliente em andamento: nao descarta sem perguntar.
    const r = rascunho.ler();
    if (a.view === cfg.viewComRascunho && r && r.clienteId && r.clienteId !== id && r.temItens) {
      const ok = await confirmarAsync(
        `Há uma operação em andamento para ${r.clienteId}. Descartar e continuar com ${id}?`,
        { destrutivo: true, textoOk: 'Descartar' }
      );
      if (!ok) { statusScan('Câmera pronta - Aproxime o QR code', 'var(--azul)'); handle?.retomar(); return; }
      rascunho.limpar();
    }
    ir(`#/${a.view}/${enc(id)}`);
  }

  // ── Navegacao ────────────────────────────────────────────
  function ir(hash, { replace = false } = {}) {
    if (replace) history.replaceState(history.state, '', hash);
    else history.pushState({ n: (history.state?.n || 0) + 1 }, '', hash);
    render();
  }

  function voltarParaScan() {
    if ((history.state?.n || 0) > 0) history.back();
    else ir(`#/scan?acao=${enc(acao)}`, { replace: true });
  }

  window.addEventListener('popstate', () => render());

  el.voltar.addEventListener('click', (e) => {
    const n = parseHash().nome;
    if (n === 'inicio') return;          // link normal pra pagina inicial do app
    e.preventDefault();
    if (n === 'scan') ir('#/inicio', { replace: true });
    else voltarParaScan();
  });

  async function desmontarView() {
    const v = viewAtual;
    viewAtual = null;
    if (v) { try { await v.desmontar?.(); } catch (e) { console.warn('[pdv] desmontar:', e); } }
    el.conteudo.replaceChildren();
  }

  function mostrarBanner() {
    if (!el.banner) return;
    const r = cfg.rascunhoBanner?.(rascunho.ler());
    if (!r) { el.banner.classList.add('hidden'); el.banner.replaceChildren(); return; }
    el.banner.classList.remove('hidden');
    el.banner.replaceChildren();
    const txt = document.createElement('span');
    txt.textContent = r.texto;
    const bCont = document.createElement('button');
    bCont.type = 'button'; bCont.className = 'btn btn-primary'; bCont.textContent = 'Continuar';
    bCont.onclick = () => ir(r.hash);
    const bDesc = document.createElement('button');
    bDesc.type = 'button'; bDesc.className = 'btn btn-secondary'; bDesc.textContent = 'Descartar';
    bDesc.onclick = async () => {
      if (await confirmarAsync('Descartar a operação em andamento?', { destrutivo: true, textoOk: 'Descartar' })) {
        rascunho.limpar(); mostrarBanner();
      }
    };
    el.banner.append(txt, bCont, bDesc);
  }

  async function render() {
    if (!authOk) return;   // renderiza assim que o auth confirmar
    const meu = ++renderSeq;
    const rota = parseHash();

    if (!rota.nome) { history.replaceState(history.state, '', '#/inicio'); return render(); }

    if (rota.nome === 'scan') {
      const pedida = rota.params.get('acao');
      if (pedida && cfg.acoes[pedida]) acao = pedida;
      const a = cfg.acoes[acao];
      clearTimeout(idleTimer);
      await desmontarView();
      if (meu !== renderSeq) return;
      // Higiene de memoria: apos horas de uso, recarrega quando ocioso e sem nada em andamento.
      if (Date.now() - inicio > RECARGA_APOS_MS && !rascunho.ler() && !pendente.ler() && ocupados === 0) {
        location.reload(); return;
      }
      el.titulo.textContent = a.titulo;
      el.voltar.setAttribute('href', '#');
      el.conteudo.classList.add('hidden');
      el.scan.classList.remove('hidden');
      mostrarBanner();
      statusScan('Abrindo câmera…');
      if (handle) await handle.retomar();
      else await garantirCamera();
      if (meu !== renderSeq) return;
      if (handle) statusScan('Câmera pronta - Aproxime o QR code', 'var(--azul)');
      return;
    }

    const loader = cfg.views[rota.nome];
    if (!loader || (!rota.id && rota.nome !== 'inicio')) { ir('#/inicio', { replace: true }); return; }

    handle?.pausar();
    el.scan.classList.add('hidden');
    el.conteudo.classList.remove('hidden');
    el.voltar.setAttribute('href', rota.nome === 'inicio' ? cfg.landingUrl : '#');
    if (rota.nome === 'inicio') mostrarBanner(); else el.banner?.classList.add('hidden');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { handle?.liberar(); }, IDLE_CAMERA_MS);

    await desmontarView();
    if (meu !== renderSeq) return;
    try {
      const mod = await loader();
      if (meu !== renderSeq) return;
      const ctx = {
        clienteId: rota.id,
        perfil,
        opcoes: cfg.opcoes || {},
        rascunho,
        pendente,
        voltar: voltarParaScan,
        fim: () => ir('#/inicio', { replace: true }),
        ir: (h) => ir(h),
        cfgInicio: cfg.inicio,
        setOcupado: (b) => { ocupados = Math.max(0, ocupados + (b ? 1 : -1)); },
        getEvento: () => getDoc(doc(db, 'config', 'eventoAtivo'))
          .then(s => s.exists() ? s.data() : null)
          .catch(e => { console.warn('[pdv] falha ao ler eventoAtivo:', e); return null; }),
        setTitulo: (t) => { el.titulo.textContent = t; }
      };
      const v = await mod.montar(el.conteudo, ctx);
      if (meu !== renderSeq) { await v?.desmontar?.(); el.conteudo.replaceChildren(); return; }
      viewAtual = { nome: rota.nome, desmontar: v?.desmontar };
    } catch (err) {
      console.error('[pdv] erro ao montar view:', err);
      voltarParaScan();
      avisoScan('Erro ao abrir a tela. Tente de novo.', 'danger', 0);
    }
  }

  // ── Operacao pendente (app fechou no meio de uma transacao) ──
  async function reconciliarPendente() {
    const p = pendente.ler();
    if (!p) return;
    try {
      const snap = await getDoc(doc(db, p.colecao, p.id));
      if (snap.exists()) {
        avisoScan(`${p.rotulo} registrada (recuperada) — ${p.clienteId}`, 'success', 0);
        const r = rascunho.ler();
        if (r && r.opId === p.id) rascunho.limpar();
      } else {
        avisoScan(`A última ${p.rotulo.toLowerCase()} NÃO foi registrada. Os dados foram mantidos.`, 'danger', 0);
      }
      pendente.limpar();
    } catch (e) {
      console.warn('[pdv] nao consegui conferir pendente (tenta no proximo boot):', e);
    }
  }

  // ── Entrada manual de ID ─────────────────────────────────
  el.btnManual.onclick = () => {
    el.formManual.classList.toggle('hidden');
    if (!el.formManual.classList.contains('hidden')) el.idManual.focus();
  };
  const enviarManual = () => {
    const id = el.idManual.value.trim();
    if (!id) { avisoScan('Digite um ID', 'warning', 3000); return; }
    el.idManual.value = '';
    el.formManual.classList.add('hidden');
    usarId(id);
  };
  $('btn-manual-ok').onclick = enviarManual;
  el.idManual.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarManual(); });

  // ── Boot ─────────────────────────────────────────────────
  const auth = await requireAuth({ papel: cfg.papel });
  perfil = auth.perfil;
  authOk = true;
  reconciliarPendente();   // nao bloqueia a tela
  await render();
  if (qrPendente) { const t = qrPendente; qrPendente = null; usarId(t); }
}
