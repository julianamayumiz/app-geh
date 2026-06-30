// ============================================================
// Seed de usuarios de teste -> Firebase Auth + Firestore
// ============================================================
// Cria as contas de login pro teste de carga: conta no Auth
// (e-mail + senha) e o doc de papel em /usuarios/{uid}.
//
// Usa a mesma service-account.json do backup (projeto de
// producao app-geh-cc577) e o mesmo node_modules.
//
// Como rodar:
//   cd dev-tools/backup
//   npm install            (uma vez, se ainda nao rodou)
//   npm run seed-usuarios
//
// Idempotente: se o e-mail ja existir no Auth, reaproveita a
// conta, regrava a senha e o doc de papel. Rodar duas vezes
// nao quebra nada.
// ============================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('ERRO: service-account.json nao encontrada em:');
  console.error('  ' + KEY_PATH);
  console.error('Veja o README.md desta pasta para baixar a chave.');
  process.exit(1);
}

// ------------------------------------------------------------
// Configuracao do seed — edite aqui se precisar
// ------------------------------------------------------------
const DOMINIO = 'teste.com';
const SENHA = 'geh2026';

// Quantos usuarios de cada papel. Os e-mails saem sequenciais:
// operador01@teste.com, operador02@..., caixa01@..., etc.
const PLANO = [
  { papel: 'operador', prefixo: 'operador', quantidade: 14 },
  { papel: 'caixa',    prefixo: 'caixa',    quantidade: 4 },
  { papel: 'recepcao', prefixo: 'recepcao', quantidade: 2 },
];

function montarUsuarios() {
  const lista = [];
  for (const { papel, prefixo, quantidade } of PLANO) {
    for (let i = 1; i <= quantidade; i++) {
      const num = String(i).padStart(2, '0');
      lista.push({
        email: `${prefixo}${num}@${DOMINIO}`,
        nome: `${prefixo[0].toUpperCase()}${prefixo.slice(1)} ${num}`,
        papel,
      });
    }
  }
  return lista;
}

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  const usuarios = montarUsuarios();
  console.log('Seed de usuarios de teste');
  console.log('Projeto: ' + serviceAccount.project_id);
  console.log('Total: ' + usuarios.length + ' usuarios\n');

  let criados = 0, reaproveitados = 0, falhas = 0;

  for (const u of usuarios) {
    try {
      let userRecord;
      try {
        userRecord = await auth.createUser({
          email: u.email,
          password: SENHA,
          displayName: u.nome,
        });
        criados++;
        process.stdout.write('  criado      ');
      } catch (e) {
        if (e.code !== 'auth/email-already-exists') throw e;
        userRecord = await auth.getUserByEmail(u.email);
        await auth.updateUser(userRecord.uid, { password: SENHA, displayName: u.nome });
        reaproveitados++;
        process.stdout.write('  reaproveitado');
      }

      await db.collection('usuarios').doc(userRecord.uid).set({
        nome: u.nome,
        email: u.email,
        papel: u.papel,
        ativo: true,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(` ${u.email} (${u.papel})`);
    } catch (err) {
      falhas++;
      console.log(`  FALHA         ${u.email}: ${err.message}`);
    }
  }

  console.log(`\nConcluido: ${criados} criados, ${reaproveitados} reaproveitados, ${falhas} falhas.`);
  console.log(`Senha de todos: ${SENHA}`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch(err => {
  console.error('FALHA NO SEED:');
  console.error(err);
  process.exit(1);
});
