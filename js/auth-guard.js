// ============================================================
// Auth guard — controle de acesso por papel
// ============================================================
//
// Uso:
//   import { requireAuth } from "../js/auth-guard.js";
//   const { user, perfil } = await requireAuth({ papel: 'operador' });
//
// Se o usuário não estiver logado, ou não tiver doc em
// /usuarios/{uid}, ou estiver com ativo:false, é deslogado e
// mandado pro login.
//
// SUPER_ADMIN_EMAIL é fallback: se a Juliana logar e ainda não
// existir doc dela em /usuarios, ela passa como admin. Resolve o
// bootstrap e garante que ela nunca fique trancada do lado de fora.
// ============================================================

import {
  auth, db, doc, getDoc, onAuthStateChanged, signOut
} from "./firebase-config.js";

export const SUPER_ADMIN_EMAIL = "juliana.mayumi14@gmail.com";

function loginUrl() {
  if (location.pathname.includes('/admin/')) return 'login.html';
  if (location.pathname.includes('/operador/')) return '../admin/login.html';
  if (location.pathname.includes('/caixa/')) return '../admin/login.html';
  return 'admin/login.html';
}

function homeFor(perfil) {
  if (perfil?.papel === 'operador') return '/operador/index.html';
  if (perfil?.papel === 'caixa') return '/caixa/index.html';
  return '/admin/dashboard.html';
}

export async function carregarPerfil(user) {
  if (!user) return null;
  let perfil = null;
  try {
    const snap = await getDoc(doc(db, 'usuarios', user.uid));
    if (snap.exists()) perfil = { uid: user.uid, ...snap.data() };
  } catch (e) {
    console.warn('[auth-guard] erro lendo perfil', e);
  }
  if (!perfil && user.email === SUPER_ADMIN_EMAIL) {
    perfil = {
      uid: user.uid,
      nome: 'Juliana (super-admin)',
      email: user.email,
      papel: 'admin',
      ativo: true,
      _bootstrap: true,
    };
  }
  return perfil;
}

export function requireAuth({ papel } = {}) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        unsub();
        window.location.href = loginUrl() + '?erro=login';
        return;
      }
      const perfil = await carregarPerfil(user);

      if (!perfil || perfil.ativo === false) {
        unsub();
        await signOut(auth);
        window.location.href = loginUrl() + '?erro=sem-acesso';
        return;
      }

      if (papel) {
        const aceitos = Array.isArray(papel) ? papel : [papel];
        const ok = perfil.papel === 'admin' || aceitos.includes(perfil.papel);
        if (!ok) {
          unsub();
          window.location.href = homeFor(perfil);
          return;
        }
      }

      resolve({ user, perfil });
    });
  });
}
