/* Catálogo de mapas base. Cada mapa base es una o varias capas de teselas XYZ superpuestas. */
(function (g) {
  const CFG = g.APP_CONFIG;
  const SW = CFG.orthoSwitchZoom || 18;

  const ESRI = (svc) => 'https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/{z}/{y}/{x}';
  const IGN = (svc, layer, fmt) => 'https://www.ign.es/wmts/' + svc + '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer +
    '&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=' + fmt;

  const ATT_ESRI_IMG = 'Esri, Maxar, Earthstar Geographics';
  const ATT_ESRI_ST = 'Esri, HERE, Garmin, OSM';
  const ATT_PNOA = 'PNOA cedido por © Instituto Geográfico Nacional';
  const ATT_IGN = '© Instituto Geográfico Nacional';

  const esriImg = (extra) => Object.assign({ url: ESRI('World_Imagery'), maxNativeZoom: 19, attribution: ATT_ESRI_IMG }, extra);
  const pnoa = (extra) => Object.assign({ url: IGN('pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg'), maxNativeZoom: 20, attribution: ATT_PNOA }, extra);

  g.BASEMAPS = [
    { id: 'orto-combinada', label: 'Ortofoto combinada', desc: 'Esri de lejos, PNOA al acercarte',
      layers: [esriImg({ maxZoom: SW - 1 }), pnoa({ minZoom: SW })] },
    { id: 'orto-pnoa', label: 'Ortofoto PNOA', desc: 'IGN · más detalle de cerca', layers: [pnoa()] },
    { id: 'orto-esri', label: 'Ortofoto Esri', desc: 'World Imagery · mejor de lejos', layers: [esriImg()] },
    { id: 'hibrido', label: 'Híbrido', desc: 'PNOA con calles y nombres del IGN',
      layers: [pnoa(), { url: IGN('ign-base', 'IGNBaseOrto', 'image/png'), maxNativeZoom: 20, attribution: ATT_IGN }] },
    { id: 'calle-esri', label: 'Callejero Esri', desc: 'World Street Map',
      layers: [{ url: ESRI('World_Street_Map'), maxNativeZoom: 19, attribution: ATT_ESRI_ST }] },
    { id: 'calle-ign', label: 'Callejero gris IGN', desc: 'Limpio para ver los puntos encima',
      layers: [{ url: IGN('ign-base', 'IGNBase-gris', 'image/jpeg'), maxNativeZoom: 20, attribution: ATT_IGN }] }
  ];
})(self);
