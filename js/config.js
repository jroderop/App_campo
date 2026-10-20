/* Configuración del proyecto. Una copia de la app por proyecto: cambia estos valores. */
self.APP_CONFIG = {
  version: '0.1.1',
  appName: 'Instalaciones RUTE',
  project: 'RUTE',

  // Feature service de destino. Puede ser la URL del servicio (.../FeatureServer)
  // o la de una capa concreta (.../FeatureServer/0).
  serviceUrl: 'https://services-eu1.arcgis.com/Aha5baNZi8JV5BWj/arcgis/rest/services/Test_app/FeatureServer',
  itemId: '6cf1d28ad72f40d798bff36f04d8406d',
  layerId: null, // null = primera capa de puntos del servicio

  // Edición de registros ya enviados:
  //  'auto' -> se activa solo si la capa (o la vista) tiene la capacidad "Update" en AGOL.
  //            El administrador la enciende o apaga desde la configuración de edición de la capa.
  //  'off'  -> siempre desactivada, tenga la capa lo que tenga
  editMode: 'auto',

  // Mapa
  mapCenter: [37.3268, -4.3683], // Rute (Córdoba)
  mapZoom: 15,

  // Fotos
  photoMaxSide: 1920,
  photoQuality: 0.82,

  // GPS: precisión objetivo (m). Por debajo se fija la posición automáticamente.
  gpsTargetAccuracy: 5,

  // Sincronización automática mientras la app está abierta
  syncIntervalMs: 60000,

  // Campos auxiliares opcionales. Se rellenan solo si existen en la capa (sin distinguir mayúsculas).
  metaFields: {
    gpsAccuracy: ['gps_precision', 'precision_gps', 'gps_accuracy'],
    locSource: ['origen_ubicacion', 'gps_origen'],
    appSource: ['app_origen']
  }
};
