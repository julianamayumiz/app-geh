// Banner de instalação PWA customizado.
// Aparece quando o navegador dispara `beforeinstallprompt`. Se a usuária
// dispensar, guarda em localStorage por 14 dias pra não importunar.
import { icon } from './icons.js';

const CHAVE_DISMISS = 'install-banner-dismiss-ate';
const REPRIMIR_DIAS = 14;

export function instalarBannerPWA() {
  // Não mostra se já estiver rodando como app instalado
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (navigator.standalone === true) return; // iOS

  const ate = Number(localStorage.getItem(CHAVE_DISMISS) || 0);
  if (ate && Date.now() < ate) return;

  let prompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    mostrar();
  });

  window.addEventListener('appinstalled', () => {
    fechar(false);
    localStorage.removeItem(CHAVE_DISMISS);
  });

  function mostrar() {
    if (document.getElementById('install-banner')) return;
    const el = document.createElement('div');
    el.id = 'install-banner';
    el.className = 'install-banner';
    el.innerHTML = `
      <span class="ico">${icon('smartphone', { size: 22 })}</span>
      <div class="txt">
        <strong>Instalar App GEH</strong>
        <span>Abre rápido, funciona em tela cheia</span>
      </div>
      <button type="button" data-acao="instalar">Instalar</button>
      <button type="button" class="dismiss" data-acao="dispensar" aria-label="Dispensar">×</button>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    el.addEventListener('click', async (e) => {
      const acao = e.target.closest('[data-acao]')?.dataset.acao;
      if (acao === 'instalar' && prompt) {
        try {
          await prompt.prompt();
          await prompt.userChoice;
        } catch (_) {}
        prompt = null;
        fechar(false);
      }
      if (acao === 'dispensar') fechar(true);
    });
  }

  function fechar(persistir) {
    const el = document.getElementById('install-banner');
    if (!el) return;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
    if (persistir) {
      localStorage.setItem(CHAVE_DISMISS, String(Date.now() + REPRIMIR_DIAS * 86400_000));
    }
  }
}
