// ============================================================
// Cloud Functions — App GEH
// ============================================================
//
// Uma unica responsabilidade: manter os custom claims do Firebase Auth
// (papel + ativo) em sincronia com o doc /usuarios/{uid} do Firestore.
//
// Por que isso existe: firestore.rules precisava de get(/usuarios/uid)
// em toda funcao de papel (isAdmin/isOperador/isCaixa/isRecepcao) pra
// saber quem podia fazer o que. Cada get() dentro de uma regra conta
// como 1 leitura de documento — ou seja, toda operacao feita por
// operador/caixa/recepcao (o uso continuo durante o evento inteiro)
// pagava +1 leitura invisivel. Com o papel guardado como custom claim
// no proprio token assinado do usuario, as regras leem
// request.auth.token.papel direto, sem nenhuma leitura extra.
//
// O doc /usuarios/{uid} continua existindo e e a fonte da verdade —
// so passou a ser espelhado no token em vez de consultado a cada regra.
// ============================================================

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp();

const PAPEIS_VALIDOS = ['admin', 'operador', 'caixa', 'recepcao'];

// Aplica os claims pra um uid a partir dos dados do doc /usuarios/{uid}.
// `dados == null` significa que o doc foi apagado (usuario excluido em
// admin/usuarios.html) — nesse caso revoga o acesso explicitamente, pra
// nao deixar o token antigo (ainda em cache no navegador da pessoa) com
// um claim de papel que nao existe mais em nenhum lugar.
async function sincronizarClaims(uid, dados) {
  const auth = getAuth();

  if (!dados) {
    await auth.setCustomUserClaims(uid, { papel: null, ativo: false });
    return;
  }

  const papel = PAPEIS_VALIDOS.includes(dados.papel) ? dados.papel : null;
  const ativo = dados.ativo === true;
  await auth.setCustomUserClaims(uid, { papel, ativo });

  // displayName fica no proprio Auth (nao no claim) — assim o client le o
  // nome de exibicao do user object, sem gastar bytes do limite de 1000
  // do payload de custom claims.
  if (dados.nome) {
    try {
      await auth.updateUser(uid, { displayName: dados.nome });
    } catch (err) {
      // Nao é fatal — o app tem fallback pro email quando displayName
      // esta vazio. So loga pra investigar se acontecer com frequencia.
      console.warn(`[sincronizarClaims] falha ao atualizar displayName de ${uid}:`, err.message);
    }
  }
}

// Dispara em toda escrita (create/update/delete) em /usuarios/{uid}:
// cadastro manual (admin/usuarios.html), auto-provisionamento via Google
// (admin/login.html) e edicao de papel/ativo/exclusao.
//
// Usuarios que ja existiam ANTES desta funcao ser implantada não
// disparam esse trigger sozinhos (ele so reage a escritas novas) — pra
// esses, rode uma vez dev-tools/backup/backfill-claims.js.
exports.sincronizarClaimsUsuario = onDocumentWritten('usuarios/{uid}', async (event) => {
  const uid = event.params.uid;
  const depois = event.data?.after?.exists ? event.data.after.data() : null;
  try {
    await sincronizarClaims(uid, depois);
  } catch (err) {
    console.error(`[sincronizarClaimsUsuario] falha pra uid=${uid}:`, err);
    throw err; // deixa o Cloud Functions tentar de novo automaticamente
  }
});
