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
const START_TIMEOUT_MS = 8000;

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
// Falha do fluxo rapido em que o fluxo legado nao ajudaria (embrulha o erro original).
class SemFallbackError extends Error {
  constructor(original) { super(String(original)); this.original = original; }
}
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
  const scanConfig = {
    fps: 10,
    qrbox: (w, h) => {
      const size = Math.min(w, h) * 0.6;
      return { width: size, height: size };
    },
    aspectRatio: 1.0,
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false
    },
    showTorchButtonIfSupported: true
  };

  // Lê o facingMode REAL da track aberta (post-start).
  function lerFacingModeAtual() {
    const video = document.querySelector(`#${elementId} video`);
    const track = video?.srcObject?.getVideoTracks?.()[0];
    return track?.getSettings?.().facingMode || null;
  }

  // Decide câmera inicial:
  // 1. Salva no localStorage (se ainda existe na lista)
  // 2. Heurística (traseira principal pelo label)
  // 3. facingMode environment (browser decide)
  function decidirConfigInicial() {
    const salvo = lsGet(STORAGE_KEY);
    if (salvo && cameras.some(c => c.id === salvo)) {
      deviceIdAtual = salvo;
      return { deviceId: { exact: salvo } };
    }
    const escolhida = escolherTraseiraPrincipal(cameras);
    if (escolhida) {
      deviceIdAtual = escolhida.id;
      return { deviceId: { exact: escolhida.id } };
    }
    return { facingMode: { exact: 'environment' } };
  }

  async function startCom(config) {
    // Tentativa 1: configuracao solicitada (deviceId exact ou facingMode exact)
    try {
      await comTimeout(scanner.start(config, scanConfig, onDecoded, onFrameErr), START_TIMEOUT_MS);
      ajustarTrack(elementId);
      const facing = lerFacingModeAtual();
      console.info('[scanner] facingMode real apos start:', facing);
      return facing;
    } catch (e1) {
      if (e1 instanceof TimeoutError) { try { await scanner.stop(); } catch {} }
      console.warn('[scanner] start falhou, tentando facingMode solto:', e1);
    }

    // Tentativa 2: facingMode sem exact (browser escolhe a traseira)
    try {
      await comTimeout(scanner.start(
        { facingMode: 'environment' },
        scanConfig, onDecoded, onFrameErr
      ), START_TIMEOUT_MS);
      ajustarTrack(elementId);
      const facing = lerFacingModeAtual();
      console.info('[scanner] facingMode real apos start (fallback 2):', facing);
      return facing;
    } catch (e2) {
      if (e2 instanceof TimeoutError) { try { await scanner.stop(); } catch {} }
      console.warn('[scanner] facingMode solto falhou, tentando cameras por deviceId:', e2);
    }

    // Tentativa 3: itera pelas cameras detectadas em ordem — ignora as frontais
    const candidatas = cameras.filter(c => !/(front|user|frontal|frente)/i.test(c.label || ''));
    const ordem = candidatas.length > 0 ? candidatas : cameras;
    for (const cam of ordem) {
      try {
        await comTimeout(scanner.start(
          { deviceId: { exact: cam.id } },
          scanConfig, onDecoded, onFrameErr
        ), START_TIMEOUT_MS);
        deviceIdAtual = cam.id;
        ajustarTrack(elementId);
        const facing = lerFacingModeAtual();
        console.info('[scanner] abriu via deviceId fallback:', cam.label, '| facing:', facing);
        return facing;
      } catch (e3) {
        if (e3 instanceof TimeoutError) { try { await scanner.stop(); } catch {} }
        console.warn('[scanner] deviceId fallback falhou para', cam.label, ':', e3);
      }
    }

    // Todas as tentativas esgotadas
    throw new Error('Nenhuma camera disponivel respondeu');
  }

  // Fluxo LEGADO (fallback): getCameras() abre e fecha uma stream so pra
  // liberar labels/permissao, depois start() abre outra. Mantido intacto.
  async function iniciarLegado() {
    try {
      cameras = await Html5Qrcode.getCameras();
      console.info('[scanner] câmeras detectadas:', cameras.map(c => ({ id: c.id.slice(0, 8), label: c.label })));
    } catch (e) {
      console.warn('[scanner] getCameras falhou:', e);
    }

    const cameraConfig = decidirConfigInicial();
    let facing = await startCom(cameraConfig);
    return corrigirFrontal(facing);
  }

  // Se abriu a frontal sem nossa intenção, descarta a preferência
  // salva e tenta uma câmera diferente da que abriu agora.
  async function corrigirFrontal(facing) {
    if (facing === 'user' && cameras.length > 1) {
      console.warn('[scanner] abriu câmera frontal — tentando outra');
      lsRemove(STORAGE_KEY);

      const idAtual = deviceIdAtual;
      const outra = cameras.find(c =>
        c.id !== idAtual && !/(front|user|frontal|frente)/i.test(c.label)
      ) || cameras.find(c => c.id !== idAtual);

      if (outra) {
        await pararSeguro();
        deviceIdAtual = outra.id;
        facing = await startCom({ deviceId: { exact: outra.id } });
        if (facing !== 'user') {
          lsSet(STORAGE_KEY, outra.id);
        }
      }
    }
    return facing;
  }

  // Fluxo RAPIDO: abre direto (1 getUserMedia) e so depois, com a permissao
  // ja concedida, lista as cameras via enumerateDevices() (sem abrir stream).
  // Lanca se nao conseguiu abrir; o chamador cai no fluxo legado, exceto
  // em timeout e permissao negada (ver SemFallbackError).
  async function iniciarRapido() {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('enumerateDevices indisponivel');

    const salvo = lsGet(STORAGE_KEY);
    const config = salvo ? { deviceId: { exact: salvo } } : { facingMode: 'environment' };

    const p = (() => {
      try { return scanner.start(config, scanConfig, onDecoded, onFrameErr); }
      catch (e) { return Promise.reject(e); }
    })();
    try {
      await comTimeout(p, START_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof TimeoutError) {
        // start() ainda pendente: se resolver depois, ninguem tem o handle —
        // fecha a stream pra nao ficar camera aberta. Sem fallback: o legado
        // esbarraria na transicao pendente da lib e falharia igual.
        p.then(() => pararSeguro(), () => {});
        throw new SemFallbackError(e);
      } else if (/NotAllowed|Permission|SecurityError/i.test(String(e))) {
        throw new SemFallbackError(e);
      } else if (salvo && /Overconstrained|NotFound/i.test(String(e))) {
        lsRemove(STORAGE_KEY);
      }
      throw e;
    }

    // Aberto. Descobre qual camera abriu e monta a lista (mesmo formato do getCameras).
    const track = document.querySelector(`#${elementId} video`)?.srcObject?.getVideoTracks?.()[0];
    let facing = track?.getSettings?.().facingMode || null;
    console.info('[scanner] facingMode real apos start (rapido):', facing);
    try {
      cameras = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ id: d.deviceId, label: d.label }));
      console.info('[scanner] câmeras detectadas:', cameras.map(c => ({ id: c.id.slice(0, 8), label: c.label })));
    } catch (e) {
      console.warn('[scanner] enumerateDevices falhou:', e);
    }
    ajustarTrack(elementId);

    const idAbriu = track?.getSettings?.().deviceId || cameras.find(c => c.label && c.label === track?.label)?.id || null;
    deviceIdAtual = idAbriu;

    // facingMode so garante "traseira", nao "a traseira principal": se a
    // heuristica por label aponta outra camera, troca (igual o legado faria).
    // Sem escolha salva pelo usuario e so quando conseguimos comparar ids.
    if (!salvo && facing !== 'user' && idAbriu && scanAtivo) {
      const escolhida = escolherTraseiraPrincipal(cameras);
      if (escolhida && escolhida.id !== idAbriu) {
        console.info('[scanner] heuristica prefere outra traseira:', escolhida.label);
        scanAtivo = false;
        await pararSeguro();
        scanAtivo = true;
        deviceIdAtual = escolhida.id;
        facing = await startCom({ deviceId: { exact: escolhida.id } });
        // proximas aberturas vao direto nela (1 abertura so)
        lsSet(STORAGE_KEY, escolhida.id);
      }
    }
    return corrigirFrontal(facing);
  }

  try {
    await iniciarRapido();
  } catch (e) {
    if (e instanceof SemFallbackError) throw e.original;
    console.warn('[scanner] fluxo rapido falhou, usando fluxo legado:', e);
    // garante que nenhuma stream/estado do rapido sobrou antes de recomecar
    await pararSeguro();
    deviceIdAtual = null;
    await iniciarLegado();
  }

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
      lsSet(STORAGE_KEY, novoId);
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
      await pararSeguro();
    }
  };
}
