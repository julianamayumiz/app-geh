// Testes dos calculos puros do painel de vendas (sem emulador).
// Uso: node test-painel-calc.mjs
import assert from 'node:assert/strict';
import {
  analisarProduto, resumo, agrupar, soFavoritos, frescor, assinatura,
  ST, ESTOQUE_BAIXO, MANUAL_ANTIGO_MS
} from '../../js/painel-calc.js';

let falhas = 0;
function t(nome, fn) {
  try { fn(); console.log(`  ok    ${nome}`); }
  catch (e) { falhas++; console.log(`  FALHA ${nome}\n        ${e.message.split('\n')[0]}`); }
}
const P = (o) => analisarProduto({ id: 'x', nome: 'X', categoria: 'Doces', estoque: 100, ...o });

console.log('\n== status por quantidade restante ==');
t('estoque acima do limite = ok', () => assert.equal(P({ estoque: ESTOQUE_BAIXO + 1 }).status, ST.OK));
t('estoque no limite = acabando', () => assert.equal(P({ estoque: ESTOQUE_BAIXO }).status, ST.ACABANDO));
t('estoque 0 = esgotado', () => assert.equal(P({ estoque: 0 }).status, ST.ESGOTADO));
t('estoque negativo/string/NaN/ausente = invalido', () => {
  for (const e of [-1, '5', NaN, undefined, null]) assert.equal(analisarProduto({ id: 'a', nome: 'A', estoque: e }).status, ST.INVALIDO);
});
t('percentual alto NAO dispara alerta (so quantidade restante)', () =>
  assert.equal(P({ estoque: 60, estoquePlanejado: 600, vendidos: 540 }).status, ST.OK));
t('invalido e critico (vai pra Atencao)', () => assert.equal(P({ estoque: -3 }).critico, true));

console.log('\n== produtos antigos / dados invalidos ==');
t('sem vendidos => null (nunca 0 inventado)', () => assert.equal(P({}).vendidos, null));
t('vendidos invalido (negativo/string) => null', () => {
  assert.equal(P({ vendidos: -2 }).vendidos, null);
  assert.equal(P({ vendidos: '7' }).vendidos, null);
});
t('sem planejado => sem pct/barra', () => { const a = P({ vendidos: 5 }); assert.equal(a.planejado, null); assert.equal(a.pct, null); });
t('planejado invalido (0, negativo, float, string) => null', () => {
  for (const v of [0, -5, 10.5, '100']) assert.equal(P({ estoquePlanejado: v }).planejado, null);
});
t('planejado valido sem vendidos => pct 0, vendidos segue null', () => {
  const a = P({ estoquePlanejado: 100 });
  assert.equal(a.pct, 0); assert.equal(a.vendidos, null);
});
t('vendidos > planejado => acima e pct limitado a 100', () => {
  const a = P({ estoquePlanejado: 100, vendidos: 130 });
  assert.equal(a.acima, true); assert.equal(a.pct, 100);
});

console.log('\n== resumo geral ==');
t('total = soma/soma, nao media de percentuais', () => {
  const lista = [
    P({ id: 'a', estoquePlanejado: 10, vendidos: 10, estoque: 0 }),     // 100%
    P({ id: 'b', estoquePlanejado: 1000, vendidos: 100, estoque: 900 }) // 10%
  ];
  const r = resumo(lista);
  assert.equal(r.vendidos, 110); assert.equal(r.planejado, 1010);
  assert.equal(r.pct, 11);          // media de pct seria 55
  assert.equal(r.emEstoque, 900);
});
t('sem planejado e invalido ficam fora do total e sao contados', () => {
  const r = resumo([
    P({ id: 'a', estoquePlanejado: 50, vendidos: 10 }),
    P({ id: 'b', vendidos: 999 }),
    P({ id: 'c', estoque: -1, estoquePlanejado: 50, vendidos: 20 })
  ]);
  assert.equal(r.vendidos, 10); assert.equal(r.planejado, 50);
  assert.equal(r.semPlanejado, 1); assert.equal(r.invalidos, 1); assert.equal(r.contados, 1);
});
t('nenhum planejado => pct null (sem divisao por zero)', () => assert.equal(resumo([P({})]).pct, null));
t('lista vazia nao quebra', () => assert.equal(resumo([]).pct, null));

console.log('\n== ordenacao da aba Todos ==');
t('critico favorito aparece uma vez, na faixa de criticos', () => {
  const lista = [
    P({ id: 'a', nome: 'Agua', estoque: 0 }),
    P({ id: 'b', nome: 'Bolo' }),
    P({ id: 'c', nome: 'Cafe' })
  ];
  const g = agrupar(lista, new Set(['a', 'b']));
  assert.deepEqual(g.criticos.map(x => x.id), ['a']);
  assert.deepEqual(g.favoritos.map(x => x.id), ['b']);
  assert.deepEqual(g.demais.map(x => x.id), ['c']);
});
t('criticos: esgotado antes de acabando, menor estoque primeiro', () => {
  const g = agrupar([
    P({ id: 'a', nome: 'A', estoque: 8 }), P({ id: 'b', nome: 'B', estoque: 0 }), P({ id: 'c', nome: 'C', estoque: 3 })
  ], []);
  assert.deepEqual(g.criticos.map(x => x.id), ['b', 'c', 'a']);
});
t('critico sem favorito tambem fica em criticos', () =>
  assert.equal(agrupar([P({ id: 'a', estoque: 2 })], []).criticos.length, 1));
t('soFavoritos: criticos primeiro, depois alfabetico', () => {
  const r = soFavoritos([
    P({ id: 'a', nome: 'Zeta' }), P({ id: 'b', nome: 'Alfa' }), P({ id: 'c', nome: 'Meio', estoque: 0 }), P({ id: 'd', nome: 'Fora' })
  ], new Set(['a', 'b', 'c']));
  assert.deepEqual(r.map(x => x.id), ['c', 'b', 'a']);
});

console.log('\n== frescor ==');
const agora = 1_000_000;
t('sem dados do servidor = antigo', () => assert.equal(frescor({ modo: 'manual', ultimaServidor: 0, agora }).antigo, true));
t('erro nunca parece atual', () => assert.equal(frescor({ modo: 'live', ultimaServidor: agora - 1000, erro: true, agora }).antigo, true));
t('offline/cache nunca parece atual', () => assert.equal(frescor({ modo: 'live', ultimaServidor: agora - 1000, offline: true, agora }).antigo, true));
t('live sem snapshot ha muito tempo NAO e velho (so dispara em mudanca)', () =>
  assert.equal(frescor({ modo: 'live', ultimaServidor: agora - 60 * 60 * 1000, agora }).antigo, false));
t('manual > limite fica antigo', () =>
  assert.equal(frescor({ modo: 'manual', ultimaServidor: agora - MANUAL_ANTIGO_MS - 1, agora }).antigo, true));
t('manual recente e atual', () =>
  assert.equal(frescor({ modo: 'manual', ultimaServidor: agora - 1000, agora }).antigo, false));

console.log('\n== assinatura ==');
t('muda quando vendidos muda, igual quando nada mudou', () => {
  const a = [P({ id: 'a', vendidos: 1 })], b = [P({ id: 'a', vendidos: 1 })], c = [P({ id: 'a', vendidos: 2 })];
  assert.equal(assinatura(a), assinatura(b)); assert.notEqual(assinatura(a), assinatura(c));
});

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo ok');
process.exit(falhas ? 1 : 0);
