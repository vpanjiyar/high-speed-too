import type { CatchmentStats } from './station-manager';
import type { LineTrainStats, RollingStock } from './rolling-stock';

export type LinePopularityBand =
  | 'Low'
  | 'Emerging'
  | 'Moderate'
  | 'High'
  | 'Very High';

export interface LineDemandModel {
  estimatedPassengersPerHour: number;
  unconstrainedPassengersPerHour: number;
  suppliedCapacityPerHour: number;
  capacityUtilisationPct: number;
  popularityScore: number;
  popularityBand: LinePopularityBand;
  baseMarketPassengersPerHour: number;
  propensityFactor: number;
  serviceFactor: number;
  averageStopSpacingKm: number;
  averageOperatingSpeedKmh: number;
  averageWaitTimeMin: number;
  demandConstrainedByCapacity: boolean;
  catchment: {
    residents: number;
    workingAgePct: number;
    densityPerHa: number;
    noCarPct: number;
    trainCommutersPct: number;
    driveCommutersPct: number;
    economicallyActivePct: number;
    rentersPct: number;
  };
  service: {
    trainsPerHour: number;
    endToEndMin: number;
    averageWaitTimeMin: number;
    averageSpeedKmh: number;
    stopSpacingKm: number;
    stockFitFactor: number;
    frequencyFactor: number;
    speedFactor: number;
    spacingFactor: number;
  };
  summary: string;
  methodology: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getStockFitFactor(stock: RollingStock, averageStopSpacingKm: number): number {
  switch (stock.category) {
    case 'UK Metro':
      return clamp(1.12 - Math.max(0, averageStopSpacingKm - 1.6) * 0.07, 0.9, 1.12);
    case 'UK High Speed':
    case 'International High Speed':
      return clamp(0.9 + Math.max(0, averageStopSpacingKm - 4) * 0.045, 0.9, 1.14);
    case 'UK Commuter':
    default:
      return averageStopSpacingKm >= 1.8 && averageStopSpacingKm <= 7.5 ? 1.04 : 0.98;
  }
}

function getPopularityBand(score: number): LinePopularityBand {
  if (score >= 82) return 'Very High';
  if (score >= 66) return 'High';
  if (score >= 48) return 'Moderate';
  if (score >= 30) return 'Emerging';
  return 'Low';
}

function buildSummary(
  band: LinePopularityBand,
  estimatedPassengersPerHour: number,
  constrained: boolean,
  catchment: CatchmentStats,
  serviceFactor: number,
): string {
  const serviceTone = serviceFactor >= 1.1
    ? 'strong service quality'
    : serviceFactor >= 0.9
      ? 'service levels that are broadly competitive'
      : 'service levels that limit the market the route can capture';

  const demandTone = constrained
    ? 'Demand is currently capped by the line’s supplied carrying capacity.'
    : 'The current fleet size appears sufficient for the estimated peak-hour market.';

  return `${band} expected popularity, at roughly ${estimatedPassengersPerHour.toLocaleString('en-GB')} passengers per hour per direction. The estimate is driven by a ${catchment.population.toLocaleString('en-GB')} resident stop catchment, census-based rail propensity indicators, and ${serviceTone} ${demandTone}`;
}

export function estimateLineDemand(
  stats: LineTrainStats,
  catchment: CatchmentStats,
  stock: RollingStock,
  stationCount: number,
): LineDemandModel {
  const suppliedCapacityPerHour = Math.max(0, stats.passengersThroughput);
  const averageStopSpacingKm = stats.legDistances.length > 0
    ? stats.totalDistanceKm / stats.legDistances.length
    : stats.totalDistanceKm;
  const averageOperatingSpeedKmh = stats.totalTimeMin > 0
    ? stats.totalDistanceKm / (stats.totalTimeMin / 60)
    : 0;
  const averageWaitTimeMin = stats.trainsPerHour > 0 ? 30 / stats.trainsPerHour : 30;

  const baseMarketPassengersPerHour =
    (catchment.population * 0.0045) +
    (catchment.workingAge * 0.0085) +
    (catchment.youth * 0.0035) +
    (catchment.elderly * 0.0015);

  const railCultureFactor = clamp(0.78 + (catchment.trainCommutersPct / 28), 0.78, 1.42);
  const transitNeedFactor = clamp(
    0.82 + (catchment.noCarPct / 40) + (catchment.busCommutersPct / 120) - (catchment.driveCommutersPct / 190),
    0.72,
    1.34,
  );
  const urbanIntensityFactor = clamp(0.8 + (catchment.densityPerHa / 42) + (catchment.rentersPct / 180), 0.76, 1.34);
  const economicFactor = clamp(
    0.72 + (catchment.workingAgePct / 76) + (catchment.economicallyActivePct / 145) - (catchment.elderlyPct / 240),
    0.76,
    1.24,
  );

  const propensityFactor = clamp(
    (railCultureFactor * 0.34) +
    (transitNeedFactor * 0.26) +
    (urbanIntensityFactor * 0.2) +
    (economicFactor * 0.2),
    0.72,
    1.38,
  );

  const frequencyFactor = stats.trainsPerHour <= 0
    ? 0.35
    : clamp(0.45 + (Math.log1p(stats.trainsPerHour) / Math.log(13)), 0.45, 1.28);
  const speedFactor = clamp(0.68 + (averageOperatingSpeedKmh / 88), 0.62, 1.24);
  const spacingFactor = clamp(0.76 + (averageStopSpacingKm / 8), 0.74, 1.16);
  const stockFitFactor = getStockFitFactor(stock, averageStopSpacingKm);
  const networkReachFactor = clamp(0.9 + (Math.min(stationCount, 12) * 0.016), 0.9, 1.09);

  const serviceFactor = clamp(
    (frequencyFactor * 0.38) +
    (speedFactor * 0.28) +
    (spacingFactor * 0.16) +
    (stockFitFactor * 0.1) +
    (networkReachFactor * 0.08),
    0.46,
    1.28,
  );

  const unconstrainedPassengersPerHour = Math.max(
    0,
    Math.round(baseMarketPassengersPerHour * propensityFactor * serviceFactor),
  );
  const estimatedPassengersPerHour = Math.round(Math.min(unconstrainedPassengersPerHour, suppliedCapacityPerHour));
  const capacityUtilisationPct = suppliedCapacityPerHour > 0
    ? round((estimatedPassengersPerHour / suppliedCapacityPerHour) * 100, 1)
    : 0;
  const constrained = suppliedCapacityPerHour > 0 && unconstrainedPassengersPerHour > suppliedCapacityPerHour;

  const demandScore = clamp((Math.log1p(unconstrainedPassengersPerHour) / Math.log(6001)) * 72, 0, 72);
  const utilisationScore = clamp(capacityUtilisationPct, 0, 110) * 0.22;
  const corridorScore = clamp((catchment.population / 250000) * 12, 0, 12);
  const popularityScore = Math.round(clamp(demandScore + utilisationScore + corridorScore, 0, 100));
  const popularityBand = getPopularityBand(popularityScore);

  const summary = buildSummary(
    popularityBand,
    estimatedPassengersPerHour,
    constrained,
    catchment,
    serviceFactor,
  );

  const methodology = 'This is a sketch-planning demand model. It combines a 1.2 km stop catchment, Census 2021 demographic and travel-to-work indicators, and service-quality adjustments for frequency, speed, stop spacing, and rolling-stock fit. The final estimate is capped by supplied line capacity so the headline figure reflects a plausible peak-hour load rather than unconstrained latent demand.';

  return {
    estimatedPassengersPerHour,
    unconstrainedPassengersPerHour,
    suppliedCapacityPerHour,
    capacityUtilisationPct,
    popularityScore,
    popularityBand,
    baseMarketPassengersPerHour: Math.round(baseMarketPassengersPerHour),
    propensityFactor: round(propensityFactor, 2),
    serviceFactor: round(serviceFactor, 2),
    averageStopSpacingKm: round(averageStopSpacingKm, 1),
    averageOperatingSpeedKmh: round(averageOperatingSpeedKmh, 1),
    averageWaitTimeMin: round(averageWaitTimeMin, 1),
    demandConstrainedByCapacity: constrained,
    catchment: {
      residents: catchment.population,
      workingAgePct: catchment.workingAgePct,
      densityPerHa: catchment.densityPerHa,
      noCarPct: catchment.noCarPct,
      trainCommutersPct: catchment.trainCommutersPct,
      driveCommutersPct: catchment.driveCommutersPct,
      economicallyActivePct: catchment.economicallyActivePct,
      rentersPct: catchment.rentersPct,
    },
    service: {
      trainsPerHour: stats.trainsPerHour,
      endToEndMin: round(stats.totalTimeMin, 1),
      averageWaitTimeMin: round(averageWaitTimeMin, 1),
      averageSpeedKmh: round(averageOperatingSpeedKmh, 1),
      stopSpacingKm: round(averageStopSpacingKm, 1),
      stockFitFactor: round(stockFitFactor, 2),
      frequencyFactor: round(frequencyFactor, 2),
      speedFactor: round(speedFactor, 2),
      spacingFactor: round(spacingFactor, 2),
    },
    summary,
    methodology,
  };
}