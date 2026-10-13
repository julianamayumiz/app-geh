// ============================================================
// View "consulta" do PDV (operador) — saldo + historico do cliente
// ============================================================
import {
  db, doc, getDoc, getDocs, collection, query, where, orderBy, limit
} from '../firebase-config.js';
import { icon, renderIcons } from '../icons.js';
import { fmtBRL, esc } from '../helpers.js';

const TEMPLATE = `
  <div class="cliente-info sticky">
    <div class="nome" id="cliente-nome"><span class="skel skel-on-dark skel-title" style="width:60%"></span></div>
    <div class="saldo-label">Saldo atual</div>
    <div class="saldo" id="cliente-saldo"><span class="skel skel-on-dark skel-num" style="width:140px;height:1.8rem"></span></div>
  </div>

  <div id="alerta-consulta" class="alert hidden"></div>

  <div id="historico" class="hidden">
    <h3 style="color:var(--azul);margin:1rem 0 0.75rem;display:inline-flex;align-items:center;gap:0.5rem;"><span data-icon="clock" data-size="20"></span> Histórico</h3>
    <div id="lista-hist" class="hist-list"></div>
  </div>

  <div class="mt-2">
    <button type="button" class="btn btn-primary" id="btn-proximo-consulta">
      <span data-icon="qr-code" data-size="18"></span> Consultar outro cliente
    </button>
  </div>
`;

export async function montar(container, ctx) {
  const { clienteId } = ctx;
  container.innerHTML = TEMPLATE;
  renderIcons(container);
  ctx.setTitulo('Saldo do cliente');

  const $ = (id) => container.querySelector(`#${id}`);
  let ativo = true;

  $('btn-proximo-consulta').onclick = () => ctx.voltar();

  function mostrarAlerta(msg, tipo = 'info') {
    const a = $('alerta-consulta');
    a.textContent = msg;
    a.className = `alert alert-${tipo}`;
  }

  async function carregarHistorico() {
    const evento = await ctx.getEvento();
    const eventoId = evento?.id ?? null;
    const q = (col, campo) => getDocs(query(collection(db, col), where(campo, '==', clienteId), where('eventoId', '==', eventoId), orderBy('criadoEm', 'desc'), limit(30)));
    const comTransf = !!ctx.opcoes?.transferencias;   // caixa mostra transferencias tambem
    const vazio = { forEach() {} };
    const [movSnap, vendasSnap, transfOrigemSnap, transfDestinoSnap] = await Promise.all([
      q('movimentacoes_saldo', 'clienteId'),
      q('vendas', 'clienteId'),
      comTransf ? q('transferencias_saldo', 'origemId') : vazio,
      comTransf ? q('transferencias_saldo', 'destinoId') : vazio
    ]);
    if (!ativo) return;

    const movs = [];
    movSnap.forEach(d => {
      const m = d.data();
      movs.push({
        quando: m.criadoEm?.toDate?.() || new Date(0),
        tipo: 'recarga',
        detalhe: `Via ${m.forma || '—'}`,
        valor: m.valor,
        positivo: true
      });
    });
    vendasSnap.forEach(d => {
      const v = d.data();
      const itens = (v.itens || []).map(i => `${i.qtd}× ${i.nome}`).join(', ');
      movs.push({
        quando: v.criadoEm?.toDate?.() || new Date(0),
        tipo: 'venda',
        detalhe: itens || '—',
        valor: v.total,
        positivo: false
      });
    });
    transfOrigemSnap.forEach(d => {
      const t = d.data();
      const para = t.destinoNome ? `${t.destinoId} (${t.destinoNome})` : t.destinoId;
      movs.push({ quando: t.criadoEm?.toDate?.() || new Date(0), tipo: 'transfer ↗', detalhe: `Enviado para ${para}`, valor: t.valor, positivo: false });
    });
    transfDestinoSnap.forEach(d => {
      const t = d.data();
      const de = t.origemNome ? `${t.origemId} (${t.origemNome})` : t.origemId;
      movs.push({ quando: t.criadoEm?.toDate?.() || new Date(0), tipo: 'transfer ↙', detalhe: `Recebido de ${de}`, valor: t.valor, positivo: true });
    });
    movs.sort((a, b) => b.quando - a.quando);

    const lista = $('lista-hist');
    if (movs.length === 0) {
      lista.innerHTML = `<div class="empty-state">${icon('inbox', { size: 32 })}<p>Sem movimentações.</p></div>`;
    } else {
      lista.innerHTML = movs.map(m => {
        const cor = m.positivo ? 'var(--verde)' : 'var(--vermelho)';
        const sinal = m.positivo ? '+' : '-';
        const dt = m.quando.toLocaleDateString('pt-BR');
        const hr = m.quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="hist-item">
          <div class="hist-row">
            <span class="hist-badge" style="background:${cor};">${m.tipo}</span>
            <span class="hist-quando">${dt} · ${hr}</span>
            <span class="hist-valor" style="color:${cor};">${sinal} ${fmtBRL(m.valor)}</span>
          </div>
          <div class="hist-detalhe">${esc(m.detalhe)}</div>
        </div>`;
      }).join('');
    }
    $('historico').classList.remove('hidden');
    renderIcons(container);
  }

  try {
    const snap = await getDoc(doc(db, 'clientes', clienteId));
    if (!ativo) return { desmontar() {} };
    if (!snap.exists()) {
      $('cliente-nome').innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('x-circle', { size: 20 })} Cliente não cadastrado</span>`;
      mostrarAlerta(`Cliente ${clienteId} não encontrado.`, 'danger');
    } else {
      $('cliente-nome').textContent = clienteId;
      $('cliente-saldo').textContent = fmtBRL(snap.data().saldo);
      carregarHistorico().catch(e => {
        console.warn('[consulta] historico:', e);
        if (ativo) mostrarAlerta('Não consegui carregar o histórico.', 'warning');
      });
    }
  } catch (e) {
    console.warn('[consulta] cliente:', e);
    mostrarAlerta('Não consegui carregar o cliente. Verifique a conexão.', 'danger');
  }

  return { desmontar() { ativo = false; } };
}
