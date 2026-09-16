// ============================================================
// ⚠️  CONFIGURAÇÃO DO FIREBASE
// ============================================================
//
// PASSO A PASSO pra preencher isso aqui:
//
// 1. Vá em https://console.firebase.google.com
// 2. Clique em "Adicionar projeto" → nome: "app-geh"
// 3. Desative Google Analytics (não precisa) → Criar projeto
// 4. Dentro do projeto, clique no ícone "</>"  (Web) pra registrar um app
// 5. Apelido do app: "App GEH Web" → Registrar
// 6. Copie o objeto `firebaseConfig` que aparece e cole ABAIXO (substitua o que está aí)
// 7. Continue → Ir para o console
//
// Depois, no menu lateral do Firebase:
// - "Build > Firestore Database" → Criar banco → Iniciar no modo de produção → Localização southamerica-east1
// - "Build > Authentication" → Começar → aba "Sign-in method" → Ativar "E-mail/senha"
//
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyA_vJEYqPYZOsdu4L1bXNX49I4vguxfDMk",
  authDomain: "app-geh-cc577.firebaseapp.com",
  projectId: "app-geh-cc577",
  storageBucket: "app-geh-cc577.firebasestorage.app",
  messagingSenderId: "712013991512",
  appId: "1:712013991512:web:197f07d3ebb37b4f94042d"
};

// ============================================================
// Inicialização — não precisa mexer abaixo
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAppCheck, ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction, deleteDoc, writeBatch,
  getAggregateFromServer, sum, count
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// reCAPTCHA v3 site key (pública — pode versionar)
const RECAPTCHA_SITE_KEY = "6Ldb1MssAAAAAEhOjOpntslCUGGFn--3g6TFFDaw";

// Em dev local: gere um debug token no console do App Check e
// cole no localStorage do browser, OU descomente a linha abaixo
// pra ele aparecer no console pra você registrar:
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

// Mensagem auto-contida (sem depender de nenhum outro modulo) pro caso da
// inicializacao do Firebase quebrar antes de qualquer coisa poder rodar —
// sem isso, o app fica com tela em branco e so um erro no console.
function mostrarErroFatal(msg) {
  try {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#1E293B;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;' +
      'font:16px/1.5 system-ui,sans-serif;';
    div.textContent = msg;
    document.body.appendChild(div);
  } catch (_) {}
}

let app;
try {
  app = initializeApp(firebaseConfig);
} catch (err) {
  mostrarErroFatal('Nao foi possivel iniciar o app (erro de configuracao do Firebase). Recarregue a pagina ou avise a diretoria.');
  throw err;
}

// App Check — protege Firestore/Auth contra abuso fora do navegador.
// Se falhar (ex: reCAPTCHA bloqueado por adblock/rede), o app ainda
// funciona sem essa camada extra — nao bloqueia a inicializacao.
try {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
} catch (err) {
  console.error('[firebase-config] App Check falhou ao iniciar:', err);
}

const db   = getFirestore(app);
const auth = getAuth(app);

// App secundário usado SÓ para criar novos usuários sem deslogar
// o admin atual. createUserWithEmailAndPassword no app principal
// trocaria a sessão.
function criarAppSecundario() {
  const secundario = initializeApp(firebaseConfig, 'cadastro-' + Date.now());
  initializeAppCheck(secundario, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
  return { app: secundario, auth: getAuth(secundario) };
}

export {
  app, db, auth, firebaseConfig, criarAppSecundario,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction, deleteDoc, writeBatch,
  getAggregateFromServer, sum, count,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  sendPasswordResetEmail
};
