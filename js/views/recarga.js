// ============================================================
// View "recarga" do PDV (caixa) — adicionar saldo ao cliente
// ============================================================
// Mesmas garantias da venda: rascunho do valor em localStorage, id da
// movimentacao gerado uma vez (a transacao nunca credita duas vezes) e
// registro "pendente" conferido no proximo boot se o app morrer no meio.
// ============================================================

import {
  db, doc, getDoc, collection, serverTimestamp, runTransaction
} from '../firebase-config.js';
import { icon, renderIcons } from '../icons.js';
import { fmtBRL } from '../helpers.js';

const TEMPLATE = `
  <div class="cliente-info sticky">
    <div class="nome" id="cliente-nome"><span class="skel skel-on-dark skel-title" style="width:60%"></span></div>
    <div class="saldo-label">Saldo atual</div>
    <div class="saldo" id="cliente-saldo"><span class="skel skel-on-dark skel-num" style="width:140px;height:1.8rem"></span></div>
  </div>

  <div id="alerta-recarga" class="alert hidden"></div>

  <div id="form-recarga" class="card">
    <div class="form-group">
      <label for="valor">Valor a carregar (R$)</label>
      <input type="number" id="valor" step="0.50" min="0" placeholder="Ex: 20,00" inputmode="decimal">
    </div>
    <div class="form-group">
      <label for="forma-pagto">Forma de pagamento</label>
      <select id="forma-pagto">
        <option value="dinheiro">Dinheiro</option>
        <option value="pix">Pix</option>
        <option value="cartao">Cartão</option>
        <option value="troquinho">Troquinho</option>
        <option value="correcao">Correção</option>
      </select>
    </div>
    <button id="btn-carregar" class="btn btn-success" type="button"><span data-icon="plus" data-size="18"></span> Adicionar saldo</button>
  </div>

  <div class="venda-sucesso hidden" id="venda-sucesso" role="status" aria-live="polite">
    <div class="venda-sucesso-box">
      <div class="venda-sucesso-ic">${icon('check-circle', { size: 56 })}</div>
      <div class="venda-sucesso-tit" id="sucesso-titulo">Recarga registrada</div>
      <div class="venda-sucesso-val" id="sucesso-total"></div>
      <div class="venda-sucesso-sub">Saldo agora</div>
      <div class="venda-sucesso-saldo" id="sucesso-saldo"></div>
      <button type="button" class="btn btn-primary" id="btn-proximo">Próximo cliente</button>
    </div>
  </div>
`;

export async function montar(container, ctx) {
  const { clienteId, perfil, rascunho, pendente } = ctx;

  container.innerHTML = TEMPLATE;
  renderIcons(container);
  ctx.setTitulo('Carregar Saldo');

  const $ = (id) => container.querySelector(`#${id}`);
  const vibrar = (padrao) => { try { navigator.vibrate?.(padrao); } catch (_) {} };

  let ativo = true;
  let enviando = false;
  let eventoAtivo = null;
  let movId = null;
  let timerSucesso = null;

  function mostrarAlerta(msg, tipo = 'info') {
    const a = $('alerta-recarga');
    a.textContent = msg;
    a.className = `alert alert-${tipo}`;
  }

  function salvarRascunho() {
    const valor = parseFloat($('valor').value);
    if (!(valor > 0)) { rascunho.limpar(); return; }
    if (!movId) movId = doc(collection(db, 'movimentacoes_saldo')).id;
    rascunho.gravar({
      tipo: 'recarga',
      clienteId,
      opId: movId,
      eventoId: eventoAtivo?.id || null,
      temItens: true,
      valor,
      forma: $('forma-pagto').value
    });
  }
  $('valor').addEventListener('input', salvarRascunho);
  $('forma-pagto').addEventListener('change', salvarRascunho);

  function restaurarRascunho() {
    const r = rascunho.ler();
    if (!r || r.tipo !== 'recarga') return;
    if (r.clienteId !== clienteId) { rascunho.limpar(); return; }
    if ((r.eventoId || null) !== (eventoAtivo?.id || null)) { rascunho.limpar(); return; }
    movId = r.opId || null;
    if (r.valor > 0) $('valor').value = r.valor;
    if (r.forma) $('forma-pagto').value = r.forma;
  }

  let cliente = null;
  async function carregarCliente() {
    const snap = await getDoc(doc(db, 'clientes', clienteId));
    if (!ativo) return;
    if (!snap.exists()) {
      $('cliente-nome').innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('x-circle', { size: 20 })} Cliente não cadastrado</span>`;
      mostrarAlerta(`Cliente ${clienteId} não encontrado. Cadastre no admin antes.`, 'danger');
      return;
    }
    cliente = { id: clienteId, ...snap.data() };
    $('cliente-nome').textContent = clienteId;
    $('cliente-saldo').textContent = fmtBRL(cliente.saldo);
  }

  function liberarBotao() {
    $('btn-carregar').disabled = false;
    $('btn-carregar').innerHTML = `${icon('plus', { size: 18 })} Adicionar saldo`;
  }

  function concluir({ valor, saldoFinal, jaRegistrada }) {
    pendente.limpar();
    rascunho.limpar();
    vibrar([40, 60, 40, 60, 80]);
    $('cliente-saldo').textContent = fmtBRL(saldoFinal);
    const idCurto = (movId || '').slice(-6).toUpperCase();
    $('sucesso-titulo').textContent = jaRegistrada
      ? `Recarga #${idCurto} já estava registrada`
      : `Recarga #${idCurto} registrada`;
    $('sucesso-total').textContent = `+ ${fmtBRL(valor)}`;
    $('sucesso-saldo').textContent = fmtBRL(saldoFinal);
    $('venda-sucesso').classList.remove('hidden');
    $('btn-proximo').focus();
    timerSucesso = setTimeout(() => ctx.voltar(), 3000);
  }
  $('btn-proximo').onclick = () => { clearTimeout(timerSucesso); ctx.voltar(); };

  $('btn-carregar').addEventListener('click', async () => {
    if (enviando) return;
    const valor = parseFloat($('valor').value);
    if (!valor || valor <= 0) return mostrarAlerta('Digite um valor maior que zero', 'warning');

    const forma = $('forma-pagto').value;
    enviando = true;
    ctx.setOcupado(true);
    $('btn-carregar').disabled = true;
    $('btn-carregar').innerHTML = '<div class="loader"></div> Processando...';

    const timerLento = setTimeout(() => {
      $('btn-carregar').innerHTML = '<div class="loader"></div> Conexão lenta — aguardando servidor…';
    }, 5000);

    const idAlvo = clienteId;              // captura antes dos awaits
    const idMov = movId || (movId = doc(collection(db, 'movimentacoes_saldo')).id);
    let saldoFinal = null;
    let jaRegistrada = false;

    try {
      // Tentativa anterior sem resposta (rede caiu): confere se ja foi gravada.
      const pend = pendente.ler();
      if (pend && pend.id === idMov) {
        const snap = await getDoc(doc(db, 'movimentacoes_saldo', idMov));
        if (snap.exists()) {
          clearTimeout(timerLento);
          const cSnap = await getDoc(doc(db, 'clientes', idAlvo));
          concluir({ valor: snap.data().valor ?? valor, saldoFinal: cSnap.data()?.saldo ?? 0, jaRegistrada: true });
          return;
        }
        pendente.limpar();
      }

      pendente.gravar({ colecao: 'movimentacoes_saldo', id: idMov, rotulo: 'Recarga', clienteId: idAlvo, valor });

      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'clientes', idAlvo);
        const movRef = doc(db, 'movimentacoes_saldo', idMov);
        const snap = await tx.get(ref);
        const movSnap = await tx.get(movRef);
        if (!snap.exists()) throw new Error('Cliente não encontrado');
        const saldo = snap.data().saldo || 0;

        // Idempotencia: a recarga ja foi gravada por uma tentativa anterior.
        if (movSnap.exists()) {
          jaRegistrada = true;
          saldoFinal = saldo;
          return;
        }
        jaRegistrada = false;

        saldoFinal = saldo + valor;
        tx.update(ref, { saldo: saldoFinal });
        tx.set(movRef, {
          clienteId: idAlvo,
          tipo: 'recarga',
          valor,
          forma,
          eventoId: eventoAtivo?.id || null,
          eventoNome: eventoAtivo?.nome || null,
          // Auditoria — quem registrou a recarga
          caixaId: perfil.uid,
          caixaEmail: perfil.email || null,
          caixaNome: perfil.nome || null,
          criadoEm: serverTimestamp()
        });
      });

      clearTimeout(timerLento);
      concluir({ valor, saldoFinal, jaRegistrada });
    } catch (err) {
      clearTimeout(timerLento);
      vibrar([100, 50, 100]);

      const eContencao = err.code === 'failed-precondition'
                     || err.code === 'aborted'
                     || /stored version/i.test(err.message || '');
      const definitivo = eContencao || err.message === 'Cliente não encontrado';
      let mensagem;
      if (err.message === 'Cliente não encontrado') {
        mensagem = 'Cliente não encontrado.';
      } else if (eContencao) {
        mensagem = 'Conflito com outra operação simultânea. A recarga NÃO foi registrada — clique de novo.';
      } else {
        mensagem = `Sem confirmação do servidor (${err.message}). Pode clicar de novo: se a recarga já tiver sido registrada, ela NÃO será creditada duas vezes.`;
      }
      if (definitivo) pendente.limpar();
      mostrarAlerta(mensagem, 'danger');
      liberarBotao();
    } finally {
      enviando = false;
      ctx.setOcupado(false);
    }
  });

  // Carga inicial: evento e cliente em paralelo
  const [eventoRes, clienteRes] = await Promise.allSettled([ctx.getEvento(), carregarCliente()]);
  if (!ativo) return { desmontar() {} };
  eventoAtivo = eventoRes.status === 'fulfilled' ? eventoRes.value : null;
  if (clienteRes.status === 'rejected') {
    console.warn('[recarga] falha ao carregar cliente:', clienteRes.reason);
    mostrarAlerta('Não consegui carregar o cliente. Verifique a conexão.', 'danger');
  }
  restaurarRascunho();
  if (!$('valor').value) $('valor').focus();

  return {
    desmontar() {
      ativo = false;
      clearTimeout(timerSucesso);
    }
  };
}
