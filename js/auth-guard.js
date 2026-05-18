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
  if (location.pathname.includes('/recepcao/')) return '../admin/login.html';
  return 'admin/login.html';
}

function homeFor(perfil) {
  if (perfil?.papel === 'operador') return '/operador/index.html';
  if (perfil?.papel === 'caixa') return '/caixa/index.html';
  if (perfil?.papel === 'recepcao') return '/recepcao/index.html';
  return '/admin/dashboard.html';
}

export async function carregarPerfil(user) {
  if (!user) return null;
  let perfil = null;
  // Tenta ate 2 vezes para absorver falhas transientes de rede (ex: telefone
  // acordando do sleep enquanto o token do App Check ainda esta renovando).
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const snap = await getDoc(doc(db, 'usuarios', user.uid));
      if (snap.exists()) perfil = { uid: user.uid, ...snap.data() };
      break;
    } catch (e) {
      console.warn(`[auth-guard] erro lendo perfil (tentativa ${tentativa}/2):`, e);
      if (tentativa < 2) await new Promise(r => setTimeout(r, 1500));
      else throw e; // Re-lanca na segunda falha — caller decide o que fazer
    }
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

      let perfil;
      try {
        perfil = await carregarPerfil(user);
      } catch (e) {
        // Firestore nao respondeu nem apos a segunda tentativa.
        // NAO deslogar — o usuario esta autenticado. Mostra erro e
        // deixa o usuario recarregar manualmente.
        unsub();
        document.body.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                      min-height:100dvh;gap:1rem;padding:2rem;font-family:sans-serif;text-align:center;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 6s4-2 11-2 11 2 11 2"/><path d="M1 12s4-2 11-2 11 2 11 2"/>
              <line x1="1" y1="6" x2="1" y2="18"/><line x1="23" y1="6" x2="23" y2="18"/>
              <line x1="2" y1="18" x2="22" y2="18"/><line x1="12" y1="2" x2="12" y2="22"/>
            </svg>
            <p style="font-size:1.1rem;font-weight:600;color:#1e293b;margin:0">Sem conexao</p>
            <p style="color:#64748b;margin:0;font-size:0.95rem">
              Nao foi possivel carregar seu perfil.<br>Verifique a internet e tente novamente.
            </p>
            <button onclick="location.reload()"
              style="margin-top:0.5rem;padding:0.65rem 1.5rem;background:#1e3a8a;color:#fff;
                     border:none;border-radius:10px;font-size:1rem;cursor:pointer;">
              Tentar novamente
            </button>
          </div>`;
        return;
      }

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
