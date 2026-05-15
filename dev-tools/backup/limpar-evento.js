// ============================================================
// Limpeza de transacoes de um evento
// ============================================================
// Apaga todos os docs das colecoes de transacao que tenham
// eventoId == <id passado>. Usa Admin SDK, entao ignora as
// firestore.rules (consegue apagar ate ajustes_saldo e
// transferencias_saldo, que sao imutaveis pelo app).
//
// NAO mexe em clientes.saldo nem em produtos.estoque - so
// remove os docs de historico das colecoes abaixo.
//
// Como rodar:
//   cd dev-tools/backup
//   npm run limpar-evento              -> lista os eventos (id + nome)
//   npm run limpar-evento -- <eventoId> -> limpa o evento escolhido
//
// Pede confirmacao digitando o id do evento antes de apagar,
// pra evitar limpar um evento de producao sem querer.
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(KEY_PATH)) {
  console.error('ERRO: service-account.json nao encontrada em:');
  console.error('  ' + KEY_PATH);
  process.exit(1);
}

// Colecoes que carregam eventoId e contam como transacao do evento.
const COLECOES = [
  'vendas',
  'movimentacoes_saldo',
  'transferencias_saldo',
  'ajustes_saldo',
  'vendas_porta',
  'convites_antecipados',
];

const eventoId = process.argv[2];

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Sem argumento: lista os eventos pra a Juliana achar o id e sai.
async function listarEventos() {
  console.log('Eventos cadastrados (projeto ' + serviceAccount.project_id + '):\n');

  const cfg = await db.collection('config').doc('eventoAtivo').get();
  const ativoId = cfg.exists ? cfg.data().id : null;

  const snap = await db.collection('eventos').get();
  if (snap.empty) {
    console.log('  (nenhum evento cadastrado)');
  } else {
    for (const d of snap.docs) {
      const ev = d.data();
      const marca = d.id === ativoId ? '  <- ativo' : '';
      console.log('  ' + d.id.padEnd(24) + (ev.nome || '(sem nome)') + marca);
    }
  }
  console.log('\nPra limpar: npm run limpar-evento -- <eventoId>');
}

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (resp) => { rl.close(); resolve(resp); }));
}

// Apaga em lotes de 400 (writeBatch aceita ate 500 por commit).
async function apagarColecao(nome, idEvento) {
  const snap = await db.collection(nome).where('eventoId', '==', idEvento).get();
  if (snap.empty) return 0;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
  }
  return docs.length;
}

(async () => {
  if (!eventoId) {
    await listarEventos();
    process.exit(0);
  }

  console.log('Limpeza de transacoes de evento');
  console.log('Projeto: ' + serviceAccount.project_id);
  console.log('Evento:  ' + eventoId + '\n');

  // Tenta ler o nome do evento pra deixar a confirmacao mais clara.
  const evSnap = await db.collection('eventos').doc(eventoId).get();
  if (evSnap.exists) {
    console.log('Nome do evento: ' + (evSnap.data().nome || '(sem nome)'));
  } else {
    console.log('AVISO: nao existe doc /eventos/' + eventoId + ' (id pode estar errado).');
  }

  // Pre-contagem por colecao.
  console.log('\nContando docs a apagar...');
  const contagem = {};
  let total = 0;
  for (const nome of COLECOES) {
    const snap = await db.collection(nome).where('eventoId', '==', eventoId).get();
    contagem[nome] = snap.size;
    total += snap.size;
    console.log('  ' + nome.padEnd(24) + snap.size);
  }
  console.log('  ' + 'TOTAL'.padEnd(24) + total);

  if (total === 0) {
    console.log('\nNada a apagar. Saindo.');
    process.exit(0);
  }

  const resp = await perguntar(
    '\nIsso e IRREVERSIVEL. Digite o eventoId pra confirmar: '
  );
  if (resp.trim() !== eventoId) {
    console.log('Confirmacao nao bateu. Abortado, nada foi apagado.');
    process.exit(1);
  }

  console.log('\nApagando...');
  let apagados = 0;
  for (const nome of COLECOES) {
    const n = await apagarColecao(nome, eventoId);
    apagados += n;
    console.log('  ' + nome.padEnd(24) + n + ' apagados');
  }

  console.log('\nConcluido: ' + apagados + ' docs apagados.');
  console.log('Lembrete: clientes.saldo e produtos.estoque NAO foram alterados.');
  process.exit(0);
})().catch((err) => {
  console.error('FALHA NA LIMPEZA:');
  console.error(err);
  process.exit(1);
});
