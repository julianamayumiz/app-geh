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

// Escolhe a melhor câmera traseira disponível.
// Em Samsungs com múltiplas lentes, evita ultra-wide / telephoto
// e prefere a câmera principal (1x).
function escolherCameraTraseira(cameras) {
  if (!cameras || cameras.length === 0) return null;
  if (cameras.length === 1) return cameras[0];

  const evitar = /(front|user|wide|ultra|0\.5|tele|depth|mono|bokeh)/i;
  const preferir = /(back|rear|traseir|environment)/i;

  // Primeiro: traseiras que NÃO sejam ultra-wide/tele
  const traseirasOk = cameras.filter(c =>
    preferir.test(c.label) && !evitar.test(c.label)
  );
  if (traseirasOk.length > 0) return traseirasOk[0];

  // Segundo: qualquer câmera que não seja explicitamente "evitar"
  const naoEvitar = cameras.filter(c => !evitar.test(c.label));
  if (naoEvitar.length > 0) {
    // Em muitos Androids, a câmera principal traseira é a última
    // da lista (front costuma vir primeiro). Se não houver pista
    // pelo label, pega a última.
    return naoEvitar[naoEvitar.length - 1];
  }

  return cameras[cameras.length - 1];
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

  // Escolhe a câmera explicitamente, em vez de só passar
  // facingMode — Samsungs tendem a cair na ultra-wide nesse caso.
  let cameraId = null;
  try {
    const cameras = await Html5Qrcode.getCameras();
    const escolhida = escolherCameraTraseira(cameras);
    if (escolhida) cameraId = escolhida.id;
  } catch (e) {
    console.debug('[scanner] getCameras falhou, usando facingMode:', e);
  }

  const cameraConfig = cameraId
    ? { deviceId: { exact: cameraId } }
    : { facingMode: 'environment' };

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

  await scanner.start(
    cameraConfig,
    scanConfig,
    (decoded) => {
      if (!scanAtivo) return;
      scanAtivo = false;
      const texto = (decoded || '').trim();
      // Para a câmera antes de navegar para evitar leak da track
      scanner.stop().catch(() => {}).finally(() => {
        try { onDetected?.(texto); } catch (e) { console.error(e); }
      });
    },
    () => {
      // erros por frame: ignorar
    }
  );

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
