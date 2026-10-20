/* Acceso a la REST API de ArcGIS Online y traducción formulario <-> atributos de la capa.
 * Sin dependencias: lo usan la página y el service worker. El token va siempre en el cuerpo
 * del POST o en cabecera, nunca en la URL.
 */
(function (g) {
  const AGOL = {};

  function makeError(message, kind, code) {
    const e = new Error(message);
    e.kind = kind; // 'net' (reintentar), 'auth' (clave inválida o sin permisos), 'server' (datos rechazados)
    if (code !== undefined) e.code = code;
    return e;
  }
  AGOL.makeError = makeError;

  function toForm(params) {
    const f = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (typeof Blob !== 'undefined' && v instanceof Blob) f.append(k, v, v.name || 'foto.jpg');
      else f.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return f;
  }

  function classify(code) {
    if (code === 498 || code === 499 || code === 401 || code === 403) return 'auth';
    if (code >= 500) return 'net';
    return 'server';
  }

  async function post(url, params, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', body: toForm(Object.assign({ f: 'json' }, params)), signal: ctrl.signal });
    } catch (e) {
      throw makeError(e.name === 'AbortError' ? 'Tiempo de espera agotado' : 'Sin conexión con ArcGIS Online', 'net');
    } finally {
      clearTimeout(timer);
    }
    let json;
    try { json = await resp.json(); }
    catch (e) { throw makeError('Respuesta no válida del servidor (HTTP ' + resp.status + ')', resp.status >= 500 ? 'net' : 'server', resp.status); }
    if (json && json.error) {
      const c = Number(json.error.code);
      const det = (json.error.details || []).filter(Boolean).join(' ');
      throw makeError((json.error.message || 'Error del servidor') + (det ? ': ' + det : ''), classify(c), c);
    }
    return json;
  }
  AGOL.post = post;

  const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\?.*$/, '');

  /* Devuelve { url, info } de la capa de puntos a la que se escribe. */
  AGOL.resolveLayer = async function (serviceUrl, layerId, token) {
    const base = trimUrl(serviceUrl);
    if (/\/FeatureServer\/\d+$/i.test(base)) {
      const info = await post(base, { token });
      return { url: base, info };
    }
    if (!/\/FeatureServer$/i.test(base)) throw makeError('La URL debe terminar en /FeatureServer o /FeatureServer/<n>', 'server');
    const svc = await post(base, { token });
    const layers = svc.layers || [];
    let id = layerId;
    if (id === null || id === undefined) {
      const pt = layers.find((l) => l.geometryType === 'esriGeometryPoint');
      if (!pt) throw makeError('El servicio no tiene ninguna capa de puntos', 'server');
      id = pt.id;
    }
    const url = base + '/' + id;
    const info = await post(url, { token });
    return { url, info };
  };

  /* Resumen del esquema de la capa que necesita la app. */
  AGOL.buildSchema = function (info) {
    const fields = info.fields || [];
    const byLower = {};
    fields.forEach((f) => { byLower[f.name.toLowerCase()] = f; });
    const caps = new Set(String(info.capabilities || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const gid = info.globalIdField || (fields.find((f) => f.type === 'esriFieldTypeGlobalID') || {}).name || null;
    const oid = info.objectIdField || (fields.find((f) => f.type === 'esriFieldTypeOID') || {}).name || 'OBJECTID';
    return {
      name: info.name,
      geometryType: info.geometryType,
      fields, byLower, oidField: oid, gidField: gid,
      hasAttachments: !!info.hasAttachments,
      supportsGlobalIds: !!info.supportsApplyEditsWithGlobalIds,
      caps,
      canCreate: caps.has('create') || caps.has('editing'),
      canUpdate: caps.has('update'),
      canSync: caps.has('sync'),
      editFields: info.editFieldsInfo || null
    };
  };

  AGOL.field = (schema, name) => (schema && name ? schema.byLower[String(name).toLowerCase()] || null : null);

  /* ---------- fechas ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  AGOL.localDateTime = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  AGOL.localDate = (ms) => AGOL.localDateTime(ms).slice(0, 10);
  AGOL.localTime = (ms) => AGOL.localDateTime(ms).slice(11, 16);
  function isoWithOffset(d) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return AGOL.localDateTime(d.getTime()) + ':' + pad(d.getSeconds()) + sign + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }

  /* Valor del formulario -> valor del campo de la capa. Devuelve undefined si no se puede convertir. */
  function toFieldValue(formField, value, f) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
    const t = f.type;
    const ft = formField.type;
    let dateObj = null;
    if (ft === 'dateTime') dateObj = new Date(value);
    else if (ft === 'date') { const [y, m, d] = value.split('-').map(Number); dateObj = new Date(y, m - 1, d, 0, 0, 0); }
    else if (ft === 'time') { const [h, mi] = value.split(':').map(Number); dateObj = new Date(); dateObj.setHours(h, mi, 0, 0); }

    switch (t) {
      case 'esriFieldTypeString': {
        let s = Array.isArray(value) ? value.join(',') : String(value);
        if (ft === 'dateTime' && dateObj) s = isoWithOffset(dateObj);
        return f.length ? s.slice(0, f.length) : s;
      }
      case 'esriFieldTypeSmallInteger': case 'esriFieldTypeInteger': case 'esriFieldTypeBigInteger': {
        const n = parseInt(String(value).replace(',', '.'), 10); return isNaN(n) ? undefined : n;
      }
      case 'esriFieldTypeSingle': case 'esriFieldTypeDouble': {
        const n = parseFloat(String(value).replace(',', '.')); return isNaN(n) ? undefined : n;
      }
      case 'esriFieldTypeDate':
        return dateObj && !isNaN(dateObj) ? dateObj.getTime() : undefined;
      case 'esriFieldTypeDateOnly':
        return dateObj && !isNaN(dateObj) ? AGOL.localDate(dateObj.getTime()) : undefined;
      case 'esriFieldTypeTimeOnly':
        return dateObj && !isNaN(dateObj) ? AGOL.localTime(dateObj.getTime()) + ':00' : undefined;
      case 'esriFieldTypeTimestampOffset':
        return dateObj && !isNaN(dateObj) ? isoWithOffset(dateObj) : undefined;
      default:
        return undefined; // OID, GlobalID, GUID, Blob... no se escriben desde el formulario
    }
  }

  /* Valor de la capa -> valor del formulario (para editar). */
  function fromFieldValue(formField, raw, f) {
    if (raw === null || raw === undefined) return ft0(formField);
    const t = f.type;
    const ft = formField.type;
    if (ft === 'select_multiple') return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    if (t === 'esriFieldTypeDate') {
      if (ft === 'date') return AGOL.localDate(raw);
      if (ft === 'time') return AGOL.localTime(raw);
      return AGOL.localDateTime(raw);
    }
    if (t === 'esriFieldTypeDateOnly') return String(raw).slice(0, 10);
    if (t === 'esriFieldTypeTimeOnly') return String(raw).slice(0, 5);
    if (t === 'esriFieldTypeTimestampOffset' || (t === 'esriFieldTypeString' && ft === 'dateTime')) {
      const d = new Date(raw); return isNaN(d) ? '' : AGOL.localDateTime(d.getTime());
    }
    return String(raw);
  }
  function ft0(formField) { return formField.type === 'select_multiple' ? [] : ''; }

  function dataFields(form) {
    const out = [];
    form.sections.forEach((s) => s.fields.forEach((f) => { if (f.type !== 'image' && f.type !== 'geopoint') out.push(f); }));
    return out;
  }
  AGOL.dataFields = dataFields;

  function metaField(schema, candidates) {
    for (const c of candidates || []) { const f = AGOL.field(schema, c); if (f) return f; }
    return null;
  }

  /* Registro local -> atributos. mode 'add' omite vacíos; 'update' los envía como null para poder borrarlos. */
  AGOL.toAttributes = function (record, schema, form, config, mode) {
    const attributes = {};
    const unmatched = [];
    const invalid = [];
    for (const ff of dataFields(form)) {
      const f = AGOL.field(schema, ff.name);
      if (!f) { if (hasValue(record.values[ff.name])) unmatched.push(ff.name); continue; }
      if (f.editable === false) continue;
      const v = toFieldValue(ff, record.values[ff.name], f);
      if (v === undefined) { invalid.push(ff.name); continue; }
      if (v === null && mode === 'add') continue;
      attributes[f.name] = v;
    }
    const meta = (config && config.metaFields) || {};
    const loc = record.location || {};
    const fa = metaField(schema, meta.gpsAccuracy);
    if (fa && loc.accuracy != null) attributes[fa.name] = Math.round(loc.accuracy * 10) / 10;
    const fs = metaField(schema, meta.locSource);
    if (fs && loc.source) attributes[fs.name] = loc.source;
    const fp = metaField(schema, meta.appSource);
    if (fp) attributes[fp.name] = 'PWA ' + ((config && config.version) || '');
    return { attributes, unmatched, invalid };
  };

  function hasValue(v) { return !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)); }
  AGOL.hasValue = hasValue;

  AGOL.fromAttributes = function (attrs, schema, form) {
    const values = {};
    for (const ff of dataFields(form)) {
      const f = AGOL.field(schema, ff.name);
      values[ff.name] = f ? fromFieldValue(ff, attrs[f.name], f) : ft0(ff);
    }
    return values;
  };

  /* Opciones de un campo: dominio de la capa si existe, si no la lista del XLSForm. */
  AGOL.choices = function (formField, schema, form) {
    const f = AGOL.field(schema, formField.name);
    if (f && f.domain && f.domain.type === 'codedValue' && f.domain.codedValues && f.domain.codedValues.length) {
      return f.domain.codedValues.map((cv) => ({ name: String(cv.code), label: cv.name }));
    }
    return (form.lists[formField.list] || []).slice();
  };

  /* Diagnóstico de compatibilidad formulario <-> capa. */
  AGOL.diagnose = function (schema, form) {
    const matched = [], missing = [], typeIssues = [];
    for (const ff of dataFields(form)) {
      const f = AGOL.field(schema, ff.name);
      if (!f) { missing.push(ff.name); continue; }
      matched.push(ff.name);
      const okTypes = {
        text: ['esriFieldTypeString'], textarea: ['esriFieldTypeString'], barcode: ['esriFieldTypeString'],
        select_one: ['esriFieldTypeString', 'esriFieldTypeInteger', 'esriFieldTypeSmallInteger', 'esriFieldTypeDouble'],
        select_multiple: ['esriFieldTypeString'],
        integer: ['esriFieldTypeInteger', 'esriFieldTypeSmallInteger', 'esriFieldTypeBigInteger', 'esriFieldTypeDouble', 'esriFieldTypeString'],
        decimal: ['esriFieldTypeDouble', 'esriFieldTypeSingle', 'esriFieldTypeString'],
        dateTime: ['esriFieldTypeDate', 'esriFieldTypeTimestampOffset', 'esriFieldTypeString'],
        date: ['esriFieldTypeDate', 'esriFieldTypeDateOnly', 'esriFieldTypeString'],
        time: ['esriFieldTypeString', 'esriFieldTypeTimeOnly', 'esriFieldTypeDate']
      }[ff.type] || [];
      if (okTypes.length && okTypes.indexOf(f.type) === -1) typeIssues.push(ff.name + ' (' + f.type.replace('esriFieldType', '') + ')');
    }
    const formNames = new Set(dataFields(form).map((f) => f.name.toLowerCase()));
    const sys = new Set([schema.oidField, schema.gidField].filter(Boolean).map((s) => s.toLowerCase()));
    const ef = schema.editFields || {};
    ['creationDateField', 'creatorField', 'editDateField', 'editorField'].forEach((k) => { if (ef[k]) sys.add(ef[k].toLowerCase()); });
    const requiredNotInForm = schema.fields
      .filter((f) => f.nullable === false && f.editable !== false && !formNames.has(f.name.toLowerCase()) && !sys.has(f.name.toLowerCase()) && f.defaultValue == null)
      .map((f) => f.name);
    return { matched, missing, typeIssues, requiredNotInForm };
  };

  /* ---------- operaciones ---------- */
  AGOL.applyEdits = (layerUrl, edits, token) => post(layerUrl + '/applyEdits', {
    adds: edits.adds, updates: edits.updates, useGlobalIds: !!edits.useGlobalIds, rollbackOnFailure: true, token
  }, 90000);

  AGOL.query = (layerUrl, params, token) => post(layerUrl + '/query', Object.assign({ token }, params));

  AGOL.addAttachment = (layerUrl, oid, blob, keywords, token) =>
    post(layerUrl + '/' + oid + '/addAttachment', { attachment: blob, keywords: keywords || undefined, token }, 180000);

  AGOL.queryAttachments = (layerUrl, oids, token) =>
    post(layerUrl + '/queryAttachments', { objectIds: oids.join(','), returnMetadata: false, token });

  g.AGOL = AGOL;
})(self);
