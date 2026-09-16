// Testes automatizados das firestore.rules — Fase 1 da auditoria de robustez.
// Roda contra o Firestore Emulator local, NUNCA toca em dados reais.
// Uso: npm test (dispara o emulador, roda os testes, derruba o emulador).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  doc, setDoc, updateDoc, deleteDoc, addDoc, getDoc, collection, serverTimestamp,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `firebase emulators:exec` seta FIRESTORE_EMULATOR_HOST tipo "127.0.0.1:8080".
// Se rodar sem isso (emulador já de pé em outro terminal), cai no default.
const [emuHost, emuPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const emuPort = parseInt(emuPortStr, 10);

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FALHA ${name}`);
    console.log(`        ${err.message.split('\n')[0]}`);
  }
}

async function main() {
  const rulesPath = join(__dirname, '..', '..', 'firestore.rules');
  const testEnv = await initializeTestEnvironment({
    projectId: 'geh-rules-test',
    firestore: {
      rules: readFileSync(rulesPath, 'utf8'),
      host: emuHost,
      port: emuPort,
    },
  });

  const UID_ADMIN = 'admin1';
  const UID_SUPER = 'super1';
  const UID_OPERADOR = 'operador1';
  const UID_RECEPCAO = 'recepcao1';
  const EMAIL_SUPER = 'juliana.mayumi14@gmail.com';

  // Seed de dados ignorando as rules — isso é setup, não é o que estamos testando.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'usuarios', UID_ADMIN), { nome: 'Admin Teste', email: 'admin@teste.com', papel: 'admin', ativo: true });
    await setDoc(doc(db, 'usuarios', UID_SUPER), { nome: 'Juliana', email: EMAIL_SUPER, papel: 'admin', ativo: true });
    await setDoc(doc(db, 'usuarios', UID_OPERADOR), { nome: 'Operador Teste', email: 'operador@teste.com', papel: 'operador', ativo: true });
    await setDoc(doc(db, 'usuarios', UID_RECEPCAO), { nome: 'Recepção Teste', email: 'recepcao@teste.com', papel: 'recepcao', ativo: true });
    await setDoc(doc(db, 'produtos', 'prod1'), { nome: 'Brigadeiro', preco: 3.5, estoque: 100, categoria: 'Doces' });
    await setDoc(doc(db, 'clientes', 'cli1'), { saldo: 50 });
    await setDoc(doc(db, 'eventos', 'ev1'), { nome: 'Evento Teste', status: 'ativo', categoriasIngresso: [] });
  });

  const adminDb = testEnv.authenticatedContext(UID_ADMIN, { email: 'admin@teste.com' }).firestore();
  const superDb = testEnv.authenticatedContext(UID_SUPER, { email: EMAIL_SUPER }).firestore();
  const operadorDb = testEnv.authenticatedContext(UID_OPERADOR, { email: 'operador@teste.com' }).firestore();
  const recepcaoDb = testEnv.authenticatedContext(UID_RECEPCAO, { email: 'recepcao@teste.com' }).firestore();
  const semAuthDb = testEnv.unauthenticatedContext().firestore();

  console.log('\n== produtos (P0: operador não pode reescrever qualquer campo) ==');
  await test('operador PODE atualizar só o estoque', () =>
    assertSucceeds(updateDoc(doc(operadorDb, 'produtos', 'prod1'), { estoque: 90 }))
  );
  await test('operador NÃO PODE reescrever o nome do produto', () =>
    assertFails(updateDoc(doc(operadorDb, 'produtos', 'prod1'), { nome: 'Hackeado' }))
  );
  await test('operador NÃO PODE mandar estoque negativo', () =>
    assertFails(updateDoc(doc(operadorDb, 'produtos', 'prod1'), { estoque: -5 }))
  );
  await test('admin AINDA PODE editar qualquer campo do produto (regressão)', () =>
    assertSucceeds(updateDoc(doc(adminDb, 'produtos', 'prod1'), { nome: 'Brigadeiro Gourmet', preco: 4 }))
  );

  console.log('\n== vendas (P0: payload validado no servidor) ==');
  await test('operador PODE criar venda válida', () =>
    assertSucceeds(addDoc(collection(operadorDb, 'vendas'), {
      clienteId: 'cli1', total: 10,
      itens: [{ produtoId: 'prod1', nome: 'Brigadeiro', qtd: 2, subtotal: 10 }],
      operadorId: UID_OPERADOR, criadoEm: serverTimestamp(),
    }))
  );
  await test('operador NÃO PODE criar venda com total zero/negativo', () =>
    assertFails(addDoc(collection(operadorDb, 'vendas'), {
      clienteId: 'cli1', total: 0, itens: [{ produtoId: 'prod1', qtd: 1 }],
    }))
  );
  await test('operador NÃO PODE criar venda sem itens', () =>
    assertFails(addDoc(collection(operadorDb, 'vendas'), {
      clienteId: 'cli1', total: 10, itens: [],
    }))
  );

  console.log('\n== vendas_porta (P0: payload validado no servidor) ==');
  await test('recepção PODE criar venda na porta válida', () =>
    assertSucceeds(addDoc(collection(recepcaoDb, 'vendas_porta'), {
      eventoId: 'ev1', categoriaId: 'cat1', categoriaNome: 'Adulto', preco: 20, presente: true,
    }))
  );
  await test('recepção NÃO PODE criar venda na porta sem preço', () =>
    assertFails(addDoc(collection(recepcaoDb, 'vendas_porta'), {
      eventoId: 'ev1', categoriaId: 'cat1',
    }))
  );

  console.log('\n== usuarios (P0: proteção do super-admin / auto-exclusão) ==');
  await test('admin comum NÃO PODE excluir o doc do super-admin', () =>
    assertFails(deleteDoc(doc(adminDb, 'usuarios', UID_SUPER)))
  );
  await test('admin comum NÃO PODE excluir o próprio doc', () =>
    assertFails(deleteDoc(doc(adminDb, 'usuarios', UID_ADMIN)))
  );
  await test('admin comum NÃO PODE alterar o doc do super-admin', () =>
    assertFails(updateDoc(doc(adminDb, 'usuarios', UID_SUPER), { papel: 'operador' }))
  );
  await test('admin comum PODE excluir outro usuário comum (regressão)', () =>
    assertSucceeds(deleteDoc(doc(adminDb, 'usuarios', UID_OPERADOR)))
  );
  await test('super-admin PODE excluir um admin comum (regressão)', () =>
    assertSucceeds(deleteDoc(doc(superDb, 'usuarios', UID_ADMIN)))
  );

  console.log('\n== sanidade (usuário não logado) ==');
  await test('usuário não logado NÃO PODE ler produtos', () =>
    assertFails(getDoc(doc(semAuthDb, 'produtos', 'prod1')))
  );

  await testEnv.cleanup();

  const falhas = results.filter(r => !r.ok);
  console.log(`\n${results.length - falhas.length}/${results.length} testes passaram.`);
  if (falhas.length > 0) {
    console.log('\nFalharam:');
    falhas.forEach(f => console.log(`  - ${f.name}: ${f.err.message.split('\n')[0]}`));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Erro ao rodar os testes:', err);
  process.exitCode = 1;
});
