// ============================================================
// View "transferir" do PDV — mover saldo entre dois clientes
// ============================================================
// Fluxo guiado, uma pergunta por tela:
//   (origem lida pelo scan do PDV) -> destino (scan) -> valor -> confirmar
//
// Garantias (mesmas da recarga/venda):
//   - id da transferencia gerado uma vez por rascunho e guardado em
//     localStorage: reload + confirmar de novo NUNCA transfere duas vezes
//   - runTransaction com guarda de idempotencia (transferencia ja existe)
//   - registro "pendente" conferido no proximo boot (pdv-core)
//   - ctx.setOcupado: o service worker nao recarrega no meio da transacao
// ============================================================

import {
  db, doc, getDoc, collection, serverTimestamp, runTransaction
} from '../firebase-config.js';
import { icon } from '../icons.js';
import { fmtBRL, esc } from '../helpers.js';

const ATALHOS = [5, 10, 20];

// Aceita "15", "15,5", "15.50", "1.234,56". Rejeita ambiguos como "1.234".
function parseValor(s) {
  const t = String(s ?? '').replace(/\s/g, '');
  if (!t) return NaN;
  let n;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+[.,]\d{1,2}$/.test(t)) n = Number(t.replace(',', '.'));
  else if (/^\d+$/.test(t)) n = Number(t);
  else return NaN;
  return Math.round(n * 100) / 100;
}

const fmtCampo = (v) => Number(v || 0).toFixed(2).replace('.', ',');

export async function montar(container, ctx) {
  const { clienteId, perfil, rascunho, pendente } = ctx;

  ctx.setTitulo('Transferir saldo');
  container.innerHTML = '<div class="card"><p class="text-center text-muted">Carregando…</p></div>';

  let ativo = true;
  let enviando = false;
  let timerSucesso = null;
  let etapa = 'carregando';
  let origem = null;
  let destino = null;
  let valor = 0;
  let valorTexto = '';
  let motivo = '';
  let motivoAberto = false;
  let aviso = null;          // { msg, tipo }
  let opId = null;
  let eventoAtivo = null;

  const vibrar = (p) => { try { navigator.vibrate?.(p); } catch (_) {} };
  const nome = (c) => esc(c.nome || c.id);
  const novoId = () => doc(collection(db, 'transferencias_saldo')).id;

  // ── Rascunho ───────────────────────────────────────────
  function salvarRascunho() {
    if (!destino) return;
    if (!opId) opId = novoId();
    rascunho.gravar({
      tipo: 'transferir',
      clienteId: origem.id,
      destinoId: destino.id,
      opId,
      eventoId: eventoAtivo?.id || null,
      temItens: true,
      valorTexto,
      motivo
    });
  }

  function limparRascunho() {
    const r = rascunho.ler();
    if (r && r.tipo === 'transferir') rascunho.limpar();
  }

  // ── Telas ──────────────────────────────────────────────
  const progresso = (n) =>
    `<div class="tf-prog" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

  const cardLado = (classe, rotulo, c, extra = '') => `
    <div class="tf-card ${classe}">
      <span class="tf-rot">${rotulo}</span>
      <b>${nome(c)}</b>
      <span>Saldo ${fmtBRL(c.saldo)}</span>${extra}
    </div>`;

  const avisoHtml = () => aviso
    ? `<div class="alert alert-${aviso.tipo}" role="alert">${esc(aviso.msg)}</div>` : '';

  function render() {
    if (!ativo) return;
    if (etapa === 'destino') return renderDestino();
    if (etapa === 'valor') return renderValor();
    if (etapa === 'confirmar') return renderConfirmar();
  }

  function renderDestino() {
    container.innerHTML = `
      <div class="tf">
        ${progresso(2)}
        ${cardLado('tf-o', 'De', origem)}
        <h2 class="tf-tit">Escaneie o QR de quem vai <u>receber</u></h2>
        ${avisoHtml()}
        <button type="button" class="btn btn-success" id="tf-escanear">Escanear QR</button>
        <button type="button" class="btn btn-secondary" id="tf-cancelar">Cancelar</button>
      </div>`;
    container.querySelector('#tf-escanear').onclick = pedirDestino;
    container.querySelector('#tf-cancelar').onclick = () => ctx.voltar();
  }

  function renderValor() {
    container.innerHTML = `
      <div class="tf">
        ${progresso(3)}
        <div class="tf-par">
          <div class="tf-card tf-o"><b>${nome(origem)}</b><span>${fmtBRL(origem.saldo)}</span></div>
          ${icon('arrow-right', { size: 20 })}
          <div class="tf-card tf-d"><b>${nome(destino)}</b><span>${fmtBRL(destino.saldo)}</span></div>
        </div>
        <h2 class="tf-tit"><label for="tf-valor">Quanto transferir?</label></h2>
        ${avisoHtml()}
        <div class="tf-valor-box"><span aria-hidden="true">R$</span>
          <input type="text" id="tf-valor" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(valorTexto)}">
        </div>
        <div class="tf-chips">
          ${ATALHOS.map(v => `<button type="button" class="tf-chip" data-v="${v}">R$ ${v}</button>`).join('')}
          <button type="button" class="tf-chip" data-v="tudo">Tudo</button>
        </div>
        ${motivoAberto
          ? `<div class="form-group"><label for="tf-motivo">Motivo (opcional)</label>
             <input type="text" id="tf-motivo" maxlength="120" autocomplete="off" value="${esc(motivo)}"></div>`
          : '<button type="button" class="tf-link" id="tf-add-motivo">+ adicionar motivo</button>'}
        <button type="button" class="btn btn-success" id="tf-revisar">Revisar</button>
        <button type="button" class="btn btn-secondary" id="tf-trocar">Trocar quem recebe</button>
      </div>`;

    const inp = container.querySelector('#tf-valor');
    inp.addEventListener('input', () => { valorTexto = inp.value; salvarRascunho(); });
    container.querySelectorAll('.tf-chip').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.v === 'tudo' ? origem.saldo : Number(b.dataset.v);
        valorTexto = fmtCampo(v);
        inp.value = valorTexto;
        salvarRascunho();
      };
    });
    const bm = container.querySelector('#tf-add-motivo');
    if (bm) bm.onclick = () => { motivoAberto = true; render(); container.querySelector('#tf-motivo')?.focus(); };
    const im = container.querySelector('#tf-motivo');
    if (im) im.addEventListener('input', () => { motivo = im.value; salvarRascunho(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') revisar(); });
    container.querySelector('#tf-revisar').onclick = revisar;
    container.querySelector('#tf-trocar').onclick = pedirDestino;
    if (!valorTexto) inp.focus();
  }

  function renderConfirmar() {
    const depoisO = origem.saldo - valor;
    const depoisD = destino.saldo + valor;
    container.innerHTML = `
      <div class="tf">
        ${progresso(3)}
        <h2 class="tf-tit">Confira antes de transferir</h2>
        ${avisoHtml()}
        ${cardLado('tf-o', 'De', origem, `<span class="tf-depois">Fica com ${fmtBRL(depoisO)}</span>`)}
        ${cardLado('tf-d', 'Para', destino, `<span class="tf-depois">Fica com ${fmtBRL(depoisD)}</span>`)}
        <div class="tf-total">${fmtBRL(valor)}</div>
        ${motivo ? `<p class="text-center text-muted">Motivo: ${esc(motivo)}</p>` : ''}
        <button type="button" class="btn btn-success" id="tf-confirmar">${icon('check', { size: 18 })} Transferir</button>
        <button type="button" class="btn btn-secondary" id="tf-voltar">Voltar</button>
      </div>
      <div class="venda-sucesso hidden" id="tf-sucesso" role="status" aria-live="polite">
        <div class="venda-sucesso-box">
          <div class="venda-sucesso-ic">${icon('check-circle', { size: 56 })}</div>
          <div class="venda-sucesso-tit" id="tf-suc-tit"></div>
          <div class="venda-sucesso-val" id="tf-suc-val"></div>
          <div class="venda-sucesso-sub" id="tf-suc-sub"></div>
          <button type="button" class="btn btn-primary" id="tf-proximo">Voltar ao início</button>
        </div>
      </div>`;
    container.querySelector('#tf-confirmar').onclick = confirmar;
    container.querySelector('#tf-voltar').onclick = () => { aviso = null; etapa = 'valor'; render(); };
    container.querySelector('#tf-proximo').onclick = () => { clearTimeout(timerSucesso); ctx.fim(); };
    container.querySelector('#tf-confirmar').focus();
  }

  // ── Acoes ──────────────────────────────────────────────
  async function buscarCliente(id) {
    const snap = await getDoc(doc(db, 'clientes', id));
    return snap.exists() ? { id, ...snap.data() } : null;
  }

  async function pedirDestino() {
    aviso = null;
    const id = await ctx.escanear('Transferir: quem recebe');
    if (!ativo) return;
    if (!id) { etapa = destino ? 'valor' : 'destino'; render(); return; }
    if (id === origem.id) {
      aviso = { msg: 'Quem envia e quem recebe não podem ser o mesmo cliente.', tipo: 'warning' };
      etapa = destino ? 'valor' : 'destino'; render(); return;
    }
    container.innerHTML = '<div class="card"><p class="text-center text-muted">Buscando cliente…</p></div>';
    let c = null;
    try { c = await buscarCliente(id); }
    catch (e) {
      console.warn('[transferir] falha ao buscar destino:', e);
      if (!ativo) return;
      aviso = { msg: 'Não consegui buscar o cliente. Verifique a conexão e tente de novo.', tipo: 'danger' };
      etapa = destino ? 'valor' : 'destino'; render(); return;
    }
    if (!ativo) return;
    if (!c) {
      aviso = { msg: `O cliente ${id} não está cadastrado.`, tipo: 'danger' };
      etapa = destino ? 'valor' : 'destino'; render(); return;
    }
    // Destino diferente = transferencia diferente (id novo), salvo se ha uma
    // tentativa anterior sem resposta: ai o id antigo continua protegendo.
    if (destino && destino.id !== c.id && pendente.ler()?.id !== opId) opId = null;
    destino = c;
    vibrar(40);
    salvarRascunho();
    etapa = 'valor';
    render();
  }

  function revisar() {
    const v = parseValor(valorTexto);
    if (!Number.isFinite(v) || v <= 0) {
      aviso = { msg: 'Digite um valor válido, como 12,50.', tipo: 'warning' };
    } else if (v > origem.saldo) {
      aviso = { msg: `Saldo insuficiente: ${origem.nome || origem.id} tem ${fmtBRL(origem.saldo)}.`, tipo: 'danger' };
    } else {
      aviso = null;
      valor = v;
      etapa = 'confirmar';
    }
    render();
  }

  function concluir({ valorFinal, saldoOrigem, jaRegistrada }) {
    pendente.limpar();
    limparRascunho();
    vibrar([40, 60, 40, 60, 80]);
    const idCurto = (opId || '').slice(-6).toUpperCase();
    origem = { ...origem, saldo: saldoOrigem };
    container.querySelector('#tf-suc-tit').textContent = jaRegistrada
      ? `Transferência #${idCurto} já estava registrada`
      : 'Transferência feita';
    container.querySelector('#tf-suc-val').textContent = fmtBRL(valorFinal);
    container.querySelector('#tf-suc-sub').textContent =
      `${origem.nome || origem.id} → ${destino.nome || destino.id} · código #${idCurto}`;
    container.querySelector('#tf-sucesso').classList.remove('hidden');
    container.querySelector('#tf-proximo').focus();
    timerSucesso = setTimeout(() => ctx.fim(), 3000);
  }

  function liberarBotao() {
    const b = container.querySelector('#tf-confirmar');
    if (!b) return;
    b.disabled = false;
    b.innerHTML = `${icon('check', { size: 18 })} Transferir`;
  }

  async function confirmar() {
    if (enviando) return;
    enviando = true;
    ctx.setOcupado(true);
    const btn = container.querySelector('#tf-confirmar');
    btn.disabled = true;
    btn.innerHTML = '<div class="loader"></div> Processando…';
    const timerLento = setTimeout(() => {
      btn.innerHTML = '<div class="loader"></div> Conexão lenta — aguardando servidor…';
    }, 5000);

    // Captura antes dos awaits
    const o = origem, d = destino, v = valor, mot = motivo.trim();
    if (!opId) { opId = novoId(); salvarRascunho(); }
    const idOp = opId;
    let saldoFinalO = null;
    let jaRegistrada = false;

    try {
      // Tentativa anterior sem resposta (rede caiu / reload): confere se gravou.
      const pend = pendente.ler();
      if (pend && pend.id === idOp) {
        const snap = await getDoc(doc(db, 'transferencias_saldo', idOp));
        if (snap.exists()) {
          clearTimeout(timerLento);
          const t = snap.data();
          concluir({ valorFinal: t.valor ?? v, saldoOrigem: t.origemSaldoDepois ?? o.saldo - v, jaRegistrada: true });
          return;
        }
        pendente.limpar();
      }

      pendente.gravar({ colecao: 'transferencias_saldo', id: idOp, rotulo: 'Transferência', clienteId: `${o.id} → ${d.id}`, valor: v });

      await runTransaction(db, async (tx) => {
        const refO = doc(db, 'clientes', o.id);
        const refD = doc(db, 'clientes', d.id);
        const refT = doc(db, 'transferencias_saldo', idOp);
        const [snapO, snapD, snapT] = await Promise.all([tx.get(refO), tx.get(refD), tx.get(refT)]);

        // Idempotencia: ja gravada por uma tentativa anterior.
        if (snapT.exists()) {
          jaRegistrada = true;
          saldoFinalO = snapT.data().origemSaldoDepois;
          return;
        }
        jaRegistrada = false;
        if (!snapO.exists()) throw new Error('Cliente origem não existe.');
        if (!snapD.exists()) throw new Error('Cliente destino não existe.');

        const saldoO = snapO.data().saldo || 0;
        const saldoD = snapD.data().saldo || 0;
        if (saldoO < v) {
          throw new Error(`Saldo insuficiente na origem (tem ${fmtBRL(saldoO)}, precisa ${fmtBRL(v)}).`);
        }
        const novoO = saldoO - v;
        const novoD = saldoD + v;
        tx.update(refO, { saldo: novoO });
        tx.update(refD, { saldo: novoD });
        tx.set(refT, {
          origemId: o.id,
          origemNome: o.nome || null,
          origemSaldoAntes: saldoO,
          origemSaldoDepois: novoO,
          destinoId: d.id,
          destinoNome: d.nome || null,
          destinoSaldoAntes: saldoD,
          destinoSaldoDepois: novoD,
          valor: v,
          motivo: mot || null,
          eventoId: eventoAtivo?.id || null,
          eventoNome: eventoAtivo?.nome || null,
          usuarioId: perfil.uid,
          usuarioEmail: perfil.email || null,
          usuarioNome: perfil.nome || null,
          usuarioPapel: perfil.papel || null,
          criadoEm: serverTimestamp()
        });
        saldoFinalO = novoO;
      });

      clearTimeout(timerLento);
      concluir({ valorFinal: v, saldoOrigem: saldoFinalO, jaRegistrada });
    } catch (err) {
      clearTimeout(timerLento);
      vibrar([100, 50, 100]);
      const eContencao = err.code === 'failed-precondition'
                     || err.code === 'aborted'
                     || /stored version/i.test(err.message || '');
      const definitivo = eContencao || /^(Saldo insuficiente|Cliente (origem|destino) não existe)/.test(err.message || '');
      if (definitivo) pendente.limpar();
      let msg;
      if (eContencao) msg = 'Outra operação mexeu no saldo ao mesmo tempo. Nada foi transferido. Toque em Transferir de novo.';
      else if (definitivo) msg = err.message;
      else msg = 'Sem resposta do servidor. Pode tocar em Transferir de novo: se a transferência já tiver sido registrada, ela NÃO será feita duas vezes.';
      if (ativo) {
        aviso = { msg, tipo: 'danger' };
        const caixa = container.querySelector('.tf');
        if (caixa) {
          caixa.querySelector('.alert')?.remove();
          caixa.querySelector('.tf-tit')?.insertAdjacentHTML('afterend', avisoHtml());
        }
        liberarBotao();
      }
    } finally {
      enviando = false;
      ctx.setOcupado(false);
    }
  }

  // ── Carga inicial ──────────────────────────────────────
  const [eventoRes, origemRes] = await Promise.allSettled([ctx.getEvento(), buscarCliente(clienteId)]);
  if (!ativo) return { desmontar() {} };
  eventoAtivo = eventoRes.status === 'fulfilled' ? eventoRes.value : null;

  if (origemRes.status === 'rejected' || !origemRes.value) {
    const naoExiste = origemRes.status === 'fulfilled';
    if (!naoExiste) console.warn('[transferir] falha ao carregar origem:', origemRes.reason);
    container.innerHTML = `
      <div class="tf">
        <div class="alert alert-danger" role="alert">${naoExiste
          ? `O cliente ${esc(clienteId)} não está cadastrado.`
          : 'Não consegui carregar o cliente. Verifique a conexão.'}</div>
        <button type="button" class="btn btn-secondary" id="tf-sair">Voltar</button>
      </div>`;
    container.querySelector('#tf-sair').onclick = () => ctx.voltar();
    return { desmontar() { ativo = false; } };
  }
  origem = origemRes.value;

  // Restaura rascunho da mesma origem e do mesmo evento
  const r = rascunho.ler();
  if (r && r.tipo === 'transferir' && r.clienteId === origem.id
      && (r.eventoId || null) === (eventoAtivo?.id || null) && r.destinoId) {
    try {
      const c = r.destinoId !== origem.id ? await buscarCliente(r.destinoId) : null;
      if (!ativo) return { desmontar() {} };
      if (c) {
        destino = c;
        opId = r.opId || null;
        valorTexto = r.valorTexto || '';
        motivo = r.motivo || '';
        motivoAberto = !!motivo;
      } else limparRascunho();
    } catch (e) {
      console.warn('[transferir] falha ao restaurar destino:', e);
    }
  }

  if (destino) { etapa = 'valor'; render(); }
  else { etapa = 'destino'; render(); pedirDestino(); }

  return {
    desmontar() {
      ativo = false;
      clearTimeout(timerSucesso);
    }
  };
}
