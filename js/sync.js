/* Cola de envío a ArcGIS Online. La ejecutan la página y el service worker (Background Sync).
 * Cada registro avanza por pasos idempotentes y guarda su progreso:
 *   1. crear (o actualizar) la entidad  -> guarda objectId
 *   2. subir cada foto pendiente        -> marca la foto como subida
 * Si la conexión cae a mitad, el siguiente intento continúa donde se quedó. Antes de reintentar
 * un alta, se comprueba por GlobalID si ya llegó al servidor, para no duplicarla.
 */
(function (g) {
  const CFG = g.APP_CONFIG;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sync-' + CFG.project) : null;
  const emit = (msg) => { try { channel && channel.postMessage(msg); } catch (e) { /* sin canal */ } };

  const Sync = { channel };
  const OWNER = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
  const LEASE_MS = 5 * 60 * 1000;

  Sync.getLayer = async function (token, force) {
    let layer = await DB.kvGet('layer');
    const serviceUrl = (await DB.kvGet('serviceUrl')) || CFG.serviceUrl;
    if (!force && layer && layer.serviceUrl === serviceUrl && Date.now() - (layer.fetchedAt || 0) < 6 * 3600 * 1000) return layer;
    const r = await AGOL.resolveLayer(serviceUrl, CFG.layerId, token);
    layer = { url: r.url, info: r.info, serviceUrl, fetchedAt: Date.now() };
    await DB.kvSet('layer', layer);
    return layer;
  };

  const saveRec = (r) => { r.updatedAt = r.updatedAt || Date.now(); return DB.put('records', r).then(() => emit({ type: 'record', localId: r.localId, status: r.status })); };

  async function ensureFeature(r, layer, schema, token) {
    if (r.mode === 'update') {
      if (!r.objectId) throw AGOL.makeError('El registro editado no tiene identificador en el servidor', 'server');
      if (r.featureUpdated) return;
      if (!schema.canUpdate) throw AGOL.makeError('La capa no permite modificar registros (capacidad Update desactivada)', 'server');
      const { attributes, unmatched } = AGOL.toAttributes(r, schema, g.FORM, CFG, 'update');
      attributes[schema.oidField] = r.objectId;
      const feat = { attributes };
      if (r.location) feat.geometry = { x: r.location.lon, y: r.location.lat, spatialReference: { wkid: 4326 } };
      const res = await AGOL.applyEdits(layer.url, { updates: [feat] }, token);
      const ur = res.updateResults && res.updateResults[0];
      if (!ur || !ur.success) throw resultError(ur, 'No se pudo actualizar el registro');
      r.featureUpdated = true; r.unmatched = unmatched;
      await saveRec(r);
      return;
    }

    if (r.objectId) return;
    const { attributes, unmatched } = AGOL.toAttributes(r, schema, g.FORM, CFG, 'add');

    // ¿Llegó ya en un intento anterior cuya respuesta se perdió?
    if ((r.attempts || 0) > 0 && schema.gidField && r.globalId) {
      const q = await AGOL.query(layer.url, { where: schema.gidField + "='" + r.globalId + "'", returnIdsOnly: true }, token);
      if (q.objectIds && q.objectIds.length) { r.objectId = q.objectIds[0]; r.unmatched = unmatched; await saveRec(r); return; }
    }

    r.attempts = (r.attempts || 0) + 1;
    await saveRec(r);
    const useGlobalIds = !!(schema.supportsGlobalIds && schema.gidField && r.globalId);
    if (useGlobalIds) attributes[schema.gidField] = r.globalId;
    const feat = { attributes, geometry: { x: r.location.lon, y: r.location.lat, spatialReference: { wkid: 4326 } } };
    const res = await AGOL.applyEdits(layer.url, { adds: [feat], useGlobalIds }, token);
    const ar = res.addResults && res.addResults[0];
    if (!ar || !ar.success) {
      // El navegador puede reenviar una petición cuya conexión se cortó: si el alta ya llegó,
      // el servidor rechaza la segunda por GlobalID repetido. En ese caso se adopta la existente.
      if (useGlobalIds) {
        const q = await AGOL.query(layer.url, { where: schema.gidField + "='" + r.globalId + "'", returnIdsOnly: true }, token);
        if (q.objectIds && q.objectIds.length) { r.objectId = q.objectIds[0]; r.unmatched = unmatched; await saveRec(r); return; }
      }
      throw resultError(ar, 'El servidor rechazó el registro');
    }
    r.objectId = ar.objectId;
    if (ar.globalId) r.globalId = ar.globalId;
    r.unmatched = unmatched;
    await saveRec(r);
  }

  function resultError(res, fallback) {
    const e = res && res.error;
    const code = e && Number(e.code);
    return AGOL.makeError(e ? (e.description || e.message || fallback) + (code ? ' (código ' + code + ')' : '') : fallback,
      code === 498 || code === 499 || code === 403 ? 'auth' : 'server', code);
  }

  async function uploadPhotos(r, layer, schema, token) {
    const photos = (await DB.byIndex('photos', 'recordId', r.localId)).filter((p) => !p.uploaded && p.blob);
    if (photos.length && !schema.hasAttachments) throw AGOL.makeError('La capa no tiene los adjuntos habilitados. Actívalos en AGOL (Settings > Attachments).', 'server');
    photos.sort((a, b) => a.createdAt - b.createdAt);
    for (const ph of photos) {
      const file = (typeof File !== 'undefined') ? new File([ph.blob], ph.fileName || (ph.field + '.jpg'), { type: ph.blob.type || 'image/jpeg' }) : ph.blob;
      let res;
      try {
        res = await AGOL.addAttachment(layer.url, r.objectId, file, ph.field, token);
      } catch (e) {
        if (e.kind !== 'server') throw e;
        // Capas sin soporte de keywords: reintenta sin ellas (el nombre del archivo conserva la pregunta).
        res = await AGOL.addAttachment(layer.url, r.objectId, file, null, token);
      }
      const ar = res.addAttachmentResult;
      if (!ar || !ar.success) throw resultError(ar, 'No se pudo subir la foto');
      ph.uploaded = true; ph.attachmentId = ar.objectId; ph.blob = null; ph.uploadedAt = Date.now();
      await DB.put('photos', ph);
      emit({ type: 'photo', localId: r.localId });
    }
  }

  async function runOnce() {
    const result = { status: 'ok', sent: 0, failed: 0, remaining: 0, message: '' };
    const token = await DB.kvGet('apiKey');
    const queue = (await DB.all('records'))
      .filter((r) => r.status === 'pending' || r.status === 'syncing')
      .sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
    result.remaining = queue.length;
    if (!queue.length) return result;
    if (!token) return Object.assign(result, { status: 'nokey', message: 'Falta la clave de acceso. Añádela en Ajustes.' });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Object.assign(result, { status: 'offline', message: 'Sin conexión. Se enviará al recuperar cobertura.' });

    let layer;
    try { layer = await Sync.getLayer(token); }
    catch (e) { return Object.assign(result, { status: e.kind === 'auth' ? 'auth' : (e.kind === 'net' ? 'offline' : 'error'), message: e.message }); }
    const schema = AGOL.buildSchema(layer.info);

    for (const item of queue) {
      // Reserva atómica: si la página y el service worker envían a la vez, solo uno procesa cada registro.
      const r = await DB.claim(item.localId, OWNER, LEASE_MS);
      if (!r) { result.remaining--; continue; }
      r.lastError = null;
      emit({ type: 'record', localId: r.localId, status: r.status });
      try {
        await ensureFeature(r, layer, schema, token);
        await uploadPhotos(r, layer, schema, token);
        r.status = 'synced'; r.syncedAt = Date.now(); r.lastError = null; r.lease = null;
        await saveRec(r);
        result.sent++; result.remaining--;
      } catch (e) {
        r.lastError = e.message; r.lease = null;
        if (e.kind === 'net') { r.status = 'pending'; await saveRec(r); return Object.assign(result, { status: 'offline', message: e.message }); }
        if (e.kind === 'auth') { r.status = 'pending'; await saveRec(r); return Object.assign(result, { status: 'auth', message: 'La clave de acceso no es válida o ha caducado: ' + e.message }); }
        r.status = 'error'; await saveRec(r);
        result.failed++; result.remaining--;
        result.status = 'error'; result.message = e.message;
      }
    }
    return result;
  }

  let running = null;
  Sync.run = function () {
    if (running) return running;
    const exec = async () => {
      emit({ type: 'sync-start' });
      let res;
      try { res = await runOnce(); }
      catch (e) { res = { status: 'error', message: e.message || String(e), remaining: 1 }; }
      await DB.kvSet('lastSync', { at: Date.now(), result: res });
      emit({ type: 'sync-end', result: res });
      return res;
    };
    const locked = (typeof navigator !== 'undefined' && navigator.locks)
      ? navigator.locks.request('sync-' + CFG.project, { ifAvailable: true }, (lock) => lock ? exec() : { status: 'busy', remaining: 0 })
      : exec();
    running = Promise.resolve(locked).finally(() => { running = null; });
    return running;
  };

  g.Sync = Sync;
})(self);
