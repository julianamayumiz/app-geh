// ============================================================
// Auth guard — controle de acesso por papel
// ============================================================
//
// Uso:
//   import { requireAuth } from "../js/auth-guard.js";
//   const { user, perfil } = await requireAuth({ papel: 'operador' });
//
// Se o usuário não estiver logado, ou não tiver papel válido no token,
// ou estiver com ativo:false, é deslogado e mandado pro login.
//
// PAPEL VEM DO TOKEN (CUSTOM CLAIMS), NÃO DO FIRESTORE:
// papel/ativo são custom claims sincronizados pela Cloud Function
// `sincronizarClaimsUsuario` (ver /functions) toda vez que o doc
// /usuarios/{uid} muda. O SDK do Firebase Auth já mantém o ID token
// persistido localmente, então ler os claims (sem forçar refresh) é
// instantâneo e não gera NENHUMA leitura no Firestore — nem network
// call, na maioria das vezes. Isso substitui o antigo getDoc(usuarios/uid)
// (1 leitura por carregamento de página) e o cache manual em localStorage
// que existia só pra evitar essa espera.
//
// SUPER_ADMIN_EMAIL é fallback: se a Juliana logar e ainda não
// existir claim pra ela, passa como admin mesmo assim. Resolve o
// bootstrap e garante que ela nunca fique trancada do lado de fora.
//
// JANELA DE PROPAGAÇÃO DO CLAIM:
// custom claims só aparecem no token depois de um refresh — não na
// hora em que a Cloud Function roda. Isso importa em dois momentos:
// (1) primeiro login por auto-provisionamento (o doc /usuarios/{uid}
//     acabou de ser criado, a função ainda não rodou);
// (2) logo após um admin mudar o papel/ativo de alguém em
//     admin/usuarios.html, na sessão da PRÓPRIA pessoa afetada.
// Pra (1), aguardarPerfil() faz poll com refresh forçado do token.
// (2) não tem como ser resolvido no mesmo instante (a mudança acontece
// em outra sessão/dispositivo) — o efeito aparece no próximo refresh
// automático do token (até ~1h) ou no próximo carregamento de página,
// igual ao comportamento anterior baseado em cache.
// ============================================================

import {
  auth, onAuthStateChanged, signOut
} from "./firebase-config.js";
import { toast } from "./ui.js";

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

// Monta o objeto de perfil a partir do user do Auth + claims do token.
function perfilDoToken(user, claims) {
  const papel = claims?.papel;
  const ativo = claims?.ativo === true;
  if (!papel || !ativo) {
    // Sem claim válido — só passa se for a super-admin (bootstrap).
    if (user.email === SUPER_ADMIN_EMAIL) {
      return {
        uid: user.uid,
        nome: user.displayName || 'Juliana (super-admin)',
        email: user.email,
        papel: 'admin',
        ativo: true,
        _bootstrap: true,
      };
    }
    return null;
  }
  return {
    uid: user.uid,
    nome: user.displayName || user.email,
    email: user.email,
    papel,
    ativo: true,
  };
}

// Lê o perfil a partir do ID token atual. `forcarRefresh` busca um token
// novo direto do Auth (não do Firestore — não conta como leitura de
// documento), usado pra revalidar sem custo. Nesse caso também chama
// user.reload() — só assim o displayName (nome sincronizado pela Cloud
// Function) atualiza no objeto local; o token por si só não carrega isso.
export async function carregarPerfil(user, { forcarRefresh = false } = {}) {
  if (!user) return null;
  if (forcarRefresh) {
    try { await user.reload(); } catch (e) { /* offline — segue com o que tem em cache */ }
  }
  const tokenResult = await user.getIdTokenResult(forcarRefresh);
  return perfilDoToken(user, tokenResult.claims);
}

// Espera o custom claim aparecer no token, tentando de novo com refresh
// forçado a cada intervalo. Só necessário logo após criar/provisionar um
// usuário, quando a Cloud Function ainda não rodou.
export async function aguardarPerfil(user, { tentativas = 6, intervaloMs = 1500 } = {}) {
  for (let i = 0; i < tentativas; i++) {
    const perfil = await carregarPerfil(user, { forcarRefresh: true });
    if (perfil) return perfil;
    if (i < tentativas - 1) await new Promise(r => setTimeout(r, intervaloMs));
  }
  return null;
}

function papelOk(perfil, papel) {
  if (!papel) return true;
  if (perfil?.papel === 'admin') return true;
  const aceitos = Array.isArray(papel) ? papel : [papel];
  return aceitos.includes(perfil?.papel);
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
        Nao foi possivel confirmar seu acesso.<br>Verifique a internet e tente novamente.
      </p>
      <button onclick="location.reload()"
        style="margin-top:0.5rem;padding:0.65rem 1.5rem;background:#1e3a8a;color:#fff;
               border:none;border-radius:10px;font-size:1rem;cursor:pointer;">
        Tentar novamente
      </button>
    </div>`;
}

function mostrarTelaProvisionando() {
  const div = document.createElement('div');
  div.id = '_auth-guard-provisionando';
  div.style.cssText = `position:fixed;inset:0;z-index:99998;background:#F8FAFC;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:1rem;padding:2rem;text-align:center;font:16px/1.5 system-ui,sans-serif;color:#1e293b;`;
  div.innerHTML = `
    <div style="width:32px;height:32px;border:3px solid #cbd5e1;border-top-color:#1e3a8a;
      border-radius:50%;animation:_auth-guard-spin 0.8s linear infinite;"></div>
    <p style="margin:0;">Preparando seu acesso...</p>
    <style>@keyframes _auth-guard-spin { to { transform: rotate(360deg); } }</style>`;
  document.body.appendChild(div);
  return () => div.remove();
}

export function requireAuth({ papel } = {}) {
  return new Promise((resolve) => {
    let resolvido = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        unsub();
        if (!resolvido) {
          resolvido = true;
          window.location.href = loginUrl() + '?erro=login';
        }
        return;
      }

      let perfil;
      try {
        perfil = await carregarPerfil(user);
      } catch (e) {
        unsub();
        mostrarTelaOffline();
        return;
      }

      // Sem claim ainda — provavelmente login recém-provisionado, esperando
      // a Cloud Function rodar. Mostra tela de espera e faz poll.
      if (!perfil) {
        const esconder = mostrarTelaProvisionando();
        try {
          perfil = await aguardarPerfil(user);
        } finally {
          esconder();
        }
      }

      if (!perfil || perfil.ativo === false) {
        unsub();
        await signOut(auth);
        if (!resolvido) {
          resolvido = true;
          window.location.href = loginUrl() + '?erro=sem-acesso';
        }
        return;
      }

      if (!papelOk(perfil, papel)) {
        unsub();
        sessionStorage.setItem('_aviso_acesso', 'Voce nao tem permissao para acessar essa area.');
        if (!resolvido) {
          resolvido = true;
          window.location.href = homeFor(perfil);
        }
        return;
      }

      const aviso = sessionStorage.getItem('_aviso_acesso');
      if (aviso) {
        sessionStorage.removeItem('_aviso_acesso');
        requestAnimationFrame(() => toast(aviso, { tipo: 'info', duracao: 4000 }));
      }

      if (!resolvido) {
        resolvido = true;
        unsub();
        resolve({ user, perfil });

        // Revalida em background com refresh forçado (chamada ao Auth,
        // não ao Firestore — sem custo de leitura) pra detectar
        // desativação/troca de papel dentro da mesma sessão.
        carregarPerfil(user, { forcarRefresh: true }).then(fresco => {
          if (!fresco || fresco.ativo === false || !papelOk(fresco, papel)) {
            signOut(auth);
            window.location.href = loginUrl() + '?erro=sem-acesso';
          }
        }).catch(e => console.warn('[auth-guard] revalidacao em background falhou:', e));
      }
    });
  });
}
