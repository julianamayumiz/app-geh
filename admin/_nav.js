// Navegação comum do admin
import { auth, signOut, onAuthStateChanged } from "../js/firebase-config.js";

export function montarNav(paginaAtiva = '') {
  const nav = `
    <header class="header">
      <img src="../assets/logo.png" alt="GEH" onerror="this.style.display='none'">
      <h1>Admin GEH</h1>
      <button id="btn-logout" class="back" title="Sair">⏻</button>
    </header>
    <nav style="background:white;padding:0.5rem 1rem;display:flex;gap:0.5rem;overflow-x:auto;box-shadow:var(--sombra);">
      ${linkNav('eventos.html',   '📅 Eventos',   paginaAtiva)}
      ${linkNav('dashboard.html', '📊 Dashboard', paginaAtiva)}
      ${linkNav('produtos.html',  '📦 Produtos',  paginaAtiva)}
      ${linkNav('clientes.html',  '👥 Clientes',  paginaAtiva)}
      ${linkNav('historico.html', '🔍 Histórico', paginaAtiva)}
      ${linkNav('compras.html',   '🛒 Compras',   paginaAtiva)}
      ${linkNav('relatorio.html', '📈 Relatório', paginaAtiva)}
    </nav>
  `;
  document.body.insertAdjacentHTML('afterbegin', nav);
  document.getElementById('btn-logout').onclick = async () => {
    await signOut(auth);
    window.location.href = 'login.html';
  };

  onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = 'login.html';
  });
}

function linkNav(href, texto, ativa) {
  const estilo = href === ativa
    ? 'background:var(--azul);color:white;'
    : 'background:var(--cinza-claro);color:var(--azul);';
  return `<a href="${href}" class="btn" style="${estilo}width:auto;white-space:nowrap;padding:0.5rem 0.875rem;font-size:0.9rem;">${texto}</a>`;
}

export function fmtBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}
