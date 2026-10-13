// ============================================================
// Teste de carga do App GEH — SOMENTE projeto app-geh-dev
// ============================================================
// Simula operadores (venda) e caixas (recarga) rodando as MESMAS transacoes
// do PDV: js/views/venda.js e js/views/recarga.js (idempotencia, trava de
// estoque/saldo, mesmos campos gravados). Tambem imita o cache de 60 s da
// lista de produtos pra estimar leituras do Firestore.
//
//   cd dev-tools/load-test && npm install
//   node seed.js --key <service-account-dev.json>     # restaura estoque/saldo
//   node run.js                                       # cenario realista (12 VUs, 3 min)
//   node run.js --vus 50 --rapido --duracao 60        # estresse (jitter 50-250 ms)
//
// Config em config.dev.json (ver config.example.json). Se "operador"/"caixa"
// tiverem email/senha, loga com eles (rules reais, recomendado). Sem isso,
// entra anonimo e so funciona com rules abertas no dev.
//
// Integridade conferida no fim (so clientes LT*, produtos lt-*):
//   delta saldos  == recargas ok - vendas ok
//   delta estoque == unidades vendidas ok
//   docs em vendas/movimentacoes com a tag da rodada == operacoes ok
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, runTransaction,
  serverTimestamp, getCountFromServer
} from 'firebase/firestore';

const PROJETO_PERMITIDO = 'app-geh-dev';
const PRODUTOS_TTL_MS = 60000; // igual ao venda.js

const aqui = path.dirname(fileURLToPath(import.meta.url));
const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const flag = (nome) => process.argv.includes('--' + nome);

// ---------- config + guarda de projeto ----------
const cfgPath = path.join(aqui, 'config.dev.json');
if (!fs.existsSync(cfgPath)) {
  console.error('Falta config.dev.json (copie config.example.json e preencha com o projeto DEV).');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (cfg.firebase?.projectId !== PROJETO_PERMITIDO) {
  console.error(`RECUSADO: projectId "${cfg.firebase?.projectId}". Este teste so roda em ${PROJETO_PERMITIDO}.`);
  process.exit(1);
}

const VUS = Number(arg('vus', 12));
const DURACAO_S = Number(arg('duracao', 180));
const [PENSAR_MIN, PENSAR_MAX] = flag('rapido') ? [50, 250] : [8000, 20000];
const N_CAIXAS = Math.max(1, Math.round(VUS / 3));
const N_OPERADORES = Math.max(1, VUS - N_CAIXAS);
const RUN_ID = 'lt-' + Date.now();

// ---------- helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const aleat = (a, b) => a + Math.random() * (b - a);
const escolhe = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
const pct = (arr, p) => arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

async function conectar(nome, cred) {
  const app = initializeApp(cfg.firebase, nome);
  const auth = getAuth(app);
  if (cred?.email) await signInWithEmailAndPassword(auth, cred.email, cred.senha);
  else await signInAnonymously(auth);
  return { db: getFirestore(app), uid: auth.currentUser.uid, email: auth.currentUser.email };
}

// ---------- metricas ----------
const lat = { vender: [], carregar: [], consultar: [] };
const cont = {
  vender: { ok: 0, saldo_insuf: 0, estoque_insuf: 0, genuino: 0 },
  carregar: { ok: 0, genuino: 0 },
  consultar: { ok: 0, genuino: 0 }
};
const erros = {};
let leituras = 0, escritas = 0;
let somaVendida = 0, somaRecarregada = 0, unidadesVendidas = 0;
const registrarErro = (e) => { const k = e.code || e.message; erros[k] = (erros[k] || 0) + 1; };

// ---------- operacoes (espelham venda.js / recarga.js) ----------
async function vender(cx, produtos, clienteId, evento, itens) {
  const idVenda = doc(collection(cx.db, 'vendas')).id;
  const total = itens.reduce((s, i) => s + i.produto.preco * i.qtd, 0);
  let lidos = 0, gravados = 0;
  await runTransaction(cx.db, async (tx) => {
    lidos = 0; gravados = 0;
    const clienteRef = doc(cx.db, 'clientes', clienteId);
    const vendaRef = doc(cx.db, 'vendas', idVenda);
    const prodRefs = itens.map(i => doc(cx.db, 'produtos', i.produto.id));
    const clienteSnap = await tx.get(clienteRef);
    const vendaSnap = await tx.get(vendaRef);
    const prodSnaps = await Promise.all(prodRefs.map(r => tx.get(r)));
    lidos = 2 + prodRefs.length;
    const saldoAtual = clienteSnap.data().saldo || 0;
    if (vendaSnap.exists()) return;
    if (saldoAtual < total) throw new Error('Saldo insuficiente');
    itens.forEach(({ produto, qtd }, i) => {
      const est = prodSnaps[i].data().estoque || 0;
      if (est < qtd) throw new Error('Estoque insuficiente: ' + produto.nome);
      // vendidos sai do mesmo snapshot da TX (igual a venda.js); as rules exigem os dois campos.
      tx.update(prodRefs[i], { estoque: est - qtd, vendidos: (Number(prodSnaps[i].data().vendidos) || 0) + qtd });
    });
    tx.update(clienteRef, { saldo: saldoAtual - total });
    tx.set(vendaRef, {
      clienteId, clienteNome: clienteId,
      eventoId: evento?.id || null, eventoNome: evento?.nome || null,
      itens: itens.map(({ produto, qtd }) => ({
        produtoId: produto.id, nome: produto.nome, preco: produto.preco, promocao: false,
        qtd, subtotal: produto.preco * qtd
      })),
      total, operadorId: cx.uid, operadorNome: cx.email || 'LoadTest',
      criadoEm: serverTimestamp(), loadTest: RUN_ID
    });
    gravados = 2 + itens.length; // cliente + venda + produtos
  });
  leituras += lidos; escritas += gravados;
  return total;
}

async function recarregar(cx, clienteId, evento, valor) {
  const idMov = doc(collection(cx.db, 'movimentacoes_saldo')).id;
  await runTransaction(cx.db, async (tx) => {
    const ref = doc(cx.db, 'clientes', clienteId);
    const movRef = doc(cx.db, 'movimentacoes_saldo', idMov);
    const snap = await tx.get(ref);
    const movSnap = await tx.get(movRef);
    if (!snap.exists()) throw new Error('Cliente nao encontrado');
    if (movSnap.exists()) return;
    tx.update(ref, { saldo: (snap.data().saldo || 0) + valor });
    tx.set(movRef, {
      clienteId, tipo: 'recarga', valor, forma: escolhe(['pix', 'dinheiro', 'cartao']),
      eventoId: evento?.id || null, eventoNome: evento?.nome || null,
      caixaId: cx.uid, caixaEmail: cx.email || null, caixaNome: 'LoadTest',
      criadoEm: serverTimestamp(), loadTest: RUN_ID
    });
  });
  leituras += 2; escritas += 2;
}

// ---------- carga de dados ----------
async function carregarProdutos(db) {
  const snap = await getDocs(collection(db, 'produtos'));
  leituras += snap.size;
  return snap.docs.filter(d => d.id.startsWith('lt-')).map(d => ({ id: d.id, ...d.data() }));
}

async function snapshotTotais(db) {
  const [cs, ps] = await Promise.all([getDocs(collection(db, 'clientes')), getDocs(collection(db, 'produtos'))]);
  let saldo = 0, estoque = 0, vendidos = 0;
  const ids = [];
  const porProduto = new Map();
  cs.forEach(d => { if (d.id.startsWith('LT')) { saldo += d.data().saldo || 0; ids.push(d.id); } });
  ps.forEach(d => {
    if (!d.id.startsWith('lt-')) return;
    const x = d.data();
    estoque += x.estoque || 0;
    vendidos += Number(x.vendidos) || 0;   // produto antigo (sem campo) conta 0, como na TX
    porProduto.set(d.id, { estoque: x.estoque || 0, vendidos: Number(x.vendidos) || 0, temVendidos: x.vendidos !== undefined });
  });
  return { saldo, estoque, vendidos, ids, porProduto };
}

// ---------- loops dos VUs ----------
let fim = 0;
const qtdPorProduto = new Map();   // produtoId -> unidades vendidas com sucesso nesta rodada
async function loopOperador(i, cx, clientes, evento, inicial) {
  let cache = null, cacheEm = 0;
  const pesos = inicial.map(p => p.estoque0);
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  const sorteiaProduto = () => {
    let r = Math.random() * somaPesos;
    for (let k = 0; k < inicial.length; k++) { r -= pesos[k]; if (r <= 0) return inicial[k]; }
    return inicial[inicial.length - 1];
  };
  await sleep(aleat(0, PENSAR_MAX)); // escalona a largada
  while (Date.now() < fim) {
    const clienteId = escolhe(clientes);
    if (Math.random() < 0.15) {
      const t0 = performance.now();
      try { await getDoc(doc(cx.db, 'clientes', clienteId)); leituras++; cont.consultar.ok++; }
      catch (e) { cont.consultar.genuino++; registrarErro(e); }
      lat.consultar.push(performance.now() - t0);
    } else {
      // lista de produtos como o PDV: so relê se o cache passou do TTL
      if (!cache || Date.now() - cacheEm > PRODUTOS_TTL_MS) { cache = await carregarProdutos(cx.db); cacheEm = Date.now(); }
      const escolhidos = new Map();
      const n = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const base = sorteiaProduto();
        const atual = cache.find(p => p.id === base.id) || base;
        const e = escolhidos.get(atual.id) || { produto: atual, qtd: 0 };
        e.qtd += 1 + (Math.random() < 0.25 ? 1 : 0);
        escolhidos.set(atual.id, e);
      }
      const itens = [...escolhidos.values()];
      const t0 = performance.now();
      try {
        const total = await vender(cx, cache, clienteId, evento, itens);
        cont.vender.ok++; somaVendida += total;
        unidadesVendidas += itens.reduce((s, x) => s + x.qtd, 0);
        for (const x of itens) qtdPorProduto.set(x.produto.id, (qtdPorProduto.get(x.produto.id) || 0) + x.qtd);
      } catch (e) {
        if (/Saldo insuficiente/.test(e.message)) cont.vender.saldo_insuf++;
        else if (/Estoque insuficiente/.test(e.message)) { cont.vender.estoque_insuf++; cache = null; }
        else { cont.vender.genuino++; registrarErro(e); }
      }
      lat.vender.push(performance.now() - t0);
    }
    await sleep(aleat(PENSAR_MIN, PENSAR_MAX));
  }
}

async function loopCaixa(i, cx, clientes, evento) {
  await sleep(aleat(0, PENSAR_MAX));
  while (Date.now() < fim) {
    const valor = escolhe([20, 50, 50, 100]);
    const t0 = performance.now();
    try { await recarregar(cx, escolhe(clientes), evento, valor); cont.carregar.ok++; somaRecarregada += valor; }
    catch (e) { cont.carregar.genuino++; registrarErro(e); }
    lat.carregar.push(performance.now() - t0);
    await sleep(aleat(PENSAR_MIN, PENSAR_MAX));
  }
}

// ---------- main ----------
console.log(`Teste de carga em ${PROJETO_PERMITIDO} | rodada ${RUN_ID}`);
console.log(`${N_OPERADORES} operadores + ${N_CAIXAS} caixas | ${DURACAO_S}s | pensar ${PENSAR_MIN}-${PENSAR_MAX} ms\n`);

const cxOp = await conectar('operador', cfg.operador);
const cxCaixa = await conectar('caixa', cfg.caixa);

const evSnap = await getDoc(doc(cxOp.db, 'config', 'eventoAtivo'));
const evento = evSnap.exists() ? evSnap.data() : null;
const inicialProdutos = (await carregarProdutos(cxOp.db)).map(p => ({ ...p, estoque0: p.estoque }));
const antes = await snapshotTotais(cxOp.db);
if (!inicialProdutos.length || !antes.ids.length) {
  console.error('Sem produtos lt-* ou clientes LT* no dev. Rode antes: node seed.js --key <chave-dev>');
  process.exit(1);
}
console.log(`Base: ${inicialProdutos.length} produtos (${antes.estoque} un.), ${antes.ids.length} clientes (${fmt(antes.saldo)} em saldos)\n`);

leituras = 0; // zera: conta so a partir da carga
fim = Date.now() + DURACAO_S * 1000;
const t0 = Date.now();
const progresso = setInterval(() => {
  const falt = Math.max(0, Math.round((fim - Date.now()) / 1000));
  console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s] vendas ${cont.vender.ok} ok (${cont.vender.saldo_insuf + cont.vender.estoque_insuf} negocio, ${cont.vender.genuino} erro) | recargas ${cont.carregar.ok} | consultas ${cont.consultar.ok} | faltam ${falt}s`);
}, 10000);
const vus = [];
for (let i = 0; i < N_OPERADORES; i++) vus.push(loopOperador(i, cxOp, antes.ids, evento, inicialProdutos));
for (let i = 0; i < N_CAIXAS; i++) vus.push(loopCaixa(i, cxCaixa, antes.ids, evento));
await Promise.all(vus);
clearInterval(progresso);
const dur = (Date.now() - t0) / 1000;

// ---------- integridade ----------
const depois = await snapshotTotais(cxOp.db);
const deltaSaldo = depois.saldo - antes.saldo;
const esperadoSaldo = somaRecarregada - somaVendida;
const deltaEstoque = antes.estoque - depois.estoque;
const nVendasDocs = (await getCountFromServer(query(collection(cxOp.db, 'vendas'), where('loadTest', '==', RUN_ID)))).data().count;
const nMovDocs = (await getCountFromServer(query(collection(cxOp.db, 'movimentacoes_saldo'), where('loadTest', '==', RUN_ID)))).data().count;

const okSaldo = Math.abs(deltaSaldo - esperadoSaldo) < 0.005;
const okEstoque = deltaEstoque === unidadesVendidas;
// Por produto: queda do estoque == aumento de vendidos == soma das qtd das vendas ok.
// Cobre vendas concorrentes no mesmo produto, carrinhos multi-produto e produtos
// antigos (sem o campo vendidos antes da rodada).
const divergentes = [];
for (const [id, a] of antes.porProduto) {
  const d = depois.porProduto.get(id);
  const vend = qtdPorProduto.get(id) || 0;
  if (!d || a.estoque - d.estoque !== vend || d.vendidos - a.vendidos !== vend) {
    divergentes.push({ id, vendidoOk: vend, estoque: [a.estoque, d?.estoque], vendidos: [a.vendidos, d?.vendidos] });
  }
}
const okVendidos = divergentes.length === 0 && depois.vendidos - antes.vendidos === unidadesVendidas;
const antigosAntes = [...antes.porProduto.values()].filter(x => !x.temVendidos).length;
const okVendas = nVendasDocs === cont.vender.ok;
const okMov = nMovDocs === cont.carregar.ok;

// ---------- relatorio ----------
const totalOps = cont.vender.ok + cont.carregar.ok + cont.consultar.ok;
const linha = (nome, c, l) => {
  const n = l.length;
  const err = Object.entries(c).filter(([k]) => k !== 'ok').reduce((s, [, v]) => s + v, 0);
  return `| ${nome} | ${n} | ${err} | ${Math.round(pct(l, 0.5))} ms | ${Math.round(pct(l, 0.95))} ms | ${Math.round(Math.max(0, ...l))} ms |`;
};
console.log(`Duracao real: ${dur.toFixed(1)} s | operacoes ok: ${totalOps} | throughput: ${(totalOps / dur).toFixed(2)} ops/s\n`);
console.log('| operacao | n | erros | p50 | p95 | max |\n|---|---:|---:|---:|---:|---:|');
console.log(linha('consultar', cont.consultar, lat.consultar));
console.log(linha('carregar', cont.carregar, lat.carregar));
console.log(linha('vender', cont.vender, lat.vender));
console.log(`\nErros de negocio: ${cont.vender.saldo_insuf} saldo_insuf, ${cont.vender.estoque_insuf} estoque_insuf`);
const genuinos = cont.vender.genuino + cont.carregar.genuino + cont.consultar.genuino;
const base = cont.vender.ok + cont.vender.genuino + cont.carregar.ok + cont.carregar.genuino;
console.log(`Erros genuinos: ${genuinos} (${base ? (100 * genuinos / base).toFixed(2) : '0'} %)`, genuinos ? erros : '');
console.log(`\nIntegridade:`);
console.log(`  saldo   : delta ${fmt(deltaSaldo)} | esperado ${fmt(esperadoSaldo)} ${okSaldo ? 'OK' : 'DIVERGE'}`);
console.log(`  estoque : delta ${deltaEstoque} un. | vendido ${unidadesVendidas} un. ${okEstoque ? 'OK' : 'DIVERGE'}`);
console.log(`  vendidos: delta ${depois.vendidos - antes.vendidos} un. | vendido ${unidadesVendidas} un. | ${antes.porProduto.size} produtos conferidos um a um (${antigosAntes} comecaram sem o campo) ${okVendidos ? 'OK' : 'DIVERGE'}`);
if (divergentes.length) console.log('  produtos divergentes:', JSON.stringify(divergentes.slice(0, 5)));
console.log(`  vendas  : ${nVendasDocs} docs | ${cont.vender.ok} ok ${okVendas ? 'OK' : 'DIVERGE'}`);
console.log(`  recargas: ${nMovDocs} docs | ${cont.carregar.ok} ok ${okMov ? 'OK' : 'DIVERGE'}`);
if (genuinos && !(okSaldo && okEstoque && okVendidos && okVendas && okMov)) {
  console.log('  (divergencia com erros genuinos pode ser commit ambiguo: erro de rede apos gravar)');
}

// Extrapolacao do consumo de Firestore pro evento (sem contar a conferencia final)
const vendasOk = cont.vender.ok || 1;
console.log(`\nFirestore (so a carga): ~${leituras} leituras, ~${escritas} escritas`);
console.log(`  por venda: ~${(leituras / vendasOk).toFixed(1)} leituras (inclui consultas, recargas e releitura de produtos)`);
console.log(`  confira tambem em Console > Firestore > Uso; o dev pode ter outras fontes de leitura.`);

const saida = path.join(aqui, `results-${RUN_ID}.json`);
fs.writeFileSync(saida, JSON.stringify({
  runId: RUN_ID, vus: VUS, duracaoS: dur, pensar: [PENSAR_MIN, PENSAR_MAX], cont, erros,
  p50: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, pct(v, 0.5)])),
  p95: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, pct(v, 0.95)])),
  integridade: { okSaldo, okEstoque, okVendidos, okVendas, okMov, deltaSaldo, esperadoSaldo, deltaEstoque, unidadesVendidas },
  leituras, escritas
}, null, 2));
console.log(`\nResultado salvo em ${path.basename(saida)}`);
process.exit(okSaldo && okEstoque && okVendas && okMov ? 0 : 2);
