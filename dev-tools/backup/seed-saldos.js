// ============================================================
// Seed de saldo nos clientes-alvo dos operadores
// ============================================================
// Pre-carrega saldo nos clientes usados pelos fluxos de operador
// do teste, pra cada operador conseguir vender sem depender de
// um caixa antes. Escreve direto o campo saldo (nao gera doc em
// movimentacoes_saldo - e so setup de teste).
//
// Como rodar:
//   cd dev-tools/backup
//   npm run seed-saldos
//
// Idempotente: roda quantas vezes quiser, sempre deixa o saldo
// no valor configurado abaixo.
// ============================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('ERRO: service-account.json nao encontrada em:');
  console.error('  ' + KEY_PATH);
  process.exit(1);
}

// ------------------------------------------------------------
// Configuracao — edite aqui se precisar
// ------------------------------------------------------------
const ID_INICIAL = 5011;   // primeiro cliente-alvo dos operadores
const ID_FINAL = 5080;     // ultimo
const SALDO = 500;         // saldo pre-carregado em cada um

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  const ids = [];
  for (let i = ID_INICIAL; i <= ID_FINAL; i++) ids.push(String(i));

  console.log('Seed de saldo de teste');
  console.log('Projeto: ' + serviceAccount.project_id);
  console.log(`Clientes ${ID_INICIAL}-${ID_FINAL} -> saldo R$ ${SALDO}\n`);

  let ok = 0, faltando = 0;

  // writeBatch aceita ate 500 operacoes por commit
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const batch = db.batch();
    for (const id of chunk) {
      const ref = db.collection('clientes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) { faltando++; console.log('  NAO EXISTE: ' + id); continue; }
      batch.update(ref, { saldo: SALDO });
      ok++;
    }
    await batch.commit();
  }

  console.log(`\nConcluido: ${ok} clientes com saldo R$ ${SALDO}, ${faltando} nao encontrados.`);
  process.exit(faltando > 0 ? 1 : 0);
})().catch(err => {
  console.error('FALHA NO SEED DE SALDO:');
  console.error(err);
  process.exit(1);
});
