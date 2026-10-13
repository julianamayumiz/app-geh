// ============================================================
// Calculos puros do painel de vendas (sem Firebase, sem DOM)
// ============================================================
// Separado de js/views/painel.js pra poder testar com node
// (dev-tools/rules-tests/test-painel-calc.mjs).
//
// Regras:
//  - status por QUANTIDADE RESTANTE (produtos.estoque), igual ao card de
//    venda. O percentual vendido so descreve a barra e o total.
//  - nunca inventa historico: sem `vendidos` => null (UI mostra "—"); sem
//    `estoquePlanejado` valido => fora do total e sem barra.
// ============================================================

// Mesmo valor de ESTOQUE_BAIXO em js/views/venda.js e admin/produtos.html.
export const ESTOQUE_BAIXO = 10;
// Dados em modo manual que ficam velhos demais ganham aviso (nao ha timer de fetch).
export const MANUAL_ANTIGO_MS = 5 * 60 * 1000;

export const ST = Object.freeze({
  OK: 'ok',
  ACABANDO: 'acabando',
  ESGOTADO: 'esgotado',
  INVALIDO: 'invalido'
});

const ORDEM_CRITICO = { [ST.ESGOTADO]: 0, [ST.INVALIDO]: 1, [ST.ACABANDO]: 2 };

const numOk = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const cmpNome = (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');

export function analisarProduto(p) {
  const estoqueValido = numOk(p.estoque);
  const vendidos = numOk(p.vendidos) ? p.vendidos : null;
  const planejado = Number.isInteger(p.estoquePlanejado) && p.estoquePlanejado > 0 ? p.estoquePlanejado : null;

  let status;
  if (!estoqueValido) status = ST.INVALIDO;
  else if (p.estoque <= 0) status = ST.ESGOTADO;
  else if (p.estoque <= ESTOQUE_BAIXO) status = ST.ACABANDO;
  else status = ST.OK;

  const pct = planejado ? Math.min(100, Math.round(((vendidos ?? 0) / planejado) * 100)) : null;

  return {
    id: p.id,
    nome: p.nome || '(sem nome)',
    categoria: p.categoria || 'Geral',
    estoque: estoqueValido ? p.estoque : null,
    vendidos,
    planejado,
    pct,
    acima: !!planejado && (vendidos ?? 0) > planejado,
    status,
    critico: status !== ST.OK
  };
}

// Progresso geral = soma(vendidos) / soma(planejado) so dos produtos com
// planejado valido e estoque valido. Nunca media de percentuais.
export function resumo(analises) {
  let vendidos = 0, planejado = 0, emEstoque = 0, contados = 0, semPlanejado = 0, invalidos = 0;
  for (const a of analises) {
    if (a.status === ST.INVALIDO) { invalidos++; continue; }
    if (a.planejado == null) { semPlanejado++; continue; }
    contados++;
    vendidos += a.vendidos ?? 0;
    planejado += a.planejado;
    emEstoque += a.estoque;
  }
  const pct = planejado > 0 ? Math.min(100, Math.round((vendidos / planejado) * 100)) : null;
  return { vendidos, planejado, emEstoque, contados, semPlanejado, invalidos, pct };
}

// Aba "Todos": criticos (independente de favoritos) > favoritos > demais.
export function agrupar(analises, favoritos) {
  const fav = favoritos instanceof Set ? favoritos : new Set(favoritos || []);
  const criticos = analises.filter(a => a.critico).sort((a, b) =>
    (ORDEM_CRITICO[a.status] - ORDEM_CRITICO[b.status]) || ((a.estoque ?? 0) - (b.estoque ?? 0)) || cmpNome(a, b));
  const naoCriticos = analises.filter(a => !a.critico);
  const favoritosOk = naoCriticos.filter(a => fav.has(a.id)).sort(cmpNome);
  const demais = naoCriticos.filter(a => !fav.has(a.id)).sort(cmpNome);
  return { criticos, favoritos: favoritosOk, demais };
}

// Aba "Favoritos": favoritos em cartao, criticos primeiro.
export function soFavoritos(analises, favoritos) {
  const fav = favoritos instanceof Set ? favoritos : new Set(favoritos || []);
  return analises.filter(a => fav.has(a.id)).sort((a, b) =>
    ((a.critico ? ORDEM_CRITICO[a.status] : 9) - (b.critico ? ORDEM_CRITICO[b.status] : 9)) || cmpNome(a, b));
}

// Estado de frescor. Dados em cache, erro ou offline nunca contam como atuais.
// Em modo ao vivo o snapshot so dispara quando algo muda, entao "tempo sem
// snapshot" NAO indica dado velho; so erro/offline.
export function frescor({ modo, ultimaServidor, erro, offline, agora }) {
  if (!ultimaServidor) return { antigo: true, motivo: erro ? 'erro' : 'sem-dados' };
  if (erro) return { antigo: true, motivo: 'erro' };
  if (offline) return { antigo: true, motivo: 'offline' };
  if (modo !== 'live' && agora - ultimaServidor > MANUAL_ANTIGO_MS) return { antigo: true, motivo: 'velho' };
  return { antigo: false, motivo: null };
}

// Assinatura pra re-renderizar so quando algo visivel mudou.
export function assinatura(analises) {
  return analises.map(a => `${a.id}|${a.nome}|${a.categoria}|${a.estoque}|${a.vendidos}|${a.planejado}`).join(';');
}
