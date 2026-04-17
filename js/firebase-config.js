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
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export {
  db, auth,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction, deleteDoc, writeBatch,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup
};
