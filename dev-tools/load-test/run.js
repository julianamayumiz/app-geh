// Teste de carga — App GEH (dev)
//
// Simula N "operadores" fazendo vendas, recargas e consultas em paralelo.
// Espelha EXATAMENTE as transações de operador/vender.html e operador/carregar.html.
//
// Antes de rodar:
//   1. Ter rodado o seed (dev-tools/seed.html) no projeto de dev
//   2. Garantir que js/firebase-config.js aponta pro projeto de dev
//   3. cd dev-tools/load-test && npm install
//   4. npm test

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  runTransaction, serverTimestamp
} from "firebase/firestore";

// ---------- Config ----------
const VUS = 30;                    // usuários virtuais simultâneos
const OPS_POR_VU = 20;             // operações por VU
const MIX = { vender: 0.70, carregar: 0.20, consultar: 0.10 };
const PROD_PROJECT_ID = "app-geh-cc577";

// ---------- Extrai firebaseConfig do arquivo da app ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../../js/firebase-config.js");
const src = readFileSync(configPath, "utf8");
const m = src.match(/const firebaseConfig\s*=\s*(\{[\s\S]*?\});/);
if (!m) { console.error("Não consegui ler firebaseConfig de", configPath); process.exit(1); }
// eslint-disable-next-line no-eval
const firebaseConfig = eval("(" + m[1] + ")");

if (firebaseConfig.projectId === PROD_PROJECT_ID) {
  console.error(`\n🛑 ABORTADO: projectId é o de PRODUÇÃO (${PROD_PROJECT_ID}).`);
  console.error("   Troque js/firebase-config.js pro projeto de dev antes de rodar.\n");
  process.exit(1);
}
console.log(`Projeto: ${firebaseConfig.projectId}`);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Utils ----------
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function pickOp() {
  const r = Math.random();
  if (r < MIX.vender) return "vender";
  if (r < MIX.vender + MIX.carregar) return "carregar";
  return "consultar";
}

// ---------- Estado pré-teste ----------
async function snapshotEstado(label) {
  const [clientesSnap, produtosSnap] = await Promise.all([
    getDocs(collection(db, "clientes")),
    getDocs(collection(db, "produtos")),
  ]);
  let somaSaldos = 0, somaEstoque = 0;
  clientesSnap.forEach(d => { somaSaldos += d.data().saldo || 0; });
  produtosSnap.forEach(d => { somaEstoque += d.data().estoque || 0; });
  const produtos = produtosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`[${label}] clientes=${clientesSnap.size} somaSaldos=R$${somaSaldos.toFixed(2)} produtos=${produtosSnap.size} somaEstoque=${somaEstoque}`);
  return { somaSaldos, somaEstoque, produtos, nClientes: clientesSnap.size };
}

// ---------- Operações (espelham o app) ----------
async function opConsultar(ctx) {
  const matricula = `GEH${String(rnd(1, ctx.nClientes)).padStart(3, "0")}`;
  const snap = await getDoc(doc(db, "clientes", matricula));
  return snap.exists() ? snap.data().saldo : null;
}

async function opCarregar(ctx) {
  const matricula = `GEH${String(rnd(1, ctx.nClientes)).padStart(3, "0")}`;
  const valor = rnd(10, 100);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "clientes", matricula);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Cliente não encontrado");
    const saldo = snap.data().saldo || 0;
    tx.update(ref, { saldo: saldo + valor });
    const movRef = doc(collection(db, "movimentacoes_saldo"));
    tx.set(movRef, {
      clienteId: matricula, tipo: "recarga", valor,
      forma: pick(["dinheiro", "pix", "cartao"]),
      eventoId: null, eventoNome: null,
      criadoEm: serverTimestamp(),
    });
  });
  ctx.totalCarregado += valor;
}

async function opVender(ctx) {
  const matricula = `GEH${String(rnd(1, ctx.nClientes)).padStart(3, "0")}`;
  const nItens = rnd(1, 3);
  const produtosEscolhidos = [];
  const jaVistos = new Set();
  for (let i = 0; i < nItens; i++) {
    const p = pick(ctx.produtos);
    if (jaVistos.has(p.id)) continue;
    jaVistos.add(p.id);
    produtosEscolhidos.push({ produto: p, qtd: rnd(1, 2) });
  }
  const total = produtosEscolhidos.reduce((s, { produto, qtd }) =>
    s + (produto.precoPromo && produto.promocao ? produto.precoPromo : produto.preco) * qtd, 0);

  await runTransaction(db, async (tx) => {
    const clienteRef = doc(db, "clientes", matricula);
    const prodRefs = produtosEscolhidos.map(({ produto }) => doc(db, "produtos", produto.id));
    const clienteSnap = await tx.get(clienteRef);
    if (!clienteSnap.exists()) throw new Error("Cliente não encontrado");
    const prodSnaps = await Promise.all(prodRefs.map(r => tx.get(r)));

    const saldoAtual = clienteSnap.data().saldo || 0;
    if (saldoAtual < total) throw new Error("SALDO_INSUF");

    produtosEscolhidos.forEach(({ qtd }, i) => {
      const estAtual = prodSnaps[i].data().estoque || 0;
      if (estAtual < qtd) throw new Error("ESTOQUE_INSUF");
      tx.update(prodRefs[i], { estoque: estAtual - qtd });
    });
    tx.update(clienteRef, { saldo: saldoAtual - total });

    const vendaRef = doc(collection(db, "vendas"));
    tx.set(vendaRef, {
      clienteId: matricula, clienteNome: matricula,
      eventoId: null, eventoNome: null,
      itens: produtosEscolhidos.map(({ produto, qtd }) => ({
        produtoId: produto.id, nome: produto.nome,
        preco: produto.precoPromo && produto.promocao ? produto.precoPromo : produto.preco,
        promocao: produto.promocao || false,
        qtd, subtotal: (produto.precoPromo && produto.promocao ? produto.precoPromo : produto.preco) * qtd,
      })),
      total, criadoEm: serverTimestamp(),
    });
  });
  ctx.totalVendido += total;
}

// ---------- Runner ----------
async function runVU(vuId, ctx, stats) {
  for (let i = 0; i < OPS_POR_VU; i++) {
    const op = pickOp();
    const t0 = performance.now();
    try {
      if (op === "vender") await opVender(ctx);
      else if (op === "carregar") await opCarregar(ctx);
      else await opConsultar(ctx);
      const dt = performance.now() - t0;
      stats.ok.push({ op, dt });
    } catch (err) {
      const dt = performance.now() - t0;
      const code = err.message === "SALDO_INSUF" ? "saldo_insuf"
                 : err.message === "ESTOQUE_INSUF" ? "estoque_insuf"
                 : "erro";
      stats.err.push({ op, dt, code, msg: err.message });
    }
    await sleep(rnd(50, 250)); // jitter humano
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

// ---------- Main ----------
(async () => {
  console.log(`\n=== Teste de carga: ${VUS} VUs × ${OPS_POR_VU} ops (~${VUS * OPS_POR_VU} operações) ===\n`);
  const before = await snapshotEstado("PRE");
  const ctx = { produtos: before.produtos, nClientes: before.nClientes, totalVendido: 0, totalCarregado: 0 };
  const stats = { ok: [], err: [] };

  const t0 = performance.now();
  await Promise.all(Array.from({ length: VUS }, (_, i) => runVU(i, ctx, stats)));
  const totalMs = performance.now() - t0;

  const after = await snapshotEstado("POS");

  const total = stats.ok.length + stats.err.length;
  const dtsAll = [...stats.ok, ...stats.err].map(x => x.dt);
  const porOp = {};
  [...stats.ok, ...stats.err].forEach(x => {
    porOp[x.op] ||= { n: 0, erros: 0, dts: [] };
    porOp[x.op].n++;
    porOp[x.op].dts.push(x.dt);
  });
  stats.err.forEach(x => { porOp[x.op].erros++; });

  const errPorCodigo = stats.err.reduce((acc, e) => { acc[e.code] = (acc[e.code] || 0) + 1; return acc; }, {});

  console.log(`\n=== Resultado ===`);
  console.log(`Duração total: ${(totalMs / 1000).toFixed(1)}s · throughput: ${(total / (totalMs / 1000)).toFixed(1)} ops/s`);
  console.log(`Operações: ${total} (ok=${stats.ok.length}, erro=${stats.err.length}, taxa de erro=${(stats.err.length / total * 100).toFixed(1)}%)`);
  console.log(`Latência geral: p50=${pct(dtsAll, 0.5).toFixed(0)}ms p95=${pct(dtsAll, 0.95).toFixed(0)}ms max=${Math.max(...dtsAll).toFixed(0)}ms`);

  console.log(`\nPor operação:`);
  for (const [op, s] of Object.entries(porOp)) {
    console.log(`  ${op.padEnd(10)} n=${String(s.n).padStart(4)} erros=${String(s.erros).padStart(3)} p50=${pct(s.dts, 0.5).toFixed(0)}ms p95=${pct(s.dts, 0.95).toFixed(0)}ms`);
  }

  if (Object.keys(errPorCodigo).length) {
    console.log(`\nErros por tipo:`);
    for (const [code, n] of Object.entries(errPorCodigo)) console.log(`  ${code}: ${n}`);
  }

  // ---------- Integridade ----------
  console.log(`\n=== Integridade ===`);
  const deltaSaldos = after.somaSaldos - before.somaSaldos;
  const deltaSaldosEsperado = ctx.totalCarregado - ctx.totalVendido;
  const deltaEstoque = before.somaEstoque - after.somaEstoque;
  console.log(`Carregado (total registrado): R$${ctx.totalCarregado.toFixed(2)}`);
  console.log(`Vendido   (total registrado): R$${ctx.totalVendido.toFixed(2)}`);
  console.log(`Δ saldos observado: R$${deltaSaldos.toFixed(2)} · esperado: R$${deltaSaldosEsperado.toFixed(2)}`);
  const diff = Math.abs(deltaSaldos - deltaSaldosEsperado);
  if (diff < 0.01) console.log(`✅ Saldos consistentes (diff=${diff.toFixed(2)})`);
  else console.log(`❌ INCONSISTÊNCIA nos saldos: diff=R$${diff.toFixed(2)} — possível race condition!`);
  console.log(`Δ estoque: ${deltaEstoque} itens vendidos`);

  process.exit(0);
})().catch(err => { console.error("Fatal:", err); process.exit(1); });
