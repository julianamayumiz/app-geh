// ============================================================
// Scanner de QR — wrapper sobre html5-qrcode
// ============================================================
//
// Otimizado para câmeras Android (especialmente Samsung), que
// costumam ter problemas comuns:
//
//  - Selecionam a lente ultra-wide por padrão quando se pede
//    apenas facingMode:"environment", deixando o QR pequeno.
//  - Foco fixo no infinito quando focusMode não é declarado.
//  - Falham silenciosamente se zoom for passado nos constraints
//    iniciais sem checar capabilities.
//  - BarcodeDetector nativo da Samsung Internet tem bugs com
//    QR codes pequenos.
//
// API:
//   import { iniciarScanner } from '../js/scanner.js';
//   const handle = await iniciarScanner({
//     elementId: 'reader',
//     onDetected: (texto) => { ... },
//     onReady: () => { ... },
//     onError: (err) => { ... }
//   });
//   handle.stop();   // para encerrar manualmente
// ============================================================

// Refina a escolha entre câmeras traseiras: se houver mais de uma
// e os labels permitirem identificar ultra-wide/tele, prefere a
// principal. Só retorna deviceId quando a identificação é segura —
// caso contrário devolve null e deixamos o navegador resolver via
// facingMode (que é mais confiável que adivinhar pela ordem).
function escolherTraseiraPrincipal(cameras) {
  if (!cameras || cameras.length < 2) return null;

  const ehFrontal = (label) => /(front|user|frontal|frente)/i.test(label);
  const ehEvitar = (label) => /(wide|ultra|0\.5|tele|2x|3x|5x|depth|mono|bokeh)/i.test(label);
  const ehTraseira = (label) => /(back|rear|traseir|environment)/i.test(label);

  // Filtra: explicitamente traseira E não ultra-wide/tele
  const candidatas = cameras.filter(c =>
    c.label && ehTraseira(c.label) && !ehFrontal(c.label) && !ehEvitar(c.label)
  );

  // Só usa deviceId se conseguiu identificar com certeza
  if (candidatas.length > 0) return candidatas[0];
  return null;
}

// Aplica foco contínuo e zoom moderado, se suportados.
// Tem que rodar DEPOIS do scanner.start, porque depende da track
// real já estar aberta.
async function ajustarTrack(scanner) {
  try {
    // html5-qrcode expõe getRunningTrackSettings/Capabilities,
    // mas para applyConstraints precisamos do MediaStreamTrack.
    const video = document.querySelector('#reader video');
    if (!video || !video.srcObject) return;
    const track = video.srcObject.getVideoTracks?.()[0];
    if (!track || !track.getCapabilities) return;

    const caps = track.getCapabilities();
    const advanced = [];

    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }

    // Zoom moderado se suportado: ajuda a "fechar" o campo de
    // visão de câmeras ultra-wide. Limita entre 1.5x e 2.5x para
    // não estourar o limite da lente.
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
    // Silencioso: ajustes são best-effort
    console.debug('[scanner] ajustarTrack falhou:', e);
  }
}

export async function iniciarScanner({
  elementId = 'reader',
  onDetected,
  onReady,
  onError
}) {
  if (typeof Html5Qrcode === 'undefined') {
    throw new Error('html5-qrcode não carregado');
  }

  const scanner = new Html5Qrcode(elementId);

  // Estratégia: por padrão, deixa o navegador escolher a traseira
  // via facingMode exact — funciona em ~todos os Androids modernos
  // sem risco de cair na frontal.
  // Só usa deviceId quando conseguimos identificar com SEGURANÇA
  // pelos labels qual é a traseira principal (não ultra-wide).
  let cameraConfig = { facingMode: { exact: 'environment' } };
  try {
    const cameras = await Html5Qrcode.getCameras();
    const escolhida = escolherTraseiraPrincipal(cameras);
    if (escolhida) {
      cameraConfig = { deviceId: { exact: escolhida.id } };
      console.debug('[scanner] usando câmera específica:', escolhida.label);
    } else {
      console.debug('[scanner] usando facingMode environment (fallback)');
    }
  } catch (e) {
    console.debug('[scanner] getCameras falhou, usando facingMode:', e);
  }

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
    // BarcodeDetector nativo tem bugs em Samsung Internet com
    // QRs pequenos — força o decoder JS, mais robusto.
    experimentalFeatures: {
      useBarCodeDetectorIfSupported: false
    },
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true
  };

  let scanAtivo = true;

  const onDecoded = (decoded) => {
    if (!scanAtivo) return;
    scanAtivo = false;
    const texto = (decoded || '').trim();
    scanner.stop().catch(() => {}).finally(() => {
      try { onDetected?.(texto); } catch (e) { console.error(e); }
    });
  };
  const onFrameErr = () => {};

  try {
    await scanner.start(cameraConfig, scanConfig, onDecoded, onFrameErr);
  } catch (e) {
    // Fallback: alguns devices antigos rejeitam exact:'environment'
    // ou deviceId específico. Tenta facingMode solto.
    console.debug('[scanner] start falhou, tentando fallback:', e);
    cameraConfig = { facingMode: 'environment' };
    await scanner.start(cameraConfig, scanConfig, onDecoded, onFrameErr);
  }

  // Foco contínuo + zoom: aplicar depois do start
  ajustarTrack(scanner);

  // Tap-to-focus: se suportado, ajuda quando o foco se perde
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

  try { onReady?.(); } catch (e) { console.error(e); }

  return {
    stop: async () => {
      scanAtivo = false;
      try { await scanner.stop(); } catch {}
    }
  };
}
