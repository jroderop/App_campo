/* Utilidades de coordenadas. ETRS89 y WGS84 difieren menos de 1 m en España: se tratan como iguales. */
(function (g) {
  const Geo = {};

  /* Lat/lon (grados) -> UTM. Zona automática salvo que se fuerce. Devuelve { zone, x, y }. */
  Geo.toUTM = function (lat, lon, forceZone) {
    const a = 6378137.0, f = 1 / 298.257222101; // GRS80
    const k0 = 0.9996;
    const zone = forceZone || Math.floor((lon + 180) / 6) + 1;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
    const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) y += 10000000;
    return { zone, x, y };
  };

  Geo.fmtLatLon = (lat, lon) => lat.toFixed(6) + ', ' + lon.toFixed(6);

  g.Geo = Geo;
})(self);
