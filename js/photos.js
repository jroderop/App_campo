/* Procesado de fotos en el dispositivo: reduce tamaño antes de guardar y enviar. */
(function (g) {
  const Photos = {};

  async function decode(file) {
    if (g.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fallback */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  function draw(src, maxSide) {
    const w = src.width, h = src.height;
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (canvas, q) => new Promise((resolve, reject) =>
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen')), 'image/jpeg', q));

  /* Devuelve { blob, thumb (dataURL), width, height } */
  Photos.process = async function (file, maxSide, quality) {
    const src = await decode(file);
    const full = draw(src, maxSide);
    const blob = await toBlob(full, quality);
    const thumb = draw(full, 320).toDataURL('image/jpeg', 0.7);
    if (src.close) src.close();
    return { blob, thumb, width: full.width, height: full.height };
  };

  g.Photos = Photos;
})(self);
