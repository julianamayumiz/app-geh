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
//
// CACHE DE PERFIL (stale-while-revalidate):
// O perfil eh persistido em localStorage apos cada leitura bem
// sucedida. Em carregamentos subsequentes, o app eh liberado na hora
// com o perfil em cache (zero espera por App Check + Firestore),
// e a validacao real roda em background. Se a validacao descobrir
// que o perfil mudou (desativado, papel diferente), o cache eh
// limpo pra que o proximo carregamento force re-login. Trade-off:
// se um acesso for revogado durante uma sessao ativa, o usuario
// pode continuar usando o app por mais um carregamento.
// ============================================================

import {
  auth, db, doc, getDoc, onAuthStateChanged, signOut
} from "./firebase-config.js";
import { toast } from "./ui.js";

export const SUPER_ADMIN_EMAIL = "juliana.mayumi14@gmail.com";

const PROFILE_CACHE_KEY = 'app-geh-perfil-v1';

function lerPerfilCache(uid) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw);
    if (!env || env.uid !== uid || !env.perfil) return null;
    return env.perfil;
  } catch {
    return null;
  }
}

function salvarPerfilCache(perfil) {
  if (!perfil || !perfil.uid) return;
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      uid: perfil.uid,
      perfil,
      salvoEm: Date.now()
    }));
  } catch {}
}

function limparPerfilCache() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

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

function papelOk(perfil, papel) {
  if (!papel) return true;
  if (perfil?.papel === 'admin') return true;
  const aceitos = Array.isArray(papel) ? papel : [papel];
  return aceitos.includes(perfil?.papel);
}

// Revalida o perfil contra o Firestore depois que ja liberamos o app
// com o cache. Atualiza o cache se OK, limpa se algo mudou (desativado,
// papel diferente, perfil sumiu). Falha de rede e silenciada pra manter
// a sessao funcionando.
async function revalidarEmBackground(user, papel) {
  try {
    const fresco = await carregarPerfil(user);
    if (!fresco) {
      limparPerfilCache();
      return;
    }
    if (fresco.ativo === false) {
      limparPerfilCache();
      return;
    }
    if (!papelOk(fresco, papel)) {
      limparPerfilCache();
      return;
    }
    salvarPerfilCache(fresco);
  } catch (e) {
    console.warn('[auth-guard] revalidacao em background falhou:', e);
  }
}

function mostrarTelaOffline() {
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
}

export function requireAuth({ papel } = {}) {
  return new Promise((resolve) => {
    let resolvido = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        unsub();
        limparPerfilCache();
        if (!resolvido) {
          resolvido = true;
          window.location.href = loginUrl() + '?erro=login';
        }
        return;
      }

      // CAMINHO RAPIDO: tem perfil em cache pro mesmo uid? Libera na hora.
      const cached = lerPerfilCache(user.uid);
      if (!resolvido && cached && cached.ativo !== false && papelOk(cached, papel)) {
        resolvido = true;
        unsub();

        const aviso = sessionStorage.getItem('_aviso_acesso');
        if (aviso) {
          sessionStorage.removeItem('_aviso_acesso');
          requestAnimationFrame(() => toast(aviso, { tipo: 'info', duracao: 4000 }));
        }

        resolve({ user, perfil: cached });

        // Em background, revalida pra proxima visita
        revalidarEmBackground(user, papel);
        return;
      }

      // CAMINHO LENTO: sem cache util — le do Firestore como antes
      let perfil;
      try {
        perfil = await carregarPerfil(user);
      } catch (e) {
        // Firestore nao respondeu nem apos a segunda tentativa.
        // NAO deslogar — o usuario esta autenticado. Mostra erro e
        // deixa o usuario recarregar manualmente.
        unsub();
        mostrarTelaOffline();
        return;
      }

      if (!perfil || perfil.ativo === false) {
        unsub();
        limparPerfilCache();
        await signOut(auth);
        if (!resolvido) {
          resolvido = true;
          window.location.href = loginUrl() + '?erro=sem-acesso';
        }
        return;
      }

      if (!papelOk(perfil, papel)) {
        unsub();
        // Cache pode ficar — usuario nao perdeu acesso, so nao tem
        // permissao pra esta tela especifica
        salvarPerfilCache(perfil);
        sessionStorage.setItem('_aviso_acesso', 'Voce nao tem permissao para acessar essa area.');
        if (!resolvido) {
          resolvido = true;
          window.location.href = homeFor(perfil);
        }
        return;
      }

      salvarPerfilCache(perfil);

      const aviso = sessionStorage.getItem('_aviso_acesso');
      if (aviso) {
        sessionStorage.removeItem('_aviso_acesso');
        requestAnimationFrame(() => toast(aviso, { tipo: 'info', duracao: 4000 }));
      }

      if (!resolvido) {
        resolvido = true;
        resolve({ user, perfil });
      }
    });
  });
}
