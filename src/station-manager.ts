// ── Station Manager ───────────────────────────────────────────────────────────
// Queries LSOA census data for a station's catchment area and returns
// aggregated statistics. The GeoJSON is fetched once and cached.

const LSOA_URL = '/data/lsoa_boundaries.geojson';
const CATCHMENT_KM = 1.2; // radius in kilometres

export interface CatchmentStats {
  /** Estimated total residents within catchment. */
  population: number;
  /** Estimated working-age (16–64) residents. */
  workingAge: number;
  /** Working-age as a % of total (0–100). */
  workingAgePct: number;
  /** Population density of the catchment (pop / ha). */
  densityPerHa: number;
  /** Number of LSOAs contributing to the catchment. */
  lsoaCount: number;
}

interface LsoaFeature {
  geometry: { type: string; coordinates: unknown };
  properties: { code: string; name: string; area_ha: number; pop: number; work_pop: number };
}

// Singleton cache
let _geojsonPromise: Promise<LsoaFeature[]> | null = null;

function loadLsoa(): Promise<LsoaFeature[]> {
  if (!_geojsonPromise) {
    _geojsonPromise = fetch(LSOA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`LSOA fetch failed: ${r.status}`);
        return r.json();
      })
      .then((gj) => (gj as { features: LsoaFeature[] }).features)
      .catch((err) => {
        // Reset so a later attempt can retry
        _geojsonPromise = null;
        throw err;
      });
  }
  return _geojsonPromise;
}

/** Haversine distance in kilometres between two WGS-84 points. */
function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute the centroid of a polygon or multipolygon ring list. */
function ringCentroid(coords: number[][][]): [number, number] {
  let sumLng = 0, sumLat = 0, n = 0;
  for (const ring of coords) {
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
      n++;
    }
  }
  return [sumLng / n, sumLat / n];
}

function featureCentroid(feature: LsoaFeature): [number, number] {
  const geom = feature.geometry as { type: string; coordinates: unknown };
  if (geom.type === 'Polygon') {
    return ringCentroid(geom.coordinates as number[][][]);
  }
  if (geom.type === 'MultiPolygon') {
    // Use the first polygon's centroid as a reasonable approximation
    return ringCentroid((geom.coordinates as number[][][][])[0]);
  }
  return [0, 0];
}

/**
 * Pre-warm the LSOA cache. Call early so data is ready when a station is
 * selected. Safe to call multiple times.
 */
export function preloadLsoa(): void {
  loadLsoa().catch(() => { /* silently ignore — will retry on next call */ });
}

/**
 * Compute catchment statistics for a station at the given coordinates.
 * Finds all LSOAs whose centroid is within CATCHMENT_KM of the station.
 */
export async function fetchCatchmentStats(
  lng: number,
  lat: number,
): Promise<CatchmentStats> {
  const features = await loadLsoa();

  let totalPop = 0;
  let totalWorkPop = 0;
  let totalAreaHa = 0;
  let count = 0;

  for (const f of features) {
    const p = f.properties;
    if (!p || typeof p.pop !== 'number') continue;
    const [cLng, cLat] = featureCentroid(f);
    if (haversineKm(lng, lat, cLng, cLat) <= CATCHMENT_KM) {
      totalPop     += p.pop;
      totalWorkPop += p.work_pop ?? 0;
      totalAreaHa  += p.area_ha ?? 0;
      count++;
    }
  }

  const workingAgePct = totalPop > 0 ? (totalWorkPop / totalPop) * 100 : 0;
  const densityPerHa  = totalAreaHa > 0 ? totalPop / totalAreaHa : 0;

  return {
    population:    totalPop,
    workingAge:    totalWorkPop,
    workingAgePct: Math.round(workingAgePct * 10) / 10,
    densityPerHa:  Math.round(densityPerHa * 10) / 10,
    lsoaCount:     count,
  };
}

/**
 * Compute aggregated catchment statistics across all stops on a line.
 * LSOAs are deduplicated so overlapping catchment areas aren't double-counted.
 */
export async function fetchLineCatchmentStats(
  stations: Array<{ lng: number; lat: number }>,
): Promise<CatchmentStats> {
  if (stations.length === 0) {
    return { population: 0, workingAge: 0, workingAgePct: 0, densityPerHa: 0, lsoaCount: 0 };
  }

  const features = await loadLsoa();
  const seen = new Set<string>();
  let totalPop = 0;
  let totalWorkPop = 0;
  let totalAreaHa = 0;
  let count = 0;

  for (const f of features) {
    const p = f.properties;
    if (!p || typeof p.pop !== 'number') continue;
    if (seen.has(p.code)) continue;

    const [cLng, cLat] = featureCentroid(f);
    const inCatchment = stations.some(
      (s) => haversineKm(s.lng, s.lat, cLng, cLat) <= CATCHMENT_KM,
    );

    if (inCatchment) {
      seen.add(p.code);
      totalPop     += p.pop;
      totalWorkPop += p.work_pop ?? 0;
      totalAreaHa  += p.area_ha ?? 0;
      count++;
    }
  }

  const workingAgePct = totalPop > 0 ? (totalWorkPop / totalPop) * 100 : 0;
  const densityPerHa  = totalAreaHa > 0 ? totalPop / totalAreaHa : 0;

  return {
    population:    totalPop,
    workingAge:    totalWorkPop,
    workingAgePct: Math.round(workingAgePct * 10) / 10,
    densityPerHa:  Math.round(densityPerHa * 10) / 10,
    lsoaCount:     count,
  };
}
