// Navegação comum do admin
import { auth, signOut, onAuthStateChanged } from "../js/firebase-config.js";
import { icon } from "../js/icons.js";

const ITENS = [
  { href: 'eventos.html',   icone: 'calendar',     texto: 'Eventos'   },
  { href: 'dashboard.html', icone: 'bar-chart',    texto: 'Dashboard' },
  { href: 'produtos.html',  icone: 'package',      texto: 'Produtos'  },
  { href: 'clientes.html',  icone: 'users',        texto: 'Clientes'  },
  { href: 'historico.html', icone: 'search',       texto: 'Histórico' },
  { href: 'compras.html',   icone: 'shopping-bag', texto: 'Compras'   },
  { href: 'relatorio.html', icone: 'trending-up',  texto: 'Relatório' },
];

export function montarNav(paginaAtiva = '') {
  const links = ITENS.map(i => linkNav(i, paginaAtiva)).join('');
  const nav = `
    <header class="header">
      <img src="../assets/logo.png" alt="GEH" onerror="this.style.display='none'">
      <h1>Admin GEH</h1>
      <button id="btn-logout" class="back" title="Sair" aria-label="Sair">${icon('power', { size: 22 })}</button>
    </header>
    <nav style="background:white;padding:0.5rem 1rem;display:flex;gap:0.5rem;overflow-x:auto;box-shadow:var(--sombra);">
      ${links}
    </nav>
  `;
  document.body.insertAdjacentHTML('afterbegin', nav);
  document.getElementById('btn-logout').onclick = async () => {
    await signOut(auth);
    window.location.href = 'login.html';
  };

  onAuthStateChanged(auth, (user) => {
    console.log('[auth]', user ? `logada como ${user.email || user.uid}` : 'NÃO autenticada');
    if (!user) window.location.href = 'login.html';
  });
}

function linkNav({ href, icone, texto }, ativa) {
  const estilo = href === ativa
    ? 'background:var(--azul);color:white;'
    : 'background:var(--cinza-claro);color:var(--azul);';
  return `<a href="${href}" class="btn" style="${estilo}width:auto;white-space:nowrap;padding:0.5rem 0.875rem;font-size:0.9rem;gap:0.4rem;">${icon(icone, { size: 16 })} ${texto}</a>`;
}

export function fmtBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}
