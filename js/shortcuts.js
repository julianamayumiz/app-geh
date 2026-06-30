// Atalhos de teclado do admin.
// `/`        → foca a primeira .table-search visível na página
// `g d/h/e/p/c/r/s/u` → navegar (dashboard, histórico, eventos, produtos,
//             clientes, relatório, ajuste-saldo, usuários)
// `?`        → abre o cheatsheet
// `Esc`      → fecha modais abertos / sidebar mobile
//
// Não dispara quando o foco está em input/textarea/select ou contenteditable.
import { abrirDetalhe } from './ui.js';

const ROTAS = {
  d: 'dashboard.html',
  h: 'historico.html',
  e: 'eventos.html',
  p: 'produtos.html',
  c: 'clientes.html',
  r: 'relatorio.html',
  s: 'ajuste-saldo.html',
  u: 'usuarios.html',
};

const CHEATSHEET = `
  <p style="color:var(--cinza);margin-bottom:0.75rem;">
    Atalhos disponíveis em qualquer tela do admin.
  </p>
  <dl class="shortcut-help">
    <dt><kbd>/</kbd></dt>                       <dd>Foca a busca da tabela</dd>
    <dt><kbd>g</kbd> <kbd>d</kbd></dt>          <dd>Ir para Dashboard</dd>
    <dt><kbd>g</kbd> <kbd>h</kbd></dt>          <dd>Ir para Histórico</dd>
    <dt><kbd>g</kbd> <kbd>e</kbd></dt>          <dd>Ir para Eventos</dd>
    <dt><kbd>g</kbd> <kbd>p</kbd></dt>          <dd>Ir para Produtos</dd>
    <dt><kbd>g</kbd> <kbd>c</kbd></dt>          <dd>Ir para Clientes</dd>
    <dt><kbd>g</kbd> <kbd>r</kbd></dt>          <dd>Ir para Relatório</dd>
    <dt><kbd>g</kbd> <kbd>s</kbd></dt>          <dd>Ir para Ajuste de saldo</dd>
    <dt><kbd>g</kbd> <kbd>u</kbd></dt>          <dd>Ir para Usuários</dd>
    <dt><kbd>?</kbd></dt>                       <dd>Mostrar este painel</dd>
    <dt><kbd>Esc</kbd></dt>                     <dd>Fechar modal / menu</dd>
  </dl>
`;

function emCampo(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
}

export function instalarAtalhos() {
  let aguardandoG = false;
  let timerG = null;

  document.addEventListener('keydown', (e) => {
    // Esc fecha modais abertos
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar?.classList.contains('open')) {
        sidebar.classList.remove('open');
        backdrop?.classList.remove('show');
      }
      return;
    }

    if (emCampo(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // `/` → foca busca
    if (e.key === '/') {
      const visivel = Array.from(document.querySelectorAll('.table-search'))
        .find(el => el.offsetParent !== null);
      if (visivel) {
        e.preventDefault();
        visivel.focus();
        visivel.select();
      }
      return;
    }

    // `?` → cheatsheet
    if (e.key === '?') {
      e.preventDefault();
      abrirDetalhe({ titulo: 'Atalhos de teclado', corpo: CHEATSHEET });
      return;
    }

    // Sequência g + letra
    if (aguardandoG) {
      const k = e.key.toLowerCase();
      const destino = ROTAS[k];
      aguardandoG = false;
      clearTimeout(timerG);
      if (destino && !window.location.pathname.endsWith('/' + destino)) {
        e.preventDefault();
        window.location.href = destino;
      }
      return;
    }
    if (e.key.toLowerCase() === 'g') {
      aguardandoG = true;
      timerG = setTimeout(() => { aguardandoG = false; }, 1200);
    }
  });
}
