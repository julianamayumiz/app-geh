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
const START_TIMEOUT_MS = 5000;

// localStorage pode lançar em modo privado agressivo (ex: Safari com
// "block all cookies") — nunca deixa isso derrubar o scanner.
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

class TimeoutError extends Error {}
// scanner.start() pode ficar pendurado pra sempre se a API de câmera do
// navegador travar — sem isso, o operador fica preso numa tela de loading
// infinito sem nenhum jeito de tentar de novo.
function comTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`Câmera não respondeu em ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
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

const ehFrontal = (label) => /(front|user|frontal|frente)/i.test(label || '');

// opcoes:
//   manterAberta: true -> ao ler um QR a camera so PAUSA a decodificacao (stream
//     continua viva) em vez de parar; use handle.retomar() pra ler o proximo.
//     Evita reabrir a camera (e o prompt de permissao) a cada leitura.
//   onProblema(err): chamado se a camera morreu e a recuperacao automatica falhou.
export async function iniciarScanner({
  elementId = 'reader',
  onDetected,
  onReady,
  manterAberta = false,
  onProblema
}) {
  if (typeof Html5Qrcode === 'undefined') {
    throw new Error('html5-qrcode não carregado');
  }

  const scanner = new Html5Qrcode(elementId);
  let scanAtivo = true;
  let parado = false;
  let reiniciando = false;
  let falhasSeguidas = 0;
  let deviceIdAtual = null;
  let cameras = [];
  let botaoMontado = false;

  const onDecoded = (decoded) => {
    if (!scanAtivo) return;
    scanAtivo = false;
    const texto = (decoded || '').trim();
    if (manterAberta) {
      try { scanner.pause(false); } catch {}
      try { onDetected?.(texto); } catch (e) { console.error(e); }
      return;
    }
    scanner.stop().catch(() => {}).finally(() => {
      try { onDetected?.(texto); } catch (e) { console.error(e); }
    });
  };
  const onFrameErr = () => {};

  // O start() da lib resolve ANTES do evento 'playing' do <video>; so nesse
  // evento ela marca isScanning=true e cria o canvas. Um stop() nesse intervalo
  // lanca (removeChild de canvas nulo) e deixa a lib travada ("Cannot clear
  // while scan is ongoing"). Espera a lib ficar pronta (no maximo ~3s).
  async function pararSeguro() {
    const fim = performance.now() + 3000;
    while (scanner.getState() === Html5QrcodeScannerState.SCANNING && !scanner.isScanning && performance.now() < fim) {
      await new Promise(r => setTimeout(r, 30));
    }
    try { await scanner.stop(); } catch {}
  }

  // IMPORTANTE: NÃO definir videoConstraints aqui — o html5-qrcode
  // sobrescreve o cameraConfig com videoConstraints, fazendo o
  // navegador escolher a default (frontal em alguns Samsungs).
  // Sem qrbox: escaneia o frame inteiro e nao desenha moldura sobre o video.
  const scanConfig = {
    fps: 10,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false
    },
    showTorchButtonIfSupported: true
  };

  function trackAtual() {
    return document.querySelector(`#${elementId} video`)?.srcObject?.getVideoTracks?.()[0] || null;
  }
  function streamViva() {
    const t = trackAtual();
    return !!t && t.readyState === 'live';
  }

  // Abre a camera (1 getUserMedia) e devolve o que realmente abriu.
  async function abrir(config) {
    const p = (() => {
      try { return scanner.start(config, scanConfig, onDecoded, onFrameErr); }
      catch (e) { return Promise.reject(e); }
    })();
    try {
      await comTimeout(p, START_TIMEOUT_MS);
    } catch (e) {
      // start() ainda pendente: se resolver depois, fecha a stream.
      if (e instanceof TimeoutError) p.then(() => pararSeguro(), () => {});
      throw e;
    }
    ajustarTrack(elementId);
    const track = trackAtual();
    const s = track?.getSettings?.() || {};
    deviceIdAtual = s.deviceId || null;
    // Camera morreu sozinha (outro app pegou, tela bloqueou): recupera.
    if (track) track.onended = () => { if (!parado) reiniciar(); };
    console.info('[scanner] aberta:', { facing: s.facingMode || null, id: (deviceIdAtual || '').slice(0, 8) });
    return s.facingMode || null;
  }

  async function listarCameras() {
    try {
      return (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ id: d.deviceId, label: d.label }));
    } catch (e) {
      console.warn('[scanner] enumerateDevices falhou:', e);
      return [];
    }
  }

  // Traseira por padrao: escolha salva do usuario, senao facingMode environment.
  // Unico fallback: id salvo que nao existe mais -> descarta e vai de environment.
  async function iniciar() {
    const salvo = lsGet(STORAGE_KEY);
    let facing;
    try {
      facing = await abrir(salvo ? { deviceId: { exact: salvo } } : { facingMode: 'environment' });
    } catch (e) {
      if (!salvo || !/Overconstrained|NotFound/i.test(String(e))) throw e;
      lsRemove(STORAGE_KEY);
      facing = await abrir({ facingMode: 'environment' });
    }

    // Guard: abriu a frontal mesmo assim -> troca pra outra camera.
    if (facing === 'user') {
      cameras = await listarCameras();
      const outra = cameras.find(c => c.id !== deviceIdAtual && !ehFrontal(c.label))
        || cameras.find(c => c.id !== deviceIdAtual);
      if (outra) {
        lsRemove(STORAGE_KEY);
        await pararSeguro();
        facing = await abrir({ deviceId: { exact: outra.id } });
        if (facing !== 'user') lsSet(STORAGE_KEY, outra.id);
      }
    }
    scanAtivo = true;

    // Tap-to-focus (o <video> e recriado a cada start)
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
  }

  // Fecha e reabre a camera (recuperacao). Preserva o estado pausado.
  async function reiniciar() {
    if (reiniciando || parado) return;
    reiniciando = true;
    const estavaPausada = scanner.getState() === Html5QrcodeScannerState.PAUSED || !scanAtivo;
    try {
      await pararSeguro();
      await iniciar();
      if (estavaPausada) pausar();
      falhasSeguidas = 0;
    } catch (e) {
      console.warn('[scanner] recuperacao falhou:', e);
      if (++falhasSeguidas >= 2) { try { onProblema?.(e); } catch {} }
    } finally {
      reiniciando = false;
    }
  }

  function pausar() {
    scanAtivo = false;
    try {
      if (scanner.getState() === Html5QrcodeScannerState.SCANNING) scanner.pause(false);
    } catch {}
  }

  // Volta a ler. Reabre a camera se ela foi liberada ou morreu.
  async function retomar() {
    if (parado) return;
    const st = scanner.getState();
    if (st === Html5QrcodeScannerState.PAUSED && streamViva()) {
      try { scanner.resume(); } catch {}
      scanAtivo = true;
    } else if (st === Html5QrcodeScannerState.SCANNING && streamViva()) {
      scanAtivo = true;
    } else if (st === Html5QrcodeScannerState.NOT_STARTED || st === Html5QrcodeScannerState.UNKNOWN) {
      if (reiniciando) return;
      reiniciando = true;
      try { await iniciar(); falhasSeguidas = 0; }
      catch (e) { console.warn('[scanner] reabrir falhou:', e); try { onProblema?.(e); } catch {} }
      finally { reiniciando = false; }
    } else {
      await reiniciar();
    }
  }

  // Solta a camera de verdade (economiza bateria). retomar() reabre.
  async function liberar() {
    scanAtivo = false;
    await pararSeguro();
  }

  // Ao voltar pro app (tela desbloqueou, trocou de aba): confere se a camera sobreviveu.
  function aoVoltar() {
    if (document.visibilityState !== 'visible' || parado || reiniciando) return;
    const st = scanner.getState();
    const ativa = st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED;
    if (ativa && !streamViva()) reiniciar();
  }
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('pageshow', aoVoltar);

  await iniciar();
  try { onReady?.(); } catch (e) { console.error(e); }

  // Botao de troca de camera: lista em background, nao atrasa a abertura.
  (async () => {
    if (cameras.length < 2) cameras = await listarCameras();
    if (parado || botaoMontado || cameras.length < 2) return;
    botaoMontado = true;
    montarBotaoTroca(
      elementId,
      cameras,
      () => deviceIdAtual,
      async (novoId) => {
        deviceIdAtual = novoId;
        lsSet(STORAGE_KEY, novoId);
        const estavaPausada = !scanAtivo;
        scanAtivo = false;
        await pararSeguro();
        try {
          await abrir({ deviceId: { exact: novoId } });
          scanAtivo = true;
          if (estavaPausada) pausar();
        } catch (e) { console.warn('[scanner] troca de camera falhou:', e); }
      }
    );
  })();

  return {
    pausar,
    retomar,
    liberar,
    stop: async () => {
      parado = true;
      scanAtivo = false;
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('pageshow', aoVoltar);
      await pararSeguro();
    }
  };
}
