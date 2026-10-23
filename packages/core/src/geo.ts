import type { DeliveryZone, LatLng } from "./types";

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ray casting: ponto dentro do polígono (lat,lng). */
export function pointInPolygon(p: LatLng, poly: LatLng[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    const hit = (yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Primeira zona ativa que contém o endereço (ordem do cadastro = prioridade). */
export function resolveZone(zones: DeliveryZone[], point: LatLng, storePoint?: LatLng): DeliveryZone | undefined {
  return zones.find((z) => z.active && (z.kind === "polygon" ? !!z.polygon && z.polygon.length > 2 && pointInPolygon(point, z.polygon) : !!storePoint && haversineKm(storePoint, point) <= (z.radiusKm || 0)));
}
