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
  apiKey: "AIzaSyAJtIikEp_tdyX33_2UGWcOSCuKtEbJaW8",
  authDomain: "app-geh-dev.firebaseapp.com",
  projectId: "app-geh-dev",
  storageBucket: "app-geh-dev.firebasestorage.app",
  messagingSenderId: "780193741149",
  appId: "1:780193741149:web:23f34f5b489119bf9790b4"
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

const app  = initializeApp(firebaseConfig);

// App Check — protege Firestore/Auth contra abuso fora do navegador
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});

const db   = getFirestore(app);
const auth = getAuth(app);

// App secundário usado SÓ para criar novos usuários sem deslogar
// o admin atual. createUserWithEmailAndPassword no app principal
// trocaria a sessão.
function criarAppSecundario() {
  const secundario = initializeApp(firebaseConfig, 'cadastro-' + Date.now());
<<<<<<< HEAD
=======
  initializeAppCheck(secundario, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
>>>>>>> 9bf69ef8c85ddfdc4a7d07f92bae193ae334a660
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
