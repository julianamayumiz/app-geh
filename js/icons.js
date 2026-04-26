// Ícones do Lucide (lucide.dev, MIT License), inlinados como sprite SVG.
//
// Estratégia: cada ícone é um <symbol id="icon-foo"> dentro de um único <svg>
// injetado no topo do <body>. Cada uso vira <svg><use href="#icon-foo"/></svg>,
// o que reduz o tamanho do DOM (uma definição por ícone, em vez de N cópias)
// e permite estilizar via CSS sem reprocessar.
//
// Uso em HTML estático:  <span data-icon="shopping-cart" data-size="24"></span>
// Uso em JS dinâmico:    element.innerHTML = icon('tag', { size: 14 });
// Chamar renderIcons() após inserir novos data-icon no DOM.

const PATHS = {
  // Navegação / ações principais
  'smartphone':    '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'monitor':       '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'wallet':        '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'eye':           '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'arrow-left':    '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-right':   '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',

  // Admin nav
  'calendar':      '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'bar-chart':     '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'package':       '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  'users':         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'search':        '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'shopping-bag':  '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'trending-up':   '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'power':         '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',

  // Feedback
  'check-circle':  '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'x-circle':      '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'alert-triangle':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'inbox':         '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',

  // Utilitários
  'tag':           '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" x2="7.01" y1="7" y2="7"/>',
  'keyboard':      '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  'trash-2':       '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'x':             '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'check':         '<path d="M20 6 9 17l-5-5"/>',
  'download':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'printer':       '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  'plus':          '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'minus':         '<path d="M5 12h14"/>',
  'edit':          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'menu':          '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'sun':           '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'moon':          '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
};

// Injeta o sprite uma única vez no topo do <body>. Idempotente.
function injetarSprite() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('geh-icon-sprite')) return;
  const symbols = Object.entries(PATHS).map(([nome, path]) =>
    `<symbol id="icon-${nome}" viewBox="0 0 24 24">${path}</symbol>`
  ).join('');
  const sprite = document.createElement('div');
  sprite.id = 'geh-icon-sprite';
  // display:none mantém o sprite oculto sem afetar o layout
  sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  sprite.setAttribute('aria-hidden', 'true');
  sprite.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
  // Insere o mais cedo possível pra <use> resolver imediatamente
  if (document.body) document.body.insertBefore(sprite, document.body.firstChild);
  else document.documentElement.appendChild(sprite);
}

export function icon(name, { size = 24, strokeWidth = 2, cls = '' } = {}) {
  if (!PATHS[name]) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name} ${cls}"><use href="#icon-${name}"/></svg>`;
}

export function renderIcons(root = document) {
  injetarSprite();
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.iconDone === '1') return;
    const name = el.getAttribute('data-icon');
    const size = el.getAttribute('data-size') || 24;
    const cls = el.getAttribute('data-cls') || '';
    el.innerHTML = icon(name, { size: Number(size), cls });
    el.dataset.iconDone = '1';
  });
}

// Auto-render em load (não bloqueia, pega tudo que já está no DOM inicial)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderIcons());
  } else {
    renderIcons();
  }
}
