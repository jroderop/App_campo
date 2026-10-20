/* Lector de códigos de barras / QR con la cámara.
 * Usa BarcodeDetector (Chrome Android) y, si no existe (iOS), la librería ZXing incluida.
 */
(function (g) {
  const Scanner = {};
  const FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix', 'codabar', 'pdf417'];

  let stream = null, raf = null, zxingReader = null;

  Scanner.supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  Scanner.start = async function (video, onResult) {
    Scanner.stop(video);
    if ('BarcodeDetector' in g) {
      let formats = FORMATS;
      try { const sup = await g.BarcodeDetector.getSupportedFormats(); formats = FORMATS.filter((f) => sup.indexOf(f) !== -1); } catch (e) { /* usa la lista */ }
      if (formats.length) {
        const detector = new g.BarcodeDetector({ formats });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        video.srcObject = stream;
        video.setAttribute('playsinline', '');
        await video.play();
        const tick = async () => {
          if (!stream) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length && codes[0].rawValue) { onResult(codes[0].rawValue); return; }
          } catch (e) { /* frame no listo */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return 'native';
      }
    }
    if (!g.ZXing) throw new Error('Este navegador no puede leer códigos. Escribe el número a mano.');
    zxingReader = new g.ZXing.BrowserMultiFormatReader();
    await zxingReader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result) => {
      if (result) onResult(result.getText());
    });
    return 'zxing';
  };

  Scanner.stop = function (video) {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (zxingReader) { try { zxingReader.reset(); } catch (e) { /* ya parado */ } zxingReader = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { try { video.pause(); } catch (e) { /* nada */ } video.srcObject = null; }
  };

  g.Scanner = Scanner;
})(self);
