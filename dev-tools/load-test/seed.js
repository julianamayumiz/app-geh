// ============================================================
// Seed do teste de carga — SOMENTE projeto app-geh-dev
// ============================================================
// Cria (idempotente) o cardapio do evento grande (31 produtos, planilha da
// diretoria) + N clientes LT001..LTnnn com saldo inicial + config/eventoAtivo.
// Usa firebase-admin (ignora rules). Recusa qualquer projeto que nao seja o dev.
//
//   cd dev-tools/load-test && npm install
//   node seed.js --key ../../caminho/service-account-dev.json [--clientes 300] [--saldo 150]
//
// Ids dos produtos comecam com "lt-" e dos clientes com "LT": o run.js so mexe
// nesses, entao nao atrapalha dados antigos do dev. Rodar de novo restaura
// estoque e saldo (use antes de cada rodada).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const PROJETO_PERMITIDO = 'app-geh-dev';
const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > 0 ? process.argv[i + 1] : padrao;
};

const keyPath = arg('key', process.env.GOOGLE_APPLICATION_CREDENTIALS);
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('Informe a service account do DEV: --key <arquivo.json>');
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (key.project_id !== PROJETO_PERMITIDO) {
  console.error(`RECUSADO: a chave e do projeto "${key.project_id}". Este script so roda em ${PROJETO_PERMITIDO}.`);
  process.exit(1);
}

const N_CLIENTES = Number(arg('clientes', 300));
const SALDO = Number(arg('saldo', 150));

// [nome, preco, estoque, categoria] — planilha de estoque do evento
const COMIDA = 'Comida', ESPECIAIS = 'Doces e especiais', BEBIDAS = 'Bebidas';
const PRODUTOS = [
  ['Camarão e Rotate', 23, 200, COMIDA], ['Carne', 13, 150, COMIDA], ['Ebi Sando', 25, 100, COMIDA],
  ['Hiyashi Chuka', 20, 200, COMIDA], ['Ika', 30, 300, COMIDA], ['Kasane Sushi', 25, 199, COMIDA],
  ['Nikumaki Onigiri', 18, 150, COMIDA], ['Onigiri retângulo', 7, 150, COMIDA], ['Poteto Mochi', 7, 400, COMIDA],
  ['Takoyaki', 18, 166, COMIDA], ['Tamago Sando', 15, 100, COMIDA], ['Yakitori', 13, 225, COMIDA],
  ['Choux Cream', 12, 700, ESPECIAIS], ['Dango', 10, 150, ESPECIAIS], ['Dorayaki', 10, 150, ESPECIAIS],
  ['Parfait Matcha', 18, 150, ESPECIAIS], ['Yuzu Soda', 15, 100, ESPECIAIS], ['Shisso Sour', 15, 50, ESPECIAIS],
  ['Cranberry Ice Tea', 15, 120, ESPECIAIS], ['Matcha Lemonade', 15, 50, ESPECIAIS],
  ['Água', 6, 96, BEBIDAS], ['Água com gás', 6, 48, BEBIDAS], ['Cerveja Heineken', 13, 24, BEBIDAS],
  ['Coca-Cola lata', 9, 48, BEBIDAS], ['Coca-Cola zero lata', 9, 48, BEBIDAS], ['Guaraná lata', 9, 36, BEBIDAS],
  ['Guaraná zero lata', 9, 24, BEBIDAS], ['H2OH', 10, 60, BEBIDAS], ['2 Hai citrus', 15, 48, BEBIDAS],
  ['2 Hai passion', 15, 52, BEBIDAS], ['Cerveja Asahi', 20, 24, BEBIDAS]
];

admin.initializeApp({ credential: admin.credential.cert(key) });
const db = admin.firestore();

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const writer = db.bulkWriter();
for (const [nome, preco, estoque, categoria] of PRODUTOS) {
  writer.set(db.collection('produtos').doc('lt-' + slug(nome)), { nome, preco, estoque, categoria, promocao: false });
}
for (let i = 1; i <= N_CLIENTES; i++) {
  writer.set(db.collection('clientes').doc('LT' + String(i).padStart(3, '0')), { saldo: SALDO });
}
writer.set(db.collection('config').doc('eventoAtivo'), { id: 'loadtest', nome: 'Load Test' });
await writer.close();

// Usuarios de teste (operador + caixa) com custom claims direto no Auth, sem
// depender da Cloud Function de claims. Senha aleatoria vai pro config.dev.json.
const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.dev.json');
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
for (const [papel, email] of [['operador', 'operador-lt@teste.com'], ['caixa', 'caixa-lt@teste.com']]) {
  const senha = cfg[papel]?.email === email && cfg[papel]?.senha ? cfg[papel].senha : crypto.randomBytes(9).toString('base64url');
  let u;
  try { u = await admin.auth().getUserByEmail(email); await admin.auth().updateUser(u.uid, { password: senha }); }
  catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    u = await admin.auth().createUser({ email, password: senha, displayName: 'LT ' + papel });
  }
  await admin.auth().setCustomUserClaims(u.uid, { papel, ativo: true });
  await db.collection('usuarios').doc(u.uid).set({ nome: 'LT ' + papel, email, papel, ativo: true });
  cfg[papel] = { email, senha };
}
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('Usuarios operador-lt/caixa-lt criados com claims; credenciais salvas em config.dev.json');

const total = PRODUTOS.reduce((s, p) => s + p[1] * p[2], 0);
console.log(`Seed ok em ${PROJETO_PERMITIDO}: ${PRODUTOS.length} produtos (estoque R$ ${total}), ${N_CLIENTES} clientes com R$ ${SALDO}.`);
