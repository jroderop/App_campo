/* Interfaz de la app de instalaciones. */
(function () {
  'use strict';

  const CFG = self.APP_CONFIG;
  const FORM = self.FORM;
  const SECTIONS = FORM.sections;
  const secById = (id) => SECTIONS.find((s) => s.id === id);
  const STATUS = { draft: 'Borrador', pending: 'Pendiente', syncing: 'Enviando', synced: 'Enviado', error: 'Error' };
  const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const TILES_CACHE = 'tiles-v2';
  const STREETS = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

  const $ = (s, r) => (r || document).querySelector(s);

  /* Crea elementos sin innerHTML (los textos del usuario nunca se interpretan como HTML). */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  function icon(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(ns, 'use');
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  }

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }));
  const fmtDate = (ms) => ms ? new Date(ms).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const hasValue = AGOL.hasValue;

  const state = {
    schema: null, apiKey: '',
    view: 'home', tab: 'local',
    rec: null, photos: [], steps: [], step: 0,
    dirty: false, origin: null, showErrors: false,
    map: null, mapLayers: null, gps: { watch: null, last: null, error: '', follow: false }, mapManual: false,
    saveTimer: null, photoTarget: null, scanning: false
  };

  /* ================= arranque ================= */
  async function init() {
    document.title = CFG.appName;
    $('#brand-title').textContent = CFG.appName;
    $('#brand-sub').textContent = 'Proyecto ' + CFG.project;
    $('#brand-mark').textContent = CFG.appName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    $('#app-version').textContent = CFG.appName + ' · v' + CFG.version;

    try {
      state.apiKey = (await DB.kvGet('apiKey')) || '';
      const layer = await DB.kvGet('layer');
      if (layer && layer.info) state.schema = AGOL.buildSchema(layer.info);
    } catch (e) {
      toast('Este navegador no permite guardar datos. Sal del modo incógnito.', true, 6000);
    }

    bindEvents();
    updateNet();
    registerSW();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    await renderHome();
    refreshSchema();
    runSync(true);
    setInterval(() => runSync(true), CFG.syncIntervalMs);
  }

  function bindEvents() {
    $('#btn-new').addEventListener('click', newRecord);
    $('#btn-sync').addEventListener('click', () => runSync(false));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-settings-close').addEventListener('click', () => showView('home'));
    $('#btn-form-close').addEventListener('click', closeForm);
    $('#btn-prev').addEventListener('click', () => goStep(state.step - 1));
    $('#btn-next').addEventListener('click', () => (isReview() ? submit() : goStep(state.step + 1)));
    $('#tab-local').addEventListener('click', () => setTab('local'));
    $('#tab-server').addEventListener('click', () => setTab('server'));
    $('#server-search').addEventListener('submit', (e) => { e.preventDefault(); renderServer($('#server-q').value); });
    $('#btn-test').addEventListener('click', testConnection);
    $('#btn-key-eye').addEventListener('click', () => { const i = $('#set-key'); i.type = i.type === 'password' ? 'text' : 'password'; });
    $('#btn-clear-sent').addEventListener('click', clearSent);
    $('#btn-clear-all').addEventListener('click', clearAll);
    $('#btn-clear-tiles').addEventListener('click', clearTiles);
    $('#btn-scan-cancel').addEventListener('click', closeScanner);
    $('#file-camera').addEventListener('change', onFiles);
    $('#file-gallery').addEventListener('change', onFiles);

    window.addEventListener('online', () => { updateNet(); runSync(true); });
    window.addEventListener('offline', updateNet);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) runSync(true); });

    if (Sync.channel) Sync.channel.addEventListener('message', (e) => onSyncMessage(e.data));
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => onSyncMessage(e.data));
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker no registrado', e));
  }

  async function requestBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('sync-' + CFG.project);
    } catch (e) { /* navegador sin Background Sync: se reintenta al abrir la app o recuperar conexión */ }
  }

  async function refreshSchema() {
    if (!state.apiKey || !navigator.onLine) return;
    try {
      const layer = await Sync.getLayer(state.apiKey);
      state.schema = AGOL.buildSchema(layer.info);
      if (state.view === 'home') renderHome();
    } catch (e) { /* se informa en Ajustes al probar la conexión */ }
  }

  function updateNet() {
    const on = navigator.onLine;
    $('#net').classList.toggle('off', !on);
    $('#net-txt').textContent = on ? 'En línea' : 'Sin conexión';
  }

  /* ================= sincronización ================= */
  let syncing = false;
  async function runSync(quiet) {
    if (syncing) return;
    syncing = true;
    setSyncSpinning(true);
    let res;
    try { res = await Sync.run(); }
    finally { syncing = false; setSyncSpinning(false); }
    if (res && res.remaining > 0 && res.status !== 'nokey') requestBackgroundSync();
    if (!quiet && res) {
      if (res.status === 'ok' && res.sent) toast(res.sent === 1 ? 'Registro enviado a ArcGIS Online' : res.sent + ' registros enviados');
      else if (res.status === 'ok' && !res.sent) toast('No hay nada pendiente de envío');
      else if (res.message) toast(res.message, res.status !== 'offline', 5000);
    } else if (res && res.sent) {
      toast(res.sent === 1 ? 'Registro enviado a ArcGIS Online' : res.sent + ' registros enviados');
    }
    if (state.view === 'home') renderHome();
  }

  function setSyncSpinning(on) {
    const ic = $('#sync-icon');
    ic.querySelector('use').setAttribute('href', on ? '#i-sync' : '#i-cloud');
    ic.classList.toggle('spin', on);
  }

  let msgTimer = null;
  function onSyncMessage(msg) {
    if (!msg || state.view !== 'home') return;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(renderHome, 250);
  }

  /* ================= navegación ================= */
  function showView(v) {
    state.view = v;
    $('#view-home').hidden = v !== 'home';
    $('#view-form').hidden = v !== 'form';
    $('#view-settings').hidden = v !== 'settings';
    $('#formbar').hidden = v !== 'form';
    window.scrollTo(0, 0);
    if (v === 'home') renderHome();
  }

  function setTab(t) {
    state.tab = t;
    $('#tab-local').setAttribute('aria-selected', String(t === 'local'));
    $('#tab-server').setAttribute('aria-selected', String(t === 'server'));
    $('#pane-local').hidden = t !== 'local';
    $('#pane-server').hidden = t !== 'server';
    if (t === 'server' && !$('#server-list').childElementCount) renderServer('');
  }

  const editEnabled = () => CFG.editMode !== 'off' && !!(state.schema && state.schema.canUpdate);

  /* ================= inicio ================= */
  async function renderHome() {
    let recs = [];
    try { recs = await DB.all('records'); } catch (e) { /* sin almacenamiento */ }
    recs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $('#count-local').textContent = recs.length;
    $('#tab-server').hidden = !editEnabled();
    if (!editEnabled() && state.tab === 'server') setTab('local');

    const queue = recs.filter((r) => r.status === 'pending' || r.status === 'syncing' || r.status === 'error');
    const drafts = recs.filter((r) => r.status === 'draft');
    const sent = recs.filter((r) => r.status === 'synced').slice(0, 30);

    const pane = $('#pane-local');
    pane.replaceChildren();
    if (!recs.length) {
      pane.append(h('div', { class: 'empty' },
        h('b', { text: 'Aún no hay registros en este móvil' }),
        'Pulsa «Nueva instalación» para empezar. Funciona sin cobertura: lo que registres se envía solo cuando vuelva la conexión.'));
    }
    if (queue.length) pane.append(h('div', { class: 'group-label', text: 'Por enviar' }), ...queue.map(card));
    if (drafts.length) pane.append(h('div', { class: 'group-label', text: 'Borradores' }), ...drafts.map(card));
    if (sent.length) pane.append(h('div', { class: 'group-label', text: 'Enviados' }), ...sent.map(card));

    await updateSyncbar(queue);
  }

  async function updateSyncbar(queue) {
    const bar = $('#syncbar');
    const pending = queue.filter((r) => r.status !== 'error').length;
    const errors = queue.filter((r) => r.status === 'error').length;
    let last = null;
    try { last = await DB.kvGet('lastSync'); } catch (e) { /* nada */ }
    bar.classList.remove('warn', 'err');
    let title, sub;
    if (!state.apiKey) {
      title = 'Falta la clave de acceso'; sub = 'Sin ella no se puede enviar. Añádela en Ajustes.'; bar.classList.add('warn');
    } else if (errors) {
      title = errors === 1 ? '1 registro con error' : errors + ' registros con error'; sub = 'Revisa el motivo en la tarjeta y reinténtalo.'; bar.classList.add('err');
    } else if (pending) {
      title = pending === 1 ? '1 registro pendiente' : pending + ' registros pendientes';
      sub = navigator.onLine ? 'Se envían automáticamente.' : 'Se enviarán al recuperar cobertura.';
      bar.classList.add('warn');
    } else {
      title = 'Todo enviado';
      sub = last && last.at ? 'Última comprobación ' + fmtTime(last.at) : 'No hay registros pendientes';
    }
    if (last && last.result && last.result.status === 'auth') { title = 'Clave no válida'; sub = 'Ha caducado o no tiene acceso a la capa. Revísala en Ajustes.'; bar.classList.add('err'); }
    $('#sync-title').textContent = title;
    $('#sync-sub').textContent = sub;
    $('#btn-sync').disabled = !pending && !errors;
  }

  function choiceLabel(fieldName, value) {
    if (!hasValue(value)) return '';
    const ff = findField(fieldName);
    if (!ff) return String(value);
    const ch = AGOL.choices(ff, state.schema, FORM);
    const one = (v) => (ch.find((c) => String(c.name) === String(v)) || { label: v }).label;
    return Array.isArray(value) ? value.map(one).join(', ') : one(value);
  }
  function findField(name) {
    for (const s of SECTIONS) for (const f of s.fields) if (f.name === name) return f;
    return null;
  }

  function card(r) {
    const v = r.values || {};
    const title = v.Nombre_Inst || choiceLabel('instal', v.instal) || 'Instalación sin nombre';
    const meta = [];
    if (v.ID_instalador) meta.push(v.ID_instalador);
    if (v.instal && v.Nombre_Inst) meta.push(choiceLabel('instal', v.instal));
    meta.push(fmtDate(r.submittedAt || r.createdAt));
    if (r.photoCount) meta.push(r.photoCount + (r.photoCount === 1 ? ' foto' : ' fotos'));
    if (r.mode === 'update') meta.push('edición');

    const el = h('div', { class: 'card', role: 'button', tabindex: '0', onclick: () => openLocal(r), onkeydown: (e) => { if (e.key === 'Enter') openLocal(r); } },
      h('div', { class: 'card-title', text: title }),
      h('span', { class: 'status st-' + r.status, text: STATUS[r.status] || r.status }),
      h('div', { class: 'card-meta' }, ...meta.map((m) => h('span', { text: m }))),
      (r.sections && r.sections.length) ? h('div', { class: 'card-equip' }, ...r.sections.map((id) => h('span', { class: 'tag', text: (secById(id) || {}).short || id }))) : null,
      r.lastError && r.status !== 'synced' ? h('div', { class: 'card-err', text: r.lastError }) : null,
      r.unmatched && r.unmatched.length ? h('div', { class: 'card-warn', text: r.unmatched.length + ' campo(s) no existen en la capa y no se guardaron: ' + r.unmatched.join(', ') }) : null
    );
    const actions = [];
    if (r.status === 'error') actions.push(h('button', { class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); retry(r); } }, icon('i-sync'), 'Reintentar'));
    if (r.status === 'draft' || r.status === 'error') actions.push(h('button', { class: 'btn btn-sm btn-danger', onclick: (e) => { e.stopPropagation(); removeRecord(r); } }, icon('i-trash'), 'Eliminar'));
    if (actions.length) el.append(h('div', { class: 'card-actions' }, ...actions));
    return el;
  }

  async function retry(r) {
    r.status = 'pending'; r.lastError = null;
    await DB.put('records', r);
    runSync(false);
  }

  async function removeRecord(r) {
    const ok = await confirmSheet('¿Eliminar este registro?', r.objectId
      ? 'Se borra solo de este móvil. Lo ya enviado a ArcGIS Online no se toca.'
      : 'Se borrará del móvil con sus fotos. No se ha enviado, así que se pierde.', 'Eliminar', true);
    if (!ok) return;
    await deleteLocal(r.localId);
    toast('Registro eliminado');
    renderHome();
  }

  async function deleteLocal(localId) {
    const photos = await DB.byIndex('photos', 'recordId', localId);
    for (const p of photos) await DB.del('photos', p.id);
    await DB.del('records', localId);
  }

  /* ================= servidor (edición) ================= */
  async function renderServer(q) {
    const list = $('#server-list');
    list.replaceChildren();
    if (!navigator.onLine) { list.append(h('div', { class: 'empty' }, h('b', { text: 'Sin conexión' }), 'La lista del servidor necesita cobertura.')); return; }
    if (!state.apiKey) { list.append(h('div', { class: 'empty' }, h('b', { text: 'Falta la clave de acceso' }), 'Añádela en Ajustes.')); return; }
    list.append(h('div', { class: 'empty', text: 'Cargando registros…' }));
    try {
      const layer = await Sync.getLayer(state.apiKey);
      const schema = state.schema = AGOL.buildSchema(layer.info);
      const searchFields = ['Nombre_Inst', 'ID_instalador', 'ID_Cuadro'].map((n) => AGOL.field(schema, n)).filter(Boolean).map((f) => f.name);
      let where = '1=1';
      const term = String(q || '').trim().toUpperCase().replace(/'/g, "''");
      if (term && searchFields.length) where = searchFields.map((f) => 'UPPER(' + f + ") LIKE '%" + term + "%'").join(' OR ');
      const res = await AGOL.query(layer.url, {
        where, outFields: '*', returnGeometry: true, outSR: 4326,
        orderByFields: schema.oidField + ' DESC', resultRecordCount: 50
      }, state.apiKey);
      list.replaceChildren();
      const feats = res.features || [];
      if (!feats.length) { list.append(h('div', { class: 'empty' }, h('b', { text: 'Sin resultados' }), term ? 'Prueba con otro texto.' : 'La capa todavía no tiene registros.')); return; }
      const ef = schema.editFields || {};
      for (const f of feats) {
        const a = f.attributes;
        const get = (n) => { const fd = AGOL.field(schema, n); return fd ? a[fd.name] : null; };
        const meta = [];
        if (get('ID_instalador')) meta.push(get('ID_instalador'));
        if (get('instal')) meta.push(choiceLabel('instal', String(get('instal'))));
        if (ef.editDateField && a[ef.editDateField]) meta.push('mod. ' + fmtDate(a[ef.editDateField]));
        meta.push('OID ' + a[schema.oidField]);
        list.append(h('div', { class: 'card', role: 'button', tabindex: '0', onclick: () => openServer(f) },
          h('div', { class: 'card-title', text: get('Nombre_Inst') || 'Registro ' + a[schema.oidField] }),
          h('span', { class: 'status st-synced', text: 'Servidor' }),
          h('div', { class: 'card-meta' }, ...meta.map((m) => h('span', { text: m })))));
      }
    } catch (e) {
      list.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'No se pudo cargar' }), e.message));
    }
  }

  async function openServer(feat) {
    const schema = state.schema;
    const oid = feat.attributes[schema.oidField];
    const local = (await DB.all('records')).find((r) => r.objectId === oid);
    if (local) return openLocal(local);
    const values = AGOL.fromAttributes(feat.attributes, schema, FORM);
    const rec = {
      localId: uuid(), globalId: schema.gidField ? feat.attributes[schema.gidField] : null,
      mode: 'update', objectId: oid, status: 'draft', values,
      location: feat.geometry && isFinite(feat.geometry.x) ? { lat: feat.geometry.y, lon: feat.geometry.x, accuracy: null, source: 'Servidor', ts: Date.now() } : null,
      sections: SECTIONS.filter((s) => !s.always && s.fields.some((f) => f.type !== 'image' && hasValue(values[f.name]))).map((s) => s.id),
      createdAt: Date.now(), updatedAt: Date.now(), photoCount: 0, serverAttachments: {}
    };
    try {
      const att = await AGOL.queryAttachments(state.layerUrl || (await Sync.getLayer(state.apiKey)).url, [oid], state.apiKey);
      const infos = ((att.attachmentGroups || [])[0] || {}).attachmentInfos || [];
      for (const i of infos) {
        let key = i.keywords || '';
        if (!key) { const m = imageFieldNames().find((n) => String(i.name || '').startsWith(n)); key = m || '_otros'; }
        rec.serverAttachments[key] = (rec.serverAttachments[key] || 0) + 1;
      }
    } catch (e) { /* sin información de adjuntos: no impide editar */ }
    openForm(rec, { fromServer: true });
  }

  function imageFieldNames() {
    const out = [];
    SECTIONS.forEach((s) => s.fields.forEach((f) => { if (f.type === 'image') out.push(f.name); }));
    return out.sort((a, b) => b.length - a.length);
  }

  /* ================= registros ================= */
  async function newRecord() {
    const values = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      if (f.type === 'image' || f.type === 'geopoint') continue;
      values[f.name] = f.type === 'select_multiple' ? [] : '';
      if (f.type === 'select_one') {
        const ch = AGOL.choices(f, state.schema, FORM);
        if (ch.length === 1 && f.required) values[f.name] = ch[0].name;
      }
    }
    try { const remembered = await DB.kvGet('remember_ID_instalador'); if (remembered) values.ID_instalador = remembered; } catch (e) { /* nada */ }
    const rec = {
      localId: uuid(), globalId: '{' + uuid().toUpperCase() + '}', mode: 'add', status: 'draft',
      values, location: null, sections: [], createdAt: Date.now(), updatedAt: Date.now(), photoCount: 0
    };
    openForm(rec, { isNew: true });
  }

  async function openLocal(r) {
    if (r.status === 'syncing') return toast('Se está enviando. Espera unos segundos.');
    if ((r.status === 'pending' || r.status === 'error') && r.objectId && r.mode === 'add') {
      return toast('El registro ya está en el servidor y faltan fotos por subir. Espera a que termine el envío.', false, 4500);
    }
    if (r.status === 'synced') {
      if (!editEnabled()) return toast('Registro enviado. La edición está desactivada por el administrador.', false, 4500);
      openForm(r, { reopenSynced: true });
      return;
    }
    openForm(r, {});
  }

  async function openForm(rec, opts) {
    state.origin = {
      status: rec.status, mode: rec.mode, featureUpdated: rec.featureUpdated,
      isNew: !!opts.isNew, fromServer: !!opts.fromServer, reopenSynced: !!opts.reopenSynced
    };
    if (rec.status === 'pending' || rec.status === 'error') { rec.status = 'draft'; await DB.put('records', rec); }
    if (opts.reopenSynced) { rec.mode = 'update'; rec.status = 'draft'; rec.featureUpdated = false; }
    state.rec = rec;
    state.photos = await DB.byIndex('photos', 'recordId', rec.localId);
    state.dirty = false;
    state.showErrors = false;
    buildSteps();
    state.step = 0;
    showView('form');
    const mode = $('#form-mode');
    mode.hidden = rec.mode !== 'update';
    mode.textContent = rec.mode === 'update' ? 'Editando un registro ya enviado (OID ' + rec.objectId + '). Al enviar se actualizará en ArcGIS Online.' : '';
    renderStep();
  }

  async function closeForm() {
    clearTimeout(state.saveTimer);
    stopGPS();
    const r = state.rec;
    const o = state.origin || {};
    if (!state.dirty && (o.isNew || o.fromServer)) {
      await deleteLocal(r.localId);
    } else if (!state.dirty && o.reopenSynced) {
      r.status = 'synced'; r.mode = o.mode; r.featureUpdated = o.featureUpdated;
      await DB.put('records', r);
    } else {
      await saveNow();
      if (state.dirty) toast('Guardado como borrador');
    }
    state.rec = null;
    destroyMap();
    showView('home');
  }

  function markDirty() { state.dirty = true; scheduleSave(); }
  function scheduleSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveNow, 400); }
  async function saveNow() {
    clearTimeout(state.saveTimer);
    const r = state.rec;
    if (!r) return;
    if (!state.dirty && (state.origin.isNew || state.origin.fromServer)) return;
    r.updatedAt = Date.now();
    r.photoCount = state.photos.length;
    try {
      await DB.put('records', r);
      $('#saved').textContent = 'Guardado ' + fmtTime(r.updatedAt);
    } catch (e) {
      $('#saved').textContent = 'Sin guardar';
    }
  }

  function setVal(name, v) {
    state.rec.values[name] = v;
    const fe = document.querySelector('.field[data-name="' + name + '"]');
    if (fe) { fe.classList.remove('invalid'); const er = fe.querySelector('.field-err'); if (er) er.remove(); }
    markDirty();
  }

  /* ================= pasos ================= */
  function buildSteps() {
    const r = state.rec;
    const order = SECTIONS.filter((s) => !s.always).map((s) => s.id);
    r.sections = (r.sections || []).filter((id) => order.indexOf(id) !== -1).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    state.steps = ['ident', 'equip'].concat(r.sections, ['review']);
  }
  const isReview = () => state.steps[state.step] === 'review';

  function goStep(i) {
    if (i < 0 || i >= state.steps.length) return;
    saveNow();
    state.step = i;
    renderStep();
    window.scrollTo(0, 0);
  }

  function renderHeader() {
    const id = state.steps[state.step];
    const title = id === 'equip' ? 'Equipos instalados' : id === 'review' ? 'Revisar y enviar' : (secById(id) || {}).title;
    $('#step-title').textContent = title;
    $('#step-count').textContent = (state.step + 1) + '/' + state.steps.length;
    const prog = $('#progress');
    prog.replaceChildren(...state.steps.map((_, i) => h('span', { class: i < state.step ? 'done' : i === state.step ? 'now' : '' })));
    $('#btn-prev').disabled = state.step === 0;
    const next = $('#btn-next');
    next.replaceChildren();
    if (isReview()) next.append(icon('i-check'), state.rec.mode === 'update' ? 'Enviar cambios' : 'Enviar');
    else next.append('Siguiente', icon('i-next'));
  }

  function renderStep() {
    const id = state.steps[state.step];
    if (id !== 'ident') { stopGPS(); destroyMap(); }
    renderHeader();
    const body = $('#step-body');
    body.replaceChildren();
    if (id === 'equip') body.append(renderEquip());
    else if (id === 'review') body.append(renderReview());
    else body.append(renderSection(secById(id)));
  }

  function renderSection(sec) {
    const wrap = h('div', {});
    if (sec.hint) wrap.append(h('p', { class: 'section-hint', text: sec.hint }));
    const fields = h('div', { class: 'fields' });
    sec.fields.forEach((f) => fields.append(renderField(f)));
    wrap.append(fields);
    return wrap;
  }

  function renderEquip() {
    const r = state.rec;
    const wrap = h('div', {});
    wrap.append(h('p', { class: 'section-hint', text: 'Marca los equipos que instalas en este punto. Solo verás sus apartados.' }));
    const grid = h('div', { class: 'equip-grid' });
    SECTIONS.filter((s) => !s.always).forEach((s) => {
      const btn = h('button', { class: 'equip', type: 'button', 'aria-pressed': String(r.sections.indexOf(s.id) !== -1) },
        icon(s.icon), h('b', { text: s.title }));
      btn.addEventListener('click', () => {
        const on = r.sections.indexOf(s.id) !== -1;
        r.sections = on ? r.sections.filter((x) => x !== s.id) : r.sections.concat(s.id);
        btn.setAttribute('aria-pressed', String(!on));
        buildSteps();
        renderHeader();
        markDirty();
      });
      grid.append(btn);
    });
    wrap.append(grid);
    return wrap;
  }

  /* ================= campos ================= */
  function renderField(f) {
    const r = state.rec;
    const id = 'f-' + f.name;
    const wrap = h('div', { class: 'field', dataset: { name: f.name } });
    const labelEl = h(f.type === 'image' || f.type === 'select_one' || f.type === 'select_multiple' || f.type === 'geopoint' ? 'div' : 'label',
      { class: 'field-label', for: id }, f.label, f.required ? h('span', { class: 'req', text: '*', 'aria-label': 'obligatorio' }) : null);
    wrap.append(labelEl);
    if (f.hint) wrap.append(h('div', { class: 'field-hint', text: f.hint }));
    const v = r.values[f.name];

    switch (f.type) {
      case 'text': case 'barcode': {
        const inp = h('input', { class: 'input' + (f.uppercase ? ' upper' : '') + (f.type === 'barcode' ? ' mono' : ''), id, type: 'text', value: v || '', autocomplete: 'off', autocapitalize: f.uppercase ? 'characters' : 'sentences', spellcheck: f.type === 'barcode' ? 'false' : null });
        inp.addEventListener('input', () => setVal(f.name, f.uppercase ? inp.value.toUpperCase() : inp.value));
        if (f.type === 'barcode') {
          const scan = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Leer código con la cámara', onclick: () => openScanner(inp, f) }, icon('i-barcode'));
          if (!window.Scanner.supported()) scan.hidden = true;
          wrap.append(h('div', { class: 'input-row' }, inp, scan));
        } else wrap.append(inp);
        break;
      }
      case 'textarea': {
        const ta = h('textarea', { class: 'input', id, rows: '3' });
        ta.value = v || '';
        ta.addEventListener('input', () => setVal(f.name, ta.value));
        wrap.append(ta);
        break;
      }
      case 'integer': case 'decimal': {
        const inp = h('input', { class: 'input mono', id, type: 'text', inputmode: f.type === 'integer' ? 'numeric' : 'decimal', value: v || '', autocomplete: 'off' });
        inp.addEventListener('input', () => setVal(f.name, inp.value.trim()));
        wrap.append(f.unit ? h('div', { class: 'input-unit' }, inp, h('em', { text: f.unit })) : inp);
        break;
      }
      case 'dateTime': case 'date': case 'time': {
        const type = f.type === 'dateTime' ? 'datetime-local' : f.type;
        const inp = h('input', { class: 'input', id, type, value: v || '' });
        inp.addEventListener('change', () => setVal(f.name, inp.value));
        inp.addEventListener('input', () => setVal(f.name, inp.value));
        const now = h('button', { class: 'btn', type: 'button', onclick: () => {
          const ms = Date.now();
          inp.value = f.type === 'dateTime' ? AGOL.localDateTime(ms) : f.type === 'date' ? AGOL.localDate(ms) : AGOL.localTime(ms);
          setVal(f.name, inp.value);
        } }, f.type === 'date' ? 'Hoy' : 'Ahora');
        wrap.append(h('div', { class: 'input-row' }, inp, now));
        break;
      }
      case 'select_one': case 'select_multiple': {
        const multi = f.type === 'select_multiple';
        const chips = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-label': f.label });
        const choices = AGOL.choices(f, state.schema, FORM);
        const isOn = (name) => multi ? (v || []).map(String).indexOf(String(name)) !== -1 : String(r.values[f.name]) === String(name);
        choices.forEach((c) => {
          const b = h('button', { class: 'chip', type: 'button', role: multi ? null : 'radio', 'aria-pressed': multi ? String(isOn(c.name)) : null, 'aria-checked': multi ? null : String(isOn(c.name)) },
            multi ? icon('i-check', 'tick') : null, c.label);
          b.addEventListener('click', () => {
            if (multi) {
              const cur = (r.values[f.name] || []).map(String);
              const nv = cur.indexOf(String(c.name)) !== -1 ? cur.filter((x) => x !== String(c.name)) : cur.concat(String(c.name));
              setVal(f.name, nv);
              b.setAttribute('aria-pressed', String(nv.indexOf(String(c.name)) !== -1));
            } else {
              const same = String(r.values[f.name]) === String(c.name);
              setVal(f.name, same && !f.required ? '' : String(c.name));
              chips.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-checked', 'false'));
              if (!(same && !f.required)) b.setAttribute('aria-checked', 'true');
            }
          });
          chips.append(b);
        });
        wrap.append(chips);
        break;
      }
      case 'image':
        wrap.append(h('div', { class: 'photo-box' }));
        fillPhotos(wrap, f);
        break;
      case 'geopoint':
        wrap.append(renderGeo());
        break;
    }
    if (state.showErrors) {
      const err = fieldError(f);
      if (err) { wrap.classList.add('invalid'); wrap.append(h('div', { class: 'field-err', text: err })); }
    }
    return wrap;
  }

  function fieldError(f) {
    const r = state.rec;
    if (f.type === 'geopoint') return f.required && !r.location ? 'Falta la ubicación.' : '';
    const v = r.values[f.name];
    if (f.required && !hasValue(v)) return 'Este dato es obligatorio.';
    if (hasValue(v) && f.type === 'integer' && !/^-?\d+$/.test(String(v))) return 'Escribe un número entero.';
    if (hasValue(v) && f.type === 'decimal' && !/^-?\d+([.,]\d+)?$/.test(String(v))) return 'Escribe un número (usa coma o punto para decimales).';
    return '';
  }

  /* ---------- fotos ---------- */
  function fillPhotos(wrap, f) {
    const box = wrap.querySelector('.photo-box');
    box.replaceChildren();
    const mine = state.photos.filter((p) => p.field === f.name).sort((a, b) => a.createdAt - b.createdAt);
    const max = f.max || 1;
    if (mine.length) {
      const grid = h('div', { class: 'photos' });
      mine.forEach((p) => {
        const tile = h('div', { class: 'photo' }, h('img', { src: p.thumb, alt: f.label }));
        if (p.uploaded) tile.append(h('span', { class: 'badge', text: 'Enviada' }));
        else tile.append(h('button', { class: 'del', type: 'button', 'aria-label': 'Quitar foto', onclick: () => removePhoto(p, wrap, f) }, icon('i-x')));
        grid.append(tile);
      });
      box.append(grid);
    }
    const srv = state.rec.serverAttachments && state.rec.serverAttachments[f.name];
    if (srv) box.append(h('div', { class: 'server-note', text: 'En el servidor: ' + srv + (srv === 1 ? ' foto' : ' fotos') + '. Las nuevas se añaden a esas.' }));
    const pendingLocal = mine.filter((p) => !p.uploaded).length;
    const full = max > 1 && pendingLocal >= max;
    const camLabel = max === 1 && pendingLocal ? 'Repetir foto' : 'Hacer foto';
    box.append(h('div', { class: 'photo-actions' },
      h('button', { class: 'btn', type: 'button', disabled: full, onclick: () => pickPhoto(f, 'camera', wrap) }, icon('i-camera'), camLabel),
      h('button', { class: 'btn btn-ghost', type: 'button', disabled: full, onclick: () => pickPhoto(f, 'gallery', wrap) }, icon('i-image'), 'Galería')));
  }

  function pickPhoto(f, source, wrap) {
    state.photoTarget = { f, wrap };
    const inp = $(source === 'camera' ? '#file-camera' : '#file-gallery');
    inp.multiple = source === 'gallery' && (f.max || 1) > 1;
    inp.value = '';
    inp.click();
  }

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    const t = state.photoTarget;
    if (!files.length || !t || !state.rec) return;
    const { f, wrap } = t;
    const max = f.max || 1;
    for (const file of files) {
      try {
        const out = await Photos.process(file, CFG.photoMaxSide, CFG.photoQuality);
        const existing = state.photos.filter((p) => p.field === f.name && !p.uploaded);
        if (max === 1) for (const p of existing) { await DB.del('photos', p.id); state.photos = state.photos.filter((x) => x.id !== p.id); }
        else if (existing.length >= max) { toast('Máximo ' + max + ' fotos en este apartado'); break; }
        const d = new Date();
        const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
        const photo = {
          id: uuid(), recordId: state.rec.localId, field: f.name, blob: out.blob, thumb: out.thumb,
          fileName: f.name + '_' + stamp + '.jpg', uploaded: false, createdAt: Date.now()
        };
        await DB.put('photos', photo);
        state.photos.push(photo);
      } catch (err) {
        toast('No se pudo guardar la foto: ' + err.message, true);
      }
    }
    markDirty();
    fillPhotos(wrap, f);
  }

  async function removePhoto(p, wrap, f) {
    await DB.del('photos', p.id);
    state.photos = state.photos.filter((x) => x.id !== p.id);
    markDirty();
    fillPhotos(wrap, f);
  }

  /* ---------- ubicación ---------- */
  function renderGeo() {
    const wrap = h('div', { class: 'geo' });
    const mapDiv = h('div', { class: 'map', id: 'map' });
    const tools = h('div', { class: 'map-tools' },
      h('button', { type: 'button', 'aria-label': 'Cambiar mapa base', onclick: toggleBasemap }, icon('i-layers')));
    wrap.append(h('div', { class: 'map-wrap' }, mapDiv, h('div', { class: 'crosshair' }, h('i')), tools));
    wrap.append(h('div', { class: 'geo-read', id: 'geo-read' }));
    wrap.append(h('div', { class: 'geo-actions' },
      h('button', { class: 'btn', type: 'button', id: 'btn-use-gps', onclick: useGPS }, icon('i-target'), 'Usar mi posición GPS')));
    requestAnimationFrame(() => initMap(mapDiv));
    return wrap;
  }

  function destroyMap() {
    if (state.map) { try { state.map.remove(); } catch (e) { /* ya eliminado */ } }
    state.map = null; state.mapLayers = null;
  }

  function initMap(div) {
    destroyMap();
    if (!window.L) { div.textContent = 'Mapa no disponible'; return; }
    const loc = state.rec.location;
    const center = loc ? [loc.lat, loc.lon] : CFG.mapCenter;
    const map = L.map(div, { zoomControl: true, attributionControl: true }).setView(center, loc ? 18 : CFG.mapZoom);
    // Teselas con CORS para que el service worker pueda guardarlas con su tamaño real.
    // Si el servidor no respondiera con CORS (con conexión y ninguna tesela cargada), se vuelve
    // al modo sin CORS: el mapa se ve, pero esas teselas no se guardan para uso sin conexión.
    const makeLayer = (url, attribution, key) => {
      const opts = { maxZoom: 21, maxNativeZoom: 19, attribution };
      if (state.corsTiles !== false) opts.crossOrigin = 'anonymous';
      const layer = L.tileLayer(url, opts);
      let ok = 0, ko = 0;
      layer.on('tileload', () => { ok++; });
      layer.on('tileerror', () => {
        if (!navigator.onLine || ok > 0 || state.corsTiles === false || ++ko < 3) return;
        state.corsTiles = false;
        const L2 = state.mapLayers;
        if (!L2 || !state.map) return;
        const fresh = L.tileLayer(url, { maxZoom: 21, maxNativeZoom: 19, attribution });
        if (L2.current === key) { state.map.removeLayer(layer); fresh.addTo(state.map); }
        L2[key] = fresh;
      });
      return layer;
    };
    const imagery = makeLayer(IMAGERY, 'Esri, Maxar, Earthstar Geographics', 'imagery');
    const streets = makeLayer(STREETS, 'Esri, HERE, Garmin, OSM', 'streets');
    imagery.addTo(map);
    const accCircle = L.circle(center, { radius: 0, color: '#80FFC8', weight: 1, fillOpacity: 0.12, interactive: false });
    const dot = L.circleMarker(center, { radius: 6, color: '#001c1c', weight: 2, fillColor: '#80FFC8', fillOpacity: 1, interactive: false });
    state.map = map;
    state.mapLayers = { imagery, streets, current: 'imagery', accCircle, dot, gpsShown: false };
    map.on('dragstart', () => { state.mapManual = true; });
    map.on('moveend', () => {
      if (!state.mapManual) return;
      state.mapManual = false;
      const c = map.getCenter();
      setLocation({ lat: c.lat, lon: c.lng, accuracy: null, source: 'Manual', ts: Date.now() });
    });
    renderGeoReadout();
    if (!loc || loc.source === 'GPS') startGPS();
    if (state.gps.last) drawGPS(state.gps.last);
  }

  function toggleBasemap() {
    const L2 = state.mapLayers; if (!L2) return;
    const next = L2.current === 'imagery' ? 'streets' : 'imagery';
    state.map.removeLayer(L2[L2.current]);
    L2[next].addTo(state.map);
    L2.current = next;
  }

  function setLocation(loc) {
    state.rec.location = loc;
    const fe = document.querySelector('.field[data-name="_location"]');
    if (fe) { fe.classList.remove('invalid'); const er = fe.querySelector('.field-err'); if (er) er.remove(); }
    renderGeoReadout();
    markDirty();
  }

  function accClass(a) { return a == null ? '' : a <= CFG.gpsTargetAccuracy ? 'good' : a <= 15 ? 'mid' : 'bad'; }

  function renderGeoReadout() {
    const box = document.getElementById('geo-read');
    if (!box) return;
    box.replaceChildren();
    const loc = state.rec.location;
    if (!loc) {
      box.append(h('div', { class: 'coords', text: state.gps.error || (state.gps.watch !== null ? 'Buscando señal GPS…' : 'Sin ubicación') }));
      box.append(h('div', { class: 'src', text: 'O mueve el mapa hasta dejar la cruz sobre la instalación.' }));
      return;
    }
    const utm = Geo.toUTM(loc.lat, loc.lon, 30);
    const acc = loc.accuracy != null && isFinite(loc.accuracy) ? loc.accuracy : null;
    box.append(h('div', { class: 'coords', text: Geo.fmtLatLon(loc.lat, loc.lon) }));
    box.append(acc != null ? h('span', { class: 'acc ' + accClass(acc), text: '± ' + (acc < 10 ? acc.toFixed(1) : Math.round(acc)) + ' m' }) : h('span', { class: 'acc mid', text: loc.source }));
    box.append(h('div', { class: 'utm', text: 'ETRS89 UTM 30N  X ' + utm.x.toFixed(1) + '  Y ' + utm.y.toFixed(1) }));
    let src = loc.source === 'GPS' ? 'Posición GPS' + (state.gps.watch !== null ? ' · mejorando mientras estés en esta pantalla' : '') : loc.source === 'Manual' ? 'Colocada a mano en el mapa' : 'Ubicación guardada en el servidor';
    if (state.gps.error && loc.source !== 'GPS') src += ' · ' + state.gps.error;
    box.append(h('div', { class: 'src', text: src }));
  }

  function startGPS() {
    if (state.gps.watch !== null) return;
    if (!navigator.geolocation) { state.gps.error = 'Este dispositivo no ofrece GPS al navegador.'; renderGeoReadout(); return; }
    state.gps.error = '';
    state.gps.watch = navigator.geolocation.watchPosition(onGPS, (err) => {
      state.gps.error = err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en el navegador o coloca el punto a mano.'
        : err.code === 3 ? 'El GPS tarda en responder. Prueba al aire libre o coloca el punto a mano.' : 'No hay señal GPS.';
      if (err.code === 1) stopGPS();
      renderGeoReadout();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    renderGeoReadout();
  }

  function stopGPS() {
    if (state.gps.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.gps.watch);
    state.gps.watch = null;
  }

  function drawGPS(p) {
    const L2 = state.mapLayers; if (!L2 || !state.map) return;
    L2.accCircle.setLatLng([p.lat, p.lon]).setRadius(p.accuracy || 0);
    L2.dot.setLatLng([p.lat, p.lon]);
    if (!L2.gpsShown) { L2.accCircle.addTo(state.map); L2.dot.addTo(state.map); L2.gpsShown = true; }
  }

  function onGPS(pos) {
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, source: 'GPS', ts: Date.now() };
    state.gps.last = p; state.gps.error = '';
    drawGPS(p);
    const cur = state.rec && state.rec.location;
    if (!state.rec) return;
    if (!cur || cur.source === 'GPS' || state.gps.follow) {
      const better = !cur || state.gps.follow || p.accuracy <= (cur.accuracy == null ? Infinity : cur.accuracy) || Date.now() - cur.ts > 20000;
      if (better) {
        state.gps.follow = false;
        state.rec.location = p;
        if (state.map) state.map.setView([p.lat, p.lon], Math.max(state.map.getZoom(), 18), { animate: false });
        markDirty();
      }
    }
    renderGeoReadout();
  }

  function useGPS() {
    if (state.gps.last && Date.now() - state.gps.last.ts < 60000) {
      setLocation(Object.assign({}, state.gps.last, { ts: Date.now() }));
      if (state.map) state.map.setView([state.gps.last.lat, state.gps.last.lon], Math.max(state.map.getZoom(), 18));
      startGPS();
    } else {
      state.gps.follow = true;
      startGPS();
      toast('Buscando señal GPS…');
    }
    renderGeoReadout();
  }

  /* ---------- lector de códigos ---------- */
  async function openScanner(inp, f) {
    $('#scanner').hidden = false;
    $('#scan-msg').textContent = 'Encuadra el código de barras o QR';
    const video = $('#scan-video');
    try {
      await Scanner.start(video, (code) => {
        inp.value = code;
        setVal(f.name, code);
        if (navigator.vibrate) navigator.vibrate(60);
        closeScanner();
        toast('Código leído');
      });
    } catch (e) {
      closeScanner();
      toast(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Escribe el número a mano.' : (e.message || 'No se pudo abrir la cámara'), true, 4500);
    }
  }
  function closeScanner() {
    Scanner.stop($('#scan-video'));
    $('#scanner').hidden = true;
  }

  /* ---------- revisión y envío ---------- */
  function collectMissing() {
    const r = state.rec;
    const out = [];
    const sectionsToCheck = ['ident'].concat(r.sections);
    sectionsToCheck.forEach((sid) => {
      const sec = secById(sid);
      sec.fields.forEach((f) => { const err = fieldError(f); if (err) out.push({ sec, f, err }); });
    });
    return out;
  }

  function renderReview() {
    const r = state.rec;
    const wrap = h('div', { class: 'review' });
    const missing = collectMissing();

    if (missing.length) {
      const box = h('div', { class: 'missing' }, h('h3', { text: missing.length === 1 ? 'Falta 1 dato' : 'Faltan ' + missing.length + ' datos' }));
      missing.forEach((m) => {
        box.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { state.showErrors = true; goStep(state.steps.indexOf(m.sec.id)); } },
          m.sec.title + ' › ' + m.f.label));
      });
      wrap.append(box);
    }

    const loc = r.location;
    wrap.append(reviewRow('i-pin', 'Ubicación',
      loc ? Geo.fmtLatLon(loc.lat, loc.lon) + (loc.accuracy != null && isFinite(loc.accuracy) ? ' · ± ' + Math.round(loc.accuracy) + ' m' : ' · ' + loc.source) : 'Sin ubicación', !loc));

    const identMissing = missing.filter((m) => m.sec.id === 'ident' && m.f.type !== 'geopoint').length;
    const v = r.values;
    wrap.append(reviewRow('i-list', 'Identificación',
      identMissing ? 'Faltan datos obligatorios' : [v.ID_instalador, choiceLabel('instal', v.instal), v.Nombre_Inst].filter(Boolean).join(' · '), identMissing > 0, 0));

    if (!r.sections.length) wrap.append(h('div', { class: 'note', text: 'No has marcado ningún equipo. Si has instalado alguno, vuelve al paso «Equipos instalados».' }));
    r.sections.forEach((sid) => {
      const sec = secById(sid);
      const data = sec.fields.filter((f) => f.type !== 'image');
      const filled = data.filter((f) => hasValue(v[f.name])).length;
      const ph = state.photos.filter((p) => sec.fields.some((f) => f.name === p.field)).length;
      wrap.append(reviewRow(sec.icon, sec.title, filled + ' de ' + data.length + ' datos · ' + ph + (ph === 1 ? ' foto' : ' fotos'), false, state.steps.indexOf(sid)));
    });

    const totalPh = state.photos.filter((p) => !p.uploaded).length;
    wrap.append(h('p', { class: 'lead', text: totalPh + (totalPh === 1 ? ' foto nueva' : ' fotos nuevas') + ' para enviar.' }));
    if (!navigator.onLine) wrap.append(h('div', { class: 'note', text: 'Ahora no hay cobertura. Al pulsar Enviar se guarda en el móvil y se envía solo cuando vuelva la conexión.' }));
    if (!state.apiKey) wrap.append(h('div', { class: 'note', text: 'Falta la clave de acceso. El registro quedará pendiente hasta que la añadas en Ajustes.' }));
    return wrap;
  }

  function reviewRow(ic, title, sub, bad, step) {
    const row = h('div', { class: 'review-row' + (bad ? ' bad' : '') }, icon(ic), h('div', {}, h('b', { text: title }), h('span', { text: sub })));
    if (step !== undefined && step >= 0) row.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => goStep(step) }, 'Editar'));
    return row;
  }

  async function submit() {
    const missing = collectMissing();
    if (missing.length) {
      state.showErrors = true;
      toast(missing.length === 1 ? 'Falta 1 dato obligatorio' : 'Faltan ' + missing.length + ' datos obligatorios', true);
      renderStep();
      return;
    }
    const r = state.rec;
    stopGPS();
    r.status = 'pending';
    r.submittedAt = Date.now();
    r.featureUpdated = false;
    r.lastError = null;
    state.dirty = true;
    await saveNow();
    try { if (r.values.ID_instalador) await DB.kvSet('remember_ID_instalador', r.values.ID_instalador); } catch (e) { /* nada */ }
    state.rec = null;
    destroyMap();
    showView('home');
    toast(navigator.onLine && state.apiKey ? 'Enviando…' : 'Guardado. Se enviará cuando haya conexión.');
    runSync(true);
  }

  /* ================= ajustes ================= */
  async function openSettings() {
    $('#set-key').value = state.apiKey || '';
    $('#set-key').type = 'password';
    $('#set-url').value = (await DB.kvGet('serviceUrl')) || CFG.serviceUrl;
    showView('settings');
    renderStats();
    const layer = await DB.kvGet('layer');
    if (layer && layer.info) renderDiag(AGOL.buildSchema(layer.info), layer, null, true);
    else $('#diag').replaceChildren();
  }

  async function testConnection() {
    const key = $('#set-key').value.trim();
    const url = $('#set-url').value.trim() || CFG.serviceUrl;
    await DB.kvSet('apiKey', key);
    await DB.kvSet('serviceUrl', url);
    state.apiKey = key;
    const diag = $('#diag');
    if (!key) { diag.replaceChildren(h('p', { class: 'ko', text: 'Escribe la clave de acceso.' })); return; }
    diag.replaceChildren(h('p', { text: 'Comprobando…' }));
    try {
      const layer = await Sync.getLayer(key, true);
      state.schema = AGOL.buildSchema(layer.info);
      renderDiag(state.schema, layer, null, false);
      runSync(true);
    } catch (e) {
      const msg = e.kind === 'auth' ? 'La clave no es válida, ha caducado o no tiene acceso a esta capa. (' + e.message + ')'
        : e.kind === 'net' ? 'Sin conexión con ArcGIS Online.' : e.message;
      diag.replaceChildren(h('p', { class: 'ko', text: msg }));
    }
  }

  function renderDiag(schema, layer, err, cached) {
    const d = AGOL.diagnose(schema, FORM);
    const yes = (b, t1, t2) => h('dd', { class: b ? 'ok' : 'ko', text: b ? t1 || 'Sí' : t2 || 'No' });
    const total = d.matched.length + d.missing.length;
    const kv = h('dl', { class: 'kv' },
      h('dt', { text: 'Capa' }), h('dd', { text: schema.name + (cached ? ' (última comprobación)' : '') }),
      h('dt', { text: 'Geometría' }), schema.geometryType === 'esriGeometryPoint' ? yes(true, 'Puntos') : yes(false, '', schema.geometryType),
      h('dt', { text: 'Crear registros' }), yes(schema.canCreate),
      h('dt', { text: 'Editar registros' }), CFG.editMode === 'off' ? h('dd', { class: 'wn', text: 'Desactivado en la configuración de la app' }) : yes(schema.canUpdate, 'Activado (la capa permite Update)', 'Desactivado en AGOL'),
      h('dt', { text: 'Adjuntos (fotos)' }), yes(schema.hasAttachments, 'Habilitados', 'Deshabilitados: las fotos no se podrán subir'),
      h('dt', { text: 'Altas sin duplicados' }), yes(schema.supportsGlobalIds && !!schema.gidField, 'Sí (GlobalID)', 'No: un corte a mitad de envío podría duplicar'),
      h('dt', { text: 'Campos' }), h('dd', { class: d.missing.length ? 'wn' : 'ok', text: d.matched.length + ' de ' + total + ' campos del formulario existen en la capa' }));
    const out = [kv];
    if (d.missing.length) out.push(h('details', {}, h('summary', { text: 'No existen en la capa (no se guardarán): ' + d.missing.length }), h('p', { class: 'diag-list', text: d.missing.join(', ') })));
    if (d.typeIssues.length) out.push(h('details', {}, h('summary', { text: 'Tipos distintos a lo esperado: ' + d.typeIssues.length }), h('p', { class: 'diag-list', text: d.typeIssues.join(', ') })));
    if (d.requiredNotInForm.length) out.push(h('p', { class: 'ko', text: 'La capa exige campos que el formulario no tiene: ' + d.requiredNotInForm.join(', ') + '. Las altas fallarán.' }));
    $('#diag').replaceChildren(...out);
  }

  async function renderStats() {
    const recs = await DB.all('records');
    const photos = await DB.all('photos');
    const by = (s) => recs.filter((r) => r.status === s).length;
    const pend = photos.filter((p) => !p.uploaded && p.blob);
    const pendMB = pend.reduce((a, p) => a + (p.blob.size || 0), 0) / 1048576;
    const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
    let tiles = 0;
    try { tiles = (await (await caches.open(TILES_CACHE)).keys()).length; } catch (e) { /* sin caché */ }
    let total = '—', detail = '';
    try {
      const est = await navigator.storage.estimate();
      total = mb(est.usage);
      const u = est.usageDetails;
      if (u) detail = 'Datos (registros y fotos) ' + mb(u.indexedDB || 0) + ' · Caché (app y mapa) ' + mb(u.caches || 0);
    } catch (e) { /* nada */ }
    $('#local-stats').replaceChildren(
      h('dt', { text: 'Borradores' }), h('dd', { text: by('draft') }),
      h('dt', { text: 'Por enviar' }), h('dd', { text: by('pending') + by('syncing') + by('error') }),
      h('dt', { text: 'Enviados' }), h('dd', { text: by('synced') }),
      h('dt', { text: 'Fotos sin subir' }), h('dd', { text: pend.length + ' (' + pendMB.toFixed(1) + ' MB)' }),
      h('dt', { text: 'Mapa sin conexión' }), h('dd', { text: tiles + ' teselas guardadas' }),
      h('dt', { text: 'Espacio total' }), h('dd', { text: total }),
      detail ? h('dt', { text: 'Reparto' }) : null, detail ? h('dd', { text: detail }) : null);
  }

  async function clearTiles() {
    const ok = await confirmSheet('¿Vaciar el mapa guardado?', 'Se borran las teselas del mapa base guardadas para trabajar sin conexión. Se vuelven a descargar al usar el mapa con cobertura. Los registros y las fotos no se tocan.', 'Vaciar', false);
    if (!ok) return;
    try { for (const k of await caches.keys()) if (/^tiles-/.test(k)) await caches.delete(k); } catch (e) { /* nada */ }
    toast('Mapa guardado vaciado');
    renderStats();
  }

  async function clearSent() {
    const recs = (await DB.all('records')).filter((r) => r.status === 'synced');
    if (!recs.length) return toast('No hay registros enviados en el móvil');
    const ok = await confirmSheet('¿Borrar los enviados?', 'Se quitan ' + recs.length + ' registros ya enviados de este móvil. En ArcGIS Online siguen intactos.', 'Borrar', true);
    if (!ok) return;
    for (const r of recs) await deleteLocal(r.localId);
    toast('Enviados borrados del móvil');
    renderStats();
  }

  async function clearAll() {
    const recs = await DB.all('records');
    const unsent = recs.filter((r) => r.status !== 'synced').length;
    const ok = await confirmSheet('¿Borrar todos los datos del móvil?', unsent
      ? 'Hay ' + unsent + ' registros sin enviar. Se perderán con sus fotos. La clave de acceso se conserva.'
      : 'Todos los registros están enviados. La clave de acceso se conserva.', 'Borrar todo', true);
    if (!ok) return;
    await DB.clear('records');
    await DB.clear('photos');
    toast('Datos del móvil borrados');
    renderStats();
  }

  /* ================= utilidades de interfaz ================= */
  function confirmSheet(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      const sheet = $('#sheet');
      $('#sheet-title').textContent = title;
      $('#sheet-text').textContent = text;
      const ok = $('#sheet-ok');
      ok.textContent = okLabel || 'Aceptar';
      ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      sheet.hidden = false;
      const done = (v) => { sheet.hidden = true; ok.onclick = null; $('#sheet-cancel').onclick = null; sheet.onclick = null; resolve(v); };
      ok.onclick = () => done(true);
      $('#sheet-cancel').onclick = () => done(false);
      sheet.onclick = (e) => { if (e.target === sheet) done(false); };
    });
  }

  let toastTimer = null;
  function toast(text, isErr, ms) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('err', !!isErr);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3000);
  }

  // Expuesto solo para pruebas automáticas.
  self.__app = { state, renderHome, runSync };

  init();
})();
