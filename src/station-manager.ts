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
  /** Estimated residents aged 16-24. */
  youth: number;
  /** Youth share of total population (0-100). */
  youthPct: number;
  /** Estimated residents aged 65+. */
  elderly: number;
  /** Elderly share of total population (0-100). */
  elderlyPct: number;
  /** Population density of the catchment (pop / ha). */
  densityPerHa: number;
  /** Estimated households within catchment. */
  households: number;
  /** Households with no car or van. */
  noCarHouseholds: number;
  /** No-car share of households (0-100). */
  noCarPct: number;
  /** Commuters using rail. */
  trainCommuters: number;
  /** Rail commute share of all commuters (0-100). */
  trainCommutersPct: number;
  /** Commuters using bus or coach. */
  busCommuters: number;
  /** Bus commute share of all commuters (0-100). */
  busCommutersPct: number;
  /** Commuters driving a car or van. */
  driveCommuters: number;
  /** Drive share of all commuters (0-100). */
  driveCommutersPct: number;
  /** Total commuters in the catchment. */
  commutersTotal: number;
  /** Economically active residents. */
  economicallyActive: number;
  /** Economically active share of residents aged 16+ (0-100). */
  economicallyActivePct: number;
  /** Households renting. */
  renters: number;
  /** Renting share of households (0-100). */
  rentersPct: number;
  /** Residents reporting activity limitation. */
  disabled: number;
  /** Disability share of total population (0-100). */
  disabledPct: number;
  /** Number of LSOAs contributing to the catchment. */
  lsoaCount: number;
}

interface LsoaFeature {
  geometry: { type: string; coordinates: unknown };
  properties: {
    code: string;
    name: string;
    area_ha: number;
    pop: number;
    work_pop: number;
    youth?: number;
    elderly?: number;
    households?: number;
    no_car?: number;
    travel_train?: number;
    travel_bus?: number;
    travel_drive?: number;
    travel_total?: number;
    econ_active?: number;
    econ_total?: number;
    renters?: number;
    disabled?: number;
  };
}

type CatchmentAccumulator = {
  population: number;
  workingAge: number;
  youth: number;
  elderly: number;
  totalAreaHa: number;
  households: number;
  noCarHouseholds: number;
  trainCommuters: number;
  busCommuters: number;
  driveCommuters: number;
  commutersTotal: number;
  economicallyActive: number;
  economicallyActiveTotal: number;
  renters: number;
  disabled: number;
  lsoaCount: number;
};

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

function safePct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round(((numerator / denominator) * 100) * 10) / 10 : 0;
}

function emptyCatchmentStats(): CatchmentStats {
  return {
    population: 0,
    workingAge: 0,
    workingAgePct: 0,
    youth: 0,
    youthPct: 0,
    elderly: 0,
    elderlyPct: 0,
    densityPerHa: 0,
    households: 0,
    noCarHouseholds: 0,
    noCarPct: 0,
    trainCommuters: 0,
    trainCommutersPct: 0,
    busCommuters: 0,
    busCommutersPct: 0,
    driveCommuters: 0,
    driveCommutersPct: 0,
    commutersTotal: 0,
    economicallyActive: 0,
    economicallyActivePct: 0,
    renters: 0,
    rentersPct: 0,
    disabled: 0,
    disabledPct: 0,
    lsoaCount: 0,
  };
}

function finalizeCatchmentStats(acc: CatchmentAccumulator): CatchmentStats {
  const densityPerHa = acc.totalAreaHa > 0 ? acc.population / acc.totalAreaHa : 0;

  return {
    population: acc.population,
    workingAge: acc.workingAge,
    workingAgePct: safePct(acc.workingAge, acc.population),
    youth: acc.youth,
    youthPct: safePct(acc.youth, acc.population),
    elderly: acc.elderly,
    elderlyPct: safePct(acc.elderly, acc.population),
    densityPerHa: Math.round(densityPerHa * 10) / 10,
    households: acc.households,
    noCarHouseholds: acc.noCarHouseholds,
    noCarPct: safePct(acc.noCarHouseholds, acc.households),
    trainCommuters: acc.trainCommuters,
    trainCommutersPct: safePct(acc.trainCommuters, acc.commutersTotal),
    busCommuters: acc.busCommuters,
    busCommutersPct: safePct(acc.busCommuters, acc.commutersTotal),
    driveCommuters: acc.driveCommuters,
    driveCommutersPct: safePct(acc.driveCommuters, acc.commutersTotal),
    commutersTotal: acc.commutersTotal,
    economicallyActive: acc.economicallyActive,
    economicallyActivePct: safePct(acc.economicallyActive, acc.economicallyActiveTotal),
    renters: acc.renters,
    rentersPct: safePct(acc.renters, acc.households),
    disabled: acc.disabled,
    disabledPct: safePct(acc.disabled, acc.population),
    lsoaCount: acc.lsoaCount,
  };
}

function accumulateFeature(acc: CatchmentAccumulator, feature: LsoaFeature): void {
  const p = feature.properties;
  acc.population += p.pop ?? 0;
  acc.workingAge += p.work_pop ?? 0;
  acc.youth += p.youth ?? 0;
  acc.elderly += p.elderly ?? 0;
  acc.totalAreaHa += p.area_ha ?? 0;
  acc.households += p.households ?? 0;
  acc.noCarHouseholds += p.no_car ?? 0;
  acc.trainCommuters += p.travel_train ?? 0;
  acc.busCommuters += p.travel_bus ?? 0;
  acc.driveCommuters += p.travel_drive ?? 0;
  acc.commutersTotal += p.travel_total ?? 0;
  acc.economicallyActive += p.econ_active ?? 0;
  acc.economicallyActiveTotal += p.econ_total ?? 0;
  acc.renters += p.renters ?? 0;
  acc.disabled += p.disabled ?? 0;
  acc.lsoaCount += 1;
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

  const acc: CatchmentAccumulator = {
    population: 0,
    workingAge: 0,
    youth: 0,
    elderly: 0,
    totalAreaHa: 0,
    households: 0,
    noCarHouseholds: 0,
    trainCommuters: 0,
    busCommuters: 0,
    driveCommuters: 0,
    commutersTotal: 0,
    economicallyActive: 0,
    economicallyActiveTotal: 0,
    renters: 0,
    disabled: 0,
    lsoaCount: 0,
  };

  for (const f of features) {
    const p = f.properties;
    if (!p || typeof p.pop !== 'number') continue;
    const [cLng, cLat] = featureCentroid(f);
    if (haversineKm(lng, lat, cLng, cLat) <= CATCHMENT_KM) {
      accumulateFeature(acc, f);
    }
  }

  return finalizeCatchmentStats(acc);
}

/**
 * Compute aggregated catchment statistics across all stops on a line.
 * LSOAs are deduplicated so overlapping catchment areas aren't double-counted.
 */
export async function fetchLineCatchmentStats(
  stations: Array<{ lng: number; lat: number }>,
): Promise<CatchmentStats> {
  if (stations.length === 0) {
    return emptyCatchmentStats();
  }

  const features = await loadLsoa();
  const seen = new Set<string>();
  const acc: CatchmentAccumulator = {
    population: 0,
    workingAge: 0,
    youth: 0,
    elderly: 0,
    totalAreaHa: 0,
    households: 0,
    noCarHouseholds: 0,
    trainCommuters: 0,
    busCommuters: 0,
    driveCommuters: 0,
    commutersTotal: 0,
    economicallyActive: 0,
    economicallyActiveTotal: 0,
    renters: 0,
    disabled: 0,
    lsoaCount: 0,
  };

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
      accumulateFeature(acc, f);
    }
  }

  return finalizeCatchmentStats(acc);
}
