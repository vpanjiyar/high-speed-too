import type { LatLon } from '../types';

// UK bounds (roughly)
export const UK_BOUNDS = {
  minLat: 49.9,
  maxLat: 58.7,
  minLon: -7.6,
  maxLon: 1.8,
};

/** Convert lat/lon to normalised [0..1] coordinates within UK bounds */
export function latLonToNorm(pos: LatLon): { x: number; y: number } {
  const x = (pos.lon - UK_BOUNDS.minLon) / (UK_BOUNDS.maxLon - UK_BOUNDS.minLon);
  const y = 1 - (pos.lat - UK_BOUNDS.minLat) / (UK_BOUNDS.maxLat - UK_BOUNDS.minLat); // flip Y
  return { x, y };
}

/** Convert normalised coords back to lat/lon */
export function normToLatLon(x: number, y: number): LatLon {
  return {
    lat: UK_BOUNDS.minLat + (1 - y) * (UK_BOUNDS.maxLat - UK_BOUNDS.minLat),
    lon: UK_BOUNDS.minLon + x * (UK_BOUNDS.maxLon - UK_BOUNDS.minLon),
  };
}

/** Haversine distance in metres between two lat/lon points */
export function haversineMetres(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Generate a unique ID */
export function uid(): string {
  return crypto.randomUUID();
}
