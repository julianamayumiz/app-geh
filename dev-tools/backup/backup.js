// ============================================================
// Backup do Firestore -> Excel (.xlsx)
// ============================================================
// Roda no terminal (Node.js). Lê todas as coleções do Firestore
// usando a chave de servico (service-account.json) e gera um
// arquivo .xlsx em ./backups com uma aba por coleção.
//
// Como rodar manualmente:
//   npm install        (uma vez)
//   npm run backup
//
// Como agendar pra rodar sozinho: ver README.md
// ============================================================

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const XLSX = require('xlsx');

const ROOT = __dirname;
const KEY_PATH = path.join(ROOT, 'service-account.json');
const OUT_DIR = path.join(ROOT, 'backups');
// Quantos backups manter. Os mais antigos são apagados depois de gerar
// o novo. Coloque 0 pra manter todos pra sempre.
const MANTER_ULTIMOS = 30;

if (!fs.existsSync(KEY_PATH)) {
  console.error('ERRO: chave service-account.json nao encontrada em:');
  console.error('  ' + KEY_PATH);
  console.error('Veja o README.md para baixar essa chave do Firebase Console.');
  process.exit(1);
}

const serviceAccount = require(KEY_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Converte um valor do Firestore para algo que cabe numa célula do Excel.
// - Timestamp -> ISO string (YYYY-MM-DDTHH:mm:ss.sssZ)
// - GeoPoint, DocumentReference -> string descritiva
// - Array / Object aninhado -> JSON em uma única linha
// - undefined/null -> string vazia
function paraCelula(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof admin.firestore.Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v.toDate === 'function') {
    try { return v.toDate().toISOString(); } catch (e) { /* cai pro fallback */ }
  }
  if (v && typeof v === 'object' && 'latitude' in v && 'longitude' in v) {
    return `${v.latitude},${v.longitude}`;
  }
  if (v && typeof v === 'object' && v.path && typeof v.path === 'string') {
    return `ref:${v.path}`;
  }
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return v;
}

// Achata um doc num objeto plano com _id na frente. Mantém todas as
// chaves encontradas em qualquer doc da coleção (união dos campos).
function docParaLinha(doc) {
  const data = doc.data() || {};
  const linha = { _id: doc.id };
  for (const [k, v] of Object.entries(data)) linha[k] = paraCelula(v);
  return linha;
}

function timestampArquivo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
         `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Sheet name limit do Excel é 31 chars e proibe : \ / ? * [ ]
function nomeAba(colecao) {
  const limpo = colecao.replace(/[:\\/?*\[\]]/g, '_');
  return limpo.slice(0, 31);
}

function podarBackupsAntigos() {
  if (!MANTER_ULTIMOS || MANTER_ULTIMOS <= 0) return;
  const arquivos = fs.readdirSync(OUT_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.xlsx'))
    .map(f => ({ nome: f, mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const sobrando = arquivos.slice(MANTER_ULTIMOS);
  for (const { nome } of sobrando) {
    fs.unlinkSync(path.join(OUT_DIR, nome));
    console.log('  removido (antigo): ' + nome);
  }
}

(async () => {
  const inicio = Date.now();
  console.log('Backup do Firestore -> Excel');
  console.log('Projeto: ' + serviceAccount.project_id);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const colecoes = await db.listCollections();
  if (colecoes.length === 0) {
    console.error('Nenhuma colecao encontrada. Backup cancelado.');
    process.exit(2);
  }

  const wb = XLSX.utils.book_new();
  const resumo = [];

  for (const ref of colecoes) {
    const nome = ref.id;
    process.stdout.write('  ' + nome + ' ... ');
    const snap = await ref.get();
    const linhas = snap.docs.map(docParaLinha);
    const ws = linhas.length > 0
      ? XLSX.utils.json_to_sheet(linhas)
      : XLSX.utils.aoa_to_sheet([['(coleção vazia)']]);
    XLSX.utils.book_append_sheet(wb, ws, nomeAba(nome));
    resumo.push({ colecao: nome, documentos: linhas.length });
    console.log(linhas.length + ' docs');
  }

  // Aba final com metadados do backup
  const wsResumo = XLSX.utils.json_to_sheet([
    { campo: 'projeto', valor: serviceAccount.project_id },
    { campo: 'gerado_em', valor: new Date().toISOString() },
    { campo: 'total_colecoes', valor: resumo.length },
    { campo: 'total_documentos', valor: resumo.reduce((s, r) => s + r.documentos, 0) },
    {},
    ...resumo.map(r => ({ campo: r.colecao, valor: r.documentos })),
  ]);
  XLSX.utils.book_append_sheet(wb, wsResumo, '_resumo');

  const arquivo = path.join(OUT_DIR, 'backup-' + timestampArquivo() + '.xlsx');
  XLSX.writeFile(wb, arquivo);
  console.log('Salvo: ' + arquivo);

  podarBackupsAntigos();

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('Concluido em ' + seg + 's.');
  process.exit(0);
})().catch(err => {
  console.error('FALHA NO BACKUP:');
  console.error(err);
  process.exit(1);
});
