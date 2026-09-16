// ============================================================
// Backfill de custom claims (papel/ativo) — roda UMA VEZ
// ============================================================
// Contexto: a partir desta mudança, firestore.rules lê papel/ativo do
// token de Auth (custom claims), sincronizado automaticamente pela
// Cloud Function `sincronizarClaimsUsuario` toda vez que /usuarios/{uid}
// é escrito. Mas essa função só reage a escritas NOVAS — quem já tinha
// doc em /usuarios antes do deploy da função não tem claim nenhum ainda,
// e por isso fica sem acesso até rodar este script uma vez.
//
// Como rodar (depois de já ter feito `firebase deploy --only functions`):
//   npm install        (uma vez, se ainda não rodou pro backup)
//   npm run backfill-claims
//
// Usa a mesma service-account.json do backup (não versionada — ver README).
// ============================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ROOT = __dirname;
const KEY_PATH = path.join(ROOT, 'service-account.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('ERRO: chave service-account.json nao encontrada em:');
  console.error('  ' + KEY_PATH);
  console.error('Veja o README.md (nesta mesma pasta) pra baixar essa chave do Firebase Console.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
});

const PAPEIS_VALIDOS = ['admin', 'operador', 'caixa', 'recepcao'];

async function main() {
  const db = admin.firestore();
  const auth = admin.auth();

  const snap = await db.collection('usuarios').get();
  console.log(`Encontrados ${snap.size} usuarios em /usuarios. Sincronizando claims...\n`);

  let ok = 0;
  let falhas = 0;

  for (const doc of snap.docs) {
    const uid = doc.id;
    const dados = doc.data();
    const papel = PAPEIS_VALIDOS.includes(dados.papel) ? dados.papel : null;
    const ativo = dados.ativo === true;

    try {
      await auth.setCustomUserClaims(uid, { papel, ativo });
      if (dados.nome) {
        try { await auth.updateUser(uid, { displayName: dados.nome }); } catch (_) {}
      }
      console.log(`  ok    ${dados.nome || uid} (${papel || 'sem papel valido'}, ativo=${ativo})`);
      ok++;
    } catch (err) {
      console.log(`  FALHA ${dados.nome || uid}: ${err.message}`);
      falhas++;
    }
  }

  console.log(`\n${ok} sincronizados, ${falhas} falharam de ${snap.size} total.`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Erro ao rodar o backfill:', err);
  process.exitCode = 1;
});
