// Testes automatizados das firestore.rules — Fases 1 e 4 da auditoria de robustez.
// Roda contra o Firestore Emulator local, NUNCA toca em dados reais.
// Uso: npm test (dispara o emulador, roda os testes, derruba o emulador).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  doc, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, collection,
  query, where, serverTimestamp,
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
    await setDoc(doc(db, 'convites_antecipados', 'conv1'), {
      eventoId: 'ev1', familia: 'Silva', numero: '001', nome: 'João', categoria: 'Adulto',
      pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
    // Fase 5 — familias e convites vinculados a elas (acesso público por código)
    await setDoc(doc(db, 'familias', 'fam1abcdefghij1234567890'), { nome: 'Silva', ativo: true, criadoEm: null });
    await setDoc(doc(db, 'familias', 'fam2abcdefghij1234567890'), { nome: 'Tanaka', ativo: false, criadoEm: null });
    await setDoc(doc(db, 'convites_antecipados', 'convFam1'), {
      eventoId: 'ev1', familiaId: 'fam1abcdefghij1234567890', familia: 'Silva', numero: '010',
      nome: '', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
    await setDoc(doc(db, 'convites_antecipados', 'convFam2'), {
      eventoId: 'ev1', familiaId: 'fam2abcdefghij1234567890', familia: 'Tanaka', numero: '011',
      nome: '', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
    await setDoc(doc(db, 'convites_antecipados', 'convFamCurto'), {
      eventoId: 'ev1', familiaId: 'curto', familia: 'Curto', numero: '012',
      nome: '', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
    // familiaId aponta pra uma familias/{id} que não existe (órfão).
    await setDoc(doc(db, 'convites_antecipados', 'convFamOrfao'), {
      eventoId: 'ev1', familiaId: 'famOrfaoxxxxxxxxxxxxxxxx', familia: 'Orfao', numero: '013',
      nome: '', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
    // Convite importado via planilha, familiaId explicitamente null (formato real do import).
    await setDoc(doc(db, 'convites_antecipados', 'convFamNull'), {
      eventoId: 'ev1', familiaId: null, familia: 'Planilha', numero: '014',
      nome: 'Alguém', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    });
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

  console.log('\n== eventos (P0 Fase 4: categoriasIngresso precisa ser lista) ==');
  await test('recepção PODE atualizar categoriasIngresso com uma lista', () =>
    assertSucceeds(updateDoc(doc(recepcaoDb, 'eventos', 'ev1'), {
      categoriasIngresso: [{ id: 'cat1', nome: 'Adulto', precoPorta: 20, qtdPorta: 49 }],
    }))
  );
  await test('recepção NÃO PODE mandar categoriasIngresso que não é lista', () =>
    assertFails(updateDoc(doc(recepcaoDb, 'eventos', 'ev1'), {
      categoriasIngresso: 'nao é uma lista',
    }))
  );

  console.log('\n== convites_antecipados (Fase 4: tipos validados no check-in) ==');
  await test('recepção PODE marcar presença (check-in válido)', () =>
    assertSucceeds(updateDoc(doc(recepcaoDb, 'convites_antecipados', 'conv1'), {
      presente: true, checkInEm: serverTimestamp(), checkInPor: 'Recepção Teste',
    }))
  );
  await test('recepção PODE desfazer presença (check-in nulo)', () =>
    assertSucceeds(updateDoc(doc(recepcaoDb, 'convites_antecipados', 'conv1'), {
      presente: false, checkInEm: null, checkInPor: null,
    }))
  );
  await test('recepção NÃO PODE mandar "presente" que não é booleano', () =>
    assertFails(updateDoc(doc(recepcaoDb, 'convites_antecipados', 'conv1'), {
      presente: 'sim', checkInEm: serverTimestamp(), checkInPor: 'Recepção Teste',
    }))
  );

  console.log('\n== familias / convites por família (Fase 5: acesso público por código) ==');
  await test('não logado PODE listar o próprio convite sabendo o familiaId exato', () =>
    assertSucceeds(getDocs(query(collection(semAuthDb, 'convites_antecipados'), where('familiaId', '==', 'fam1abcdefghij1234567890'))))
  );
  await test('não logado NÃO PODE listar convites com familiaId curto/inválido', () =>
    assertFails(getDocs(query(collection(semAuthDb, 'convites_antecipados'), where('familiaId', '==', 'curto'))))
  );
  await test('não logado NÃO PODE listar convites_antecipados sem filtro (sem where)', () =>
    assertFails(getDocs(collection(semAuthDb, 'convites_antecipados')))
  );
  await test('não logado NÃO PODE listar convites_antecipados com range query (sem where de igualdade)', () =>
    assertFails(getDocs(query(collection(semAuthDb, 'convites_antecipados'), where('familiaId', '>=', ''))))
  );
  await test('convite com familiaId orfao (familia inexistente) NAO PODE ser editado', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFamOrfao'), { nome: 'Teste' }))
  );
  await test('convite importado por planilha (familiaId: null) NAO PODE ser editado via posse de familiaId', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFamNull'), { nome: 'Teste' }))
  );
  await test('família PODE preencher nome + situação (pago) do próprio convite', () =>
    assertSucceeds(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano de Tal', situacao: 'pago', pago: true }))
  );
  await test('família PODE marcar convite como "não vendido" sem nome', () =>
    assertSucceeds(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: '', situacao: 'nao_vendido', pago: false }))
  );
  await test('família NÃO PODE salvar sem nome se a situação não for "não vendido"', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: '', situacao: 'reservado', pago: false }))
  );
  await test('família NÃO PODE mandar situação fora do enum permitido', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', situacao: 'cancelado', pago: false }))
  );
  await test('família NÃO PODE mandar pago inconsistente com a situação', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', situacao: 'reservado', pago: true }))
  );
  await test('família NÃO PODE mandar categoria (campo removido em favor de situação)', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', situacao: 'pago', pago: true, categoria: 'Adulto' }))
  );
  await test('família NÃO PODE mudar o número do convite', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', numero: '999' }))
  );
  await test('família NÃO PODE transferir o convite pra outra família', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', familiaId: 'fam2abcdefghij1234567890' }))
  );
  await test('família NÃO PODE marcar presença/check-in', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam1'), { nome: 'Fulano', presente: true }))
  );
  await test('família inativa NÃO PODE editar convite', () =>
    assertFails(updateDoc(doc(semAuthDb, 'convites_antecipados', 'convFam2'), { nome: 'Yuki' }))
  );
  await test('não logado NÃO PODE criar convite novo', () =>
    assertFails(addDoc(collection(semAuthDb, 'convites_antecipados'), {
      eventoId: 'ev1', familiaId: 'fam1abcdefghij1234567890', familia: 'Silva',
      numero: '099', nome: 'Invasor', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    }))
  );
  await test('não logado NÃO PODE listar todas as famílias (enumeração bloqueada)', () =>
    assertFails(getDocs(collection(semAuthDb, 'familias')))
  );
  await test('não logado PODE ler o próprio doc de família por ID (validar código no portal)', () =>
    assertSucceeds(getDoc(doc(semAuthDb, 'familias', 'fam1abcdefghij1234567890')))
  );
  await test('não logado NÃO PODE criar família nova', () =>
    assertFails(setDoc(doc(semAuthDb, 'familias', 'fam3xxxxxxxxxxxxxxxxxxxx'), { nome: 'Invasora', ativo: true }))
  );
  await test('admin AINDA PODE criar convite pra família (regressão)', () =>
    assertSucceeds(addDoc(collection(superDb, 'convites_antecipados'), {
      eventoId: 'ev1', familiaId: 'fam1abcdefghij1234567890', familia: 'Silva',
      numero: '020', nome: '', categoria: '', pago: true, presente: false, checkInEm: null, checkInPor: null,
    }))
  );
  await test('admin AINDA PODE editar qualquer campo do convite (regressão)', () =>
    assertSucceeds(updateDoc(doc(superDb, 'convites_antecipados', 'convFam1'), { familia: 'Silva Editado' }))
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
