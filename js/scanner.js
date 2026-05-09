// ============================================================
// Scanner de QR — wrapper sobre html5-qrcode
// ============================================================
//
// Otimizado para câmeras Android (especialmente Samsung), que
// costumam ter problemas comuns:
//
//  - Selecionam a lente ultra-wide ou frontal por padrão.
//  - Foco fixo no infinito quando focusMode não é declarado.
//  - Falham silenciosamente se zoom for passado nos constraints
//    iniciais sem checar capabilities.
//  - BarcodeDetector nativo da Samsung Internet tem bugs com
//    QR codes pequenos.
//
// Mostra um seletor de câmera (quando há mais de uma) para o
// usuário escolher manualmente caso a heurística falhe. A escolha
// fica salva em localStorage.
//
// API:
//   import { iniciarScanner } from '../js/scanner.js';
//   const handle = await iniciarScanner({
//     elementId: 'reader',
//     onDetected: (texto) => { ... },
//     onReady: () => { ... }
//   });
//   handle.stop();
// ============================================================

const STORAGE_KEY = 'scanner-camera-id';

function escolherTraseiraPrincipal(cameras) {
  if (!cameras || cameras.length < 2) return null;

  const ehFrontal = (label) => /(front|user|frontal|frente)/i.test(label);
  const ehEvitar = (label) => /(wide|ultra|0\.5|tele|2x|3x|5x|depth|mono|bokeh)/i.test(label);
  const ehTraseira = (label) => /(back|rear|traseir|environment)/i.test(label);

  const candidatas = cameras.filter(c =>
    c.label && ehTraseira(c.label) && !ehFrontal(c.label) && !ehEvitar(c.label)
  );

  if (candidatas.length > 0) return candidatas[0];
  return null;
}

async function ajustarTrack(elementId) {
  try {
    const video = document.querySelector(`#${elementId} video`);
    if (!video || !video.srcObject) return;
    const track = video.srcObject.getVideoTracks?.()[0];
    if (!track || !track.getCapabilities) return;

    const caps = track.getCapabilities();
    const advanced = [];

    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }

    if (caps.zoom) {
      const min = caps.zoom.min ?? 1;
      const max = caps.zoom.max ?? 1;
      if (max > min) {
        const alvo = Math.min(Math.max(1.8, min), Math.min(2.5, max));
        advanced.push({ zoom: alvo });
      }
    }

    if (advanced.length > 0) {
      await track.applyConstraints({ advanced });
    }
  } catch (e) {
    console.debug('[scanner] ajustarTrack falhou:', e);
  }
}

// Cria botão flutuante de troca de câmera dentro do container do reader.
// Cicla entre as câmeras disponíveis a cada toque.
const SWITCH_ICON_SVG = `
<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>
  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/>
  <circle cx="12" cy="12" r="3"/>
  <path d="m18 22-3-3 3-3"/>
  <path d="m6 2 3 3-3 3"/>
</svg>`;

function montarBotaoTroca(elementId, cameras, getDeviceIdAtual, onTrocar) {
  if (!cameras || cameras.length < 2) return;
  const reader = document.getElementById(elementId);
  if (!reader) return;

  // Garante que o container do reader é position:relative para
  // ancorar o botão absoluto.
  const container = reader.parentElement;
  if (container && getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  let btn = document.getElementById('btn-trocar-camera');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-trocar-camera';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Trocar câmera');
    btn.title = 'Trocar câmera';
    btn.innerHTML = SWITCH_ICON_SVG;
    btn.style.cssText = [
      'position:absolute',
      'top:0.75rem',
      'right:0.75rem',
      'z-index:10',
      'width:44px',
      'height:44px',
      'border-radius:50%',
      'border:none',
      'background:rgba(0,0,0,0.55)',
      'color:#fff',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
      'transition:transform 0.15s ease, background 0.15s ease',
      'padding:0'
    ].join(';');
    btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.92)'; });
    btn.addEventListener('mouseup', () => { btn.style.transform = ''; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    btn.addEventListener('touchstart', () => { btn.style.transform = 'scale(0.92)'; }, { passive: true });
    btn.addEventListener('touchend', () => { btn.style.transform = ''; });
    container.appendChild(btn);
  }

  btn.onclick = () => {
    const atual = getDeviceIdAtual();
    const idx = cameras.findIndex(c => c.id === atual);
    const proxima = cameras[(idx + 1) % cameras.length];
    if (proxima) onTrocar(proxima.id);
  };
}

export async function iniciarScanner({
  elementId = 'reader',
  onDetected,
  onReady
}) {
  if (typeof Html5Qrcode === 'undefined') {
    throw new Error('html5-qrcode não carregado');
  }

  const scanner = new Html5Qrcode(elementId);
  let scanAtivo = true;
  let cameras = [];
  let deviceIdAtual = null;

  const onDecoded = (decoded) => {
    if (!scanAtivo) return;
    scanAtivo = false;
    const texto = (decoded || '').trim();
    scanner.stop().catch(() => {}).finally(() => {
      try { onDetected?.(texto); } catch (e) { console.error(e); }
    });
  };
  const onFrameErr = () => {};

  const scanConfig = {
    fps: 10,
    qrbox: (w, h) => {
      const size = Math.min(w, h) * 0.6;
      return { width: size, height: size };
    },
    aspectRatio: 1.0,
    videoConstraints: {
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false
    },
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true
  };

  // Lista câmeras (precisa de permissão — getCameras() já pede)
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch (e) {
    console.debug('[scanner] getCameras falhou:', e);
  }

  // Decide câmera inicial:
  // 1. Salva no localStorage (se ainda existe)
  // 2. Heurística (traseira principal pelo label)
  // 3. facingMode environment (browser decide)
  let cameraConfig;
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo && cameras.some(c => c.id === salvo)) {
    cameraConfig = { deviceId: { exact: salvo } };
    deviceIdAtual = salvo;
  } else {
    const escolhida = escolherTraseiraPrincipal(cameras);
    if (escolhida) {
      cameraConfig = { deviceId: { exact: escolhida.id } };
      deviceIdAtual = escolhida.id;
    } else {
      cameraConfig = { facingMode: { exact: 'environment' } };
    }
  }

  async function startCom(config) {
    try {
      await scanner.start(config, scanConfig, onDecoded, onFrameErr);
    } catch (e) {
      console.debug('[scanner] start falhou, tentando fallback:', e);
      await scanner.start(
        { facingMode: 'environment' },
        scanConfig, onDecoded, onFrameErr
      );
    }
    ajustarTrack(elementId);
  }

  await startCom(cameraConfig);

  // Tap-to-focus
  const video = document.querySelector(`#${elementId} video`);
  if (video) {
    video.addEventListener('click', () => {
      try {
        const track = video.srcObject?.getVideoTracks?.()[0];
        if (!track || !track.getCapabilities) return;
        const caps = track.getCapabilities();
        if (caps.focusMode && caps.focusMode.includes('single-shot')) {
          track.applyConstraints({
            advanced: [{ focusMode: 'single-shot' }]
          }).catch(() => {});
        }
      } catch {}
    });
  }

  // Botão flutuante de troca de câmera (só se houver mais de uma)
  montarBotaoTroca(
    elementId,
    cameras,
    () => deviceIdAtual,
    async (novoId) => {
      deviceIdAtual = novoId;
      localStorage.setItem(STORAGE_KEY, novoId);
      scanAtivo = false;
      try { await scanner.stop(); } catch {}
      scanAtivo = true;
      await startCom({ deviceId: { exact: novoId } });
    }
  );

  try { onReady?.(); } catch (e) { console.error(e); }

  return {
    stop: async () => {
      scanAtivo = false;
      try { await scanner.stop(); } catch {}
    }
  };
}
