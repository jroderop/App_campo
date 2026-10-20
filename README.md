# Instalaciones RUTE · v0.1 (prueba)

App web instalable (PWA) para registrar instalaciones en campo y enviarlas a un hosted feature layer de ArcGIS Online. Sustituye al formulario Survey123 «Instalaciones RUTE» para trabajadores externos: solo ve y escribe en la capa que tenga configurada.

## Qué hace

| Requisito | Cómo lo resuelve |
|---|---|
| 1. Instalable en móvil o tablet | PWA: se abre en Chrome (Android) o Safari (iOS) y se añade a la pantalla de inicio. Sin tiendas ni APK. |
| 2. Acceso a un único proyecto | Cada copia de la app apunta a un solo servicio (`js/config.js`) y usa una API key limitada a ese elemento. |
| 3. Ubicación | GPS del dispositivo con precisión en metros. Si no es suficiente, se mueve el mapa hasta dejar la cruz sobre el punto. Muestra también ETRS89 UTM 30N. |
| 4. Formulario | Campos del XLSForm. Primero se eligen los equipos instalados y solo aparecen sus apartados. |
| 5. Fotos como adjuntos | Cámara o galería. Se reducen a 1920 px en el móvil y se suben como adjuntos con `keywords` = nombre de la pregunta (igual que Survey123). |
| 6. Sin conexión | Todo se guarda en el móvil. El envío es automático al volver la cobertura. En Android (Chrome) también con la app cerrada (Background Sync). |
| 7. Editar registros enviados | Pestaña «En el servidor». Se activa sola si la capa tiene la capacidad **Update** en AGOL; si la quitas, desaparece. `editMode: 'off'` en `config.js` la anula siempre. |
| 8. Enviar | Paso «Revisar y enviar» con la lista de lo que falta. |
| 9. Feature class | Escribe directamente en la capa de puntos del servicio configurado. |

Además: borradores automáticos, lector de códigos de barras/QR para números de serie, recuerda el ID del instalador, diagnóstico de compatibilidad formulario ↔ capa en Ajustes.

## 1. Preparar la capa en ArcGIS Online

1. **Campos.** La app envía cada dato al campo de la capa con el mismo nombre que en el XLSForm (sin distinguir mayúsculas). Si la capa se publicó desde ese XLSForm con Survey123, ya los tiene. Los que no existan se ignoran y la app lo avisa.
2. **Adjuntos habilitados** (Settings › Attachments). Sin esto no se suben fotos.
3. **Edición:** permitir *Add*. Para la edición de registros (req. 7), permitir también *Update*.
4. **Opcional:** añadir `gps_precision` (Double) y `origen_ubicacion` (String, 20). Si existen, la app guarda la precisión del GPS y si el punto es GPS o manual.
5. **Recomendado para producción:** crear una **vista** de la capa por proyecto y apuntar la app a la vista. Así el toggle de Update se hace en la vista sin tocar la capa principal.

## 2. Crear la clave de acceso (API key)

Con la cuenta Creator, en ArcGIS Online:

1. Contenido › Nuevo elemento › Credenciales de desarrollador › Credenciales de clave de API.
2. Privilegios: solo los de edición de entidades.
3. Acceso a elementos: **solo** la capa (o vista) del proyecto.
4. Caducidad corta (p. ej. 30 días) y generar la clave.

La clave se escribe en el móvil, en Ajustes. **No la pongas en `config.js`** ni la envíes por correo o chat.

## 3. Publicarla con HTTPS

GPS, cámara y modo sin conexión solo funcionan con HTTPS. Cualquier hosting estático sirve. Lo más rápido:

- **GitHub Pages:** repositorio nuevo › subir el contenido de esta carpeta › Settings › Pages › Branch `main` / raíz. Queda en `https://<usuario>.github.io/<repo>/`.
- **Netlify Drop** (app.netlify.com/drop): arrastrar la carpeta.
- Servidor web de la empresa, en una ruta con certificado.

Prueba rápida solo en el PC (sin móvil): `python -m http.server 8000` dentro de la carpeta y abrir `http://localhost:8000`.

## 4. Instalar en el móvil

- **Android (Chrome):** abrir la URL › menú ⋮ › *Instalar aplicación* (o *Añadir a pantalla de inicio*).
- **iOS (Safari):** abrir la URL › Compartir › *Añadir a pantalla de inicio*.

Primer uso: Ajustes › pegar la clave › **Guardar y probar**. El diagnóstico dice si la capa tiene adjuntos, si permite crear y editar, y qué campos del formulario no encuentra.

## Limitaciones de esta versión

- **La clave queda guardada en el móvil.** Cualquiera con el móvil desbloqueado puede usarla. Para producción, el plan es un servidor intermedio (token broker) que dé tokens de corta duración por usuario y proyecto.
- **El toggle de edición lo aplica la app, no el servidor.** Si el privilegio de la API key es «editar con control total», ArcGIS permite actualizar aunque la capa no tenga Update. Quien usara la clave fuera de la app podría editar.
- **Envío en segundo plano con la app cerrada:** solo Chrome en Android. En iOS se envía al abrir la app o al recuperar conexión con la app abierta.
- **Mapa sin conexión:** solo las zonas ya vistas con cobertura (hasta 2000 teselas en caché; se pueden vaciar en Ajustes). El GPS funciona igual sin mapa.
- **Mapas base** (desplegable sobre el mapa, el móvil recuerda el último): Ortofoto combinada (Esri hasta zoom 17, PNOA desde 18; umbral en `orthoSwitchZoom`), Ortofoto PNOA, Ortofoto Esri, Híbrido (PNOA + rótulos IGN), Callejero Esri y Callejero gris IGN. Las capas de Esri usan las teselas públicas sin clave: válido para la prueba; en producción conviene pasarlas por la API key. Las del IGN son CC BY 4.0 y se citan en el mapa.
- **Gateways:** en el XLSForm las fotos iban en grupos de repetición (tablas relacionadas). Aquí se guardan como varios adjuntos del registro con su keyword.
- No se pueden borrar desde la app fotos que ya están en el servidor.

## Incoherencias encontradas en el XLSForm original

- En *Dosificador de cloro*, la foto se llama `Foto_fin_PLACA`, igual que en *Placa solar*. Aquí se ha renombrado a `Foto_fin_DOSIF`.
- `EndDate_GTW` es de tipo `time` (solo hora) y el resto de fechas de fin son `dateTime`.
- *Población* tiene una sola opción (RUTE). La app la marca sola.

## Para otro proyecto

Copiar la carpeta y cambiar:

- `js/config.js`: `appName`, `project`, `serviceUrl`, `itemId`, `mapCenter`.
- `js/form-schema.js`: secciones y campos.
- `manifest.webmanifest`: `name`.
- `sw.js`: subir `VERSION` cada vez que se publique un cambio, para que los móviles descarguen la versión nueva.

## Archivos

```
index.html            estructura de la app
css/app.css           estilos (paleta #001c1c / #80FFC8 / #FAD05C)
js/config.js          configuración del proyecto
js/form-schema.js     formulario traducido del XLSForm
js/agol.js            REST de ArcGIS y traducción de campos
js/sync.js            cola de envío (página y service worker)
js/db.js              almacenamiento local (IndexedDB)
js/app.js             interfaz
js/basemaps.js        catálogo de mapas base (Esri e IGN)
js/geo.js, photos.js, scanner.js   UTM, compresión de fotos, códigos de barras
sw.js                 modo sin conexión y envío en segundo plano
vendor/               Leaflet 1.9.4, ZXing 0.21.3 y fuentes (licencias incluidas)
```
