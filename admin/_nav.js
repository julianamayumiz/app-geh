// Navegação comum do admin
import { auth, signOut } from "../js/firebase-config.js";
import { requireAuth } from "../js/auth-guard.js";
import { icon } from "../js/icons.js";
import { enhanceAllTables, autoSkeleton } from "../js/ui.js";
import { instalarAtalhos } from "../js/shortcuts.js";
import { instalarBannerPWA } from "../js/install-banner.js";

// Itens agrupados por área de responsabilidade — ajuda a orientar
// o olhar na sidebar quando ela cresce.
const GRUPOS = [
  {
    titulo: 'Operação',
    itens: [
      { href: 'dashboard.html',   icone: 'bar-chart', texto: 'Dashboard'   },
      { href: 'comparativo.html', icone: 'git-compare', texto: 'Comparativo' },
      { href: 'eventos.html',     icone: 'calendar',  texto: 'Eventos'     },
      { href: 'historico.html',   icone: 'search',    texto: 'Histórico'   },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { href: 'produtos.html', icone: 'package', texto: 'Produtos' },
      { href: 'clientes.html', icone: 'users',   texto: 'Clientes' },
    ],
  },
  {
    titulo: 'Recepção',
    itens: [
      { href: 'recepcao-painel.html',     icone: 'door-open',   texto: 'Painel ao vivo'      },
      { href: 'convites-antecipados.html', icone: 'ticket',      texto: 'Convites antecipados' },
      { href: 'historico-recepcao.html',  icone: 'list-checks', texto: 'Histórico'           },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { href: 'estoque.html',     icone: 'package',      texto: 'Estoque'         },
      { href: 'despesas.html',    icone: 'dollar-sign',  texto: 'Despesas'        },
      { href: 'ajuste-saldo.html', icone: 'edit',         texto: 'Ajuste de saldo' },
      { href: 'relatorio.html',   icone: 'trending-up',  texto: 'Relatório'       },
      { href: 'fechamento.html',  icone: 'file-text',    texto: 'Fechamento'      },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { href: 'usuarios.html', icone: 'user-check', texto: 'Usuários' },
    ],
  },
];

export function montarNav(paginaAtiva = '') {
  // Dispara checagem de admin em paralelo. Se não passar (não logada,
  // perfil ausente, ativo:false, ou papel != admin), requireAuth
  // redireciona pro login. As regras do Firestore são a barreira real;
  // esse redirect só evita ver a tela.
  const guardPromise = requireAuth({ papel: 'admin' });

  const grupos = GRUPOS.map(g => `
    <div class="sidebar-grupo">
      <div class="sidebar-grupo-titulo">${g.titulo}</div>
      ${g.itens.map(i => linkNav(i, paginaAtiva)).join('')}
    </div>
  `).join('');
  const nav = `
    <header class="header">
      <button id="btn-menu" class="back" title="Menu" aria-label="Abrir menu">${icon('menu', { size: 22 })}</button>
      <img src="../assets/logo.png" alt="GEH" onerror="this.style.display='none'">
      <h1>Admin GEH</h1>
      <button id="btn-tema" class="back" title="Alternar tema" aria-label="Alternar tema"></button>
      <button id="btn-logout" class="back" title="Sair" aria-label="Sair">${icon('power', { size: 22 })}</button>
    </header>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-links">${grupos}</div>
      <div id="sidebar-user" style="margin-top:auto;padding:1rem;border-top:1px solid var(--cinza-claro);font-size:0.8rem;color:var(--cinza);"></div>
    </aside>
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
  `;
  document.body.insertAdjacentHTML('afterbegin', nav);
  document.body.classList.add('has-sidebar');

  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const abrir  = () => { sidebar.classList.add('open'); backdrop.classList.add('show'); };
  const fechar = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };
  document.getElementById('btn-menu').onclick = abrir;
  backdrop.onclick = fechar;
  sidebar.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', fechar);
    const prefetch = () => {
      if (a.dataset.prefetched) return;
      a.dataset.prefetched = '1';
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = a.href;
      document.head.appendChild(l);
    };
    a.addEventListener('mouseenter', prefetch, { once: true });
    a.addEventListener('touchstart', prefetch, { once: true, passive: true });
  });

  const btnTema = document.getElementById('btn-tema');
  const atualizarIconeTema = () => {
    const atual = document.documentElement.dataset.theme || 'light';
    btnTema.innerHTML = icon(atual === 'dark' ? 'sun' : 'moon', { size: 22 });
  };
  atualizarIconeTema();
  btnTema.onclick = () => {
    const atual = document.documentElement.dataset.theme || 'light';
    const novo = atual === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('theme', novo); } catch (e) {}
    atualizarIconeTema();
  };

  document.getElementById('btn-logout').onclick = async () => {
    await signOut(auth);
    window.location.href = 'login.html';
  };

  // Quando o guard resolver (admin OK), preenche o footer da sidebar
  guardPromise.then(({ perfil }) => {
    const box = document.getElementById('sidebar-user');
    if (!box || !perfil) return;
    const nome = perfil.nome || perfil.email || 'Conta';
    box.innerHTML = `
      <div style="font-weight:600;color:var(--cinza-escuro);">${nome}</div>
      <div>${perfil.papel || ''}</div>
    `;
  });

  // Adiciona busca + ordenação + export CSV em todas as tabelas da página
  // (opt-out por tabela com data-no-enhance no .table-wrapper)
  enhanceAllTables();
  // Substitui placeholders "Carregando..." por linhas-skeleton
  autoSkeleton();
  // Atalhos de teclado (/, g d, g h, ?, …)
  instalarAtalhos();
  // Banner de instalação PWA — só aparece se o browser oferecer
  instalarBannerPWA();
}

function linkNav({ href, icone, texto }, ativa) {
  const classe = href === ativa ? 'sidebar-link ativo' : 'sidebar-link';
  return `<a href="${href}" class="${classe}">${icon(icone, { size: 18 })} <span>${texto}</span></a>`;
}

export function fmtBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}
