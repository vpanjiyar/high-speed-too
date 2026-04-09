// ── Rolling stock catalogue ───────────────────────────────────────────────────
// Real-world train specifications for the sandbox line manager.

export interface RollingStock {
  id: string;
  name: string;
  designation: string;        // e.g. "Class 700", "N700S"
  category: RollingStockCategory;
  manufacturer: string;
  country: string;
  /** Flag emoji for display */
  flag: string;
  yearIntroduced: number;
  /** Maximum service speed in km/h */
  maxSpeedKmh: number;
  /** Acceleration in m/s² (where known) */
  accelerationMs2: number;
  /** Number of cars in the default formation */
  carsPerUnit: number;
  /** Train length in metres */
  lengthM: number;
  /** Tare weight in tonnes */
  weightT: number;
  /** Power output in kW */
  powerKw: number;
  /** Number of seated passengers */
  seatingCapacity: number;
  /** Total capacity including standees */
  totalCapacity: number;
  /** Estimated cost per unit in millions of GBP */
  costMillionGbp: number;
  /** Electric system (e.g. "25 kV AC overhead") */
  electricSystem: string;
  /** A fun fact or description */
  funFact: string;
}

export type RollingStockCategory =
  | 'UK Commuter'
  | 'UK Metro'
  | 'UK High Speed'
  | 'International High Speed';

export const ROLLING_STOCK_CATEGORIES: RollingStockCategory[] = [
  'UK Commuter',
  'UK Metro',
  'UK High Speed',
  'International High Speed',
];

// ── Catalogue ─────────────────────────────────────────────────────────────────

export const ROLLING_STOCK: RollingStock[] = [
  // ── UK Commuter ─────────────────────────────────────────────────────────
  {
    id: 'class-700',
    name: 'Thameslink',
    designation: 'Class 700',
    category: 'UK Commuter',
    manufacturer: 'Siemens',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2016,
    maxSpeedKmh: 160,
    accelerationMs2: 0.9,
    carsPerUnit: 12,
    lengthM: 242.6,
    weightT: 410,
    powerKw: 5000,
    seatingCapacity: 666,
    totalCapacity: 1754,
    costMillionGbp: 14,
    electricSystem: '25 kV AC / 750 V DC dual',
    funFact: 'The Class 700 Desiro City fleet is the backbone of the Thameslink core through central London, running through a tunnel originally built in 1868.',
  },
  {
    id: 'class-345',
    name: 'Elizabeth line',
    designation: 'Class 345',
    category: 'UK Commuter',
    manufacturer: 'Bombardier / Alstom',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2017,
    maxSpeedKmh: 145,
    accelerationMs2: 1.0,
    carsPerUnit: 9,
    lengthM: 204.7,
    weightT: 319,
    powerKw: 4400,
    seatingCapacity: 454,
    totalCapacity: 1500,
    costMillionGbp: 14.3,
    electricSystem: '25 kV AC overhead',
    funFact: 'The Aventra trains on the Elizabeth line pass through 42 km of new tunnels beneath central London and can carry 1,500 passengers — more than a wide-body jumbo jet.',
  },
  {
    id: 'class-710',
    name: 'London Overground',
    designation: 'Class 710',
    category: 'UK Commuter',
    manufacturer: 'Bombardier',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2019,
    maxSpeedKmh: 121,
    accelerationMs2: 0.9,
    carsPerUnit: 4,
    lengthM: 82.9,
    weightT: 148,
    powerKw: 2000,
    seatingCapacity: 189,
    totalCapacity: 678,
    costMillionGbp: 5.8,
    electricSystem: '25 kV AC overhead',
    funFact: 'Part of the Aventra family, the Class 710 serves London Overground routes and was one of the first trains in the UK with free WiFi from day one.',
  },

  // ── UK Metro ────────────────────────────────────────────────────────────
  {
    id: 'lu-2024-stock',
    name: 'Piccadilly line',
    designation: '2024 Stock',
    category: 'UK Metro',
    manufacturer: 'Siemens',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2025,
    maxSpeedKmh: 100,
    accelerationMs2: 1.4,
    carsPerUnit: 9,
    lengthM: 113.7,
    weightT: 155,
    powerKw: 2500,
    seatingCapacity: 256,
    totalCapacity: 1042,
    costMillionGbp: 16,
    electricSystem: '630/750 V DC fourth rail',
    funFact: 'The Siemens Inspiro trains will be the first air-conditioned deep-level Tube trains, using a novel cooling system that works despite the narrow tunnel diameter.',
  },
  {
    id: 'lu-s-stock',
    name: 'Sub-Surface Lines',
    designation: 'S7/S8 Stock',
    category: 'UK Metro',
    manufacturer: 'Bombardier',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2010,
    maxSpeedKmh: 100,
    accelerationMs2: 1.3,
    carsPerUnit: 7,
    lengthM: 117.5,
    weightT: 168,
    powerKw: 2600,
    seatingCapacity: 306,
    totalCapacity: 1209,
    costMillionGbp: 7.8,
    electricSystem: '630/750 V DC fourth rail',
    funFact: 'The S Stock was the largest single rolling-stock order in Britain (£1.5 billion for 192 trains) and introduced air conditioning to the Tube for the first time.',
  },
  {
    id: 'lu-1996-stock',
    name: 'Jubilee line',
    designation: '1996 Stock',
    category: 'UK Metro',
    manufacturer: 'Alstom',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 1997,
    maxSpeedKmh: 100,
    accelerationMs2: 1.3,
    carsPerUnit: 7,
    lengthM: 126.3,
    weightT: 196,
    powerKw: 2680,
    seatingCapacity: 234,
    totalCapacity: 875,
    costMillionGbp: 6.5,
    electricSystem: '630 V DC fourth rail',
    funFact: 'These trains run on the Jubilee line at up to 30 trains per hour using automatic train operation, making it one of the highest-frequency metro services in Europe.',
  },

  // ── UK High Speed ───────────────────────────────────────────────────────
  {
    id: 'class-395',
    name: 'Javelin',
    designation: 'Class 395',
    category: 'UK High Speed',
    manufacturer: 'Hitachi',
    country: 'United Kingdom',
    flag: '🇬🇧',
    yearIntroduced: 2009,
    maxSpeedKmh: 225,
    accelerationMs2: 0.7,
    carsPerUnit: 6,
    lengthM: 122,
    weightT: 265,
    powerKw: 3360,
    seatingCapacity: 340,
    totalCapacity: 438,
    costMillionGbp: 8.6,
    electricSystem: '25 kV AC / 750 V DC dual',
    funFact: 'Based on the Shinkansen 400 Series, the Javelin was the first Japanese-built train sold in Europe and served as the official Olympic shuttle during London 2012.',
  },

  // ── International High Speed ────────────────────────────────────────────
  {
    id: 'n700s',
    name: 'Shinkansen',
    designation: 'N700S',
    category: 'International High Speed',
    manufacturer: 'Hitachi / Nippon Sharyo',
    country: 'Japan',
    flag: '🇯🇵',
    yearIntroduced: 2020,
    maxSpeedKmh: 300,
    accelerationMs2: 0.71,
    carsPerUnit: 16,
    lengthM: 404.7,
    weightT: 715,
    powerKw: 17080,
    seatingCapacity: 1323,
    totalCapacity: 1323,
    costMillionGbp: 37,
    electricSystem: '25 kV 60 Hz AC overhead',
    funFact: '"S" stands for Supreme. It carries lithium-titanate batteries allowing it to crawl to safety if power fails during an earthquake — a world first for high-speed rail.',
  },
  {
    id: 'tgv-duplex',
    name: 'TGV Duplex',
    designation: 'TGV Duplex',
    category: 'International High Speed',
    manufacturer: 'Alstom',
    country: 'France',
    flag: '🇫🇷',
    yearIntroduced: 1996,
    maxSpeedKmh: 320,
    accelerationMs2: 0.5,
    carsPerUnit: 10,
    lengthM: 200,
    weightT: 380,
    powerKw: 8800,
    seatingCapacity: 510,
    totalCapacity: 510,
    costMillionGbp: 28,
    electricSystem: '25 kV AC / 1.5 kV DC dual',
    funFact: 'The double-decker TGV carries 45% more passengers than a single-level TGV. A shortened test version set the world rail speed record of 574.8 km/h in 2007.',
  },
  {
    id: 'cr400af',
    name: 'Fuxing',
    designation: 'CR400AF',
    category: 'International High Speed',
    manufacturer: 'CRRC Qingdao Sifang',
    country: 'China',
    flag: '🇨🇳',
    yearIntroduced: 2017,
    maxSpeedKmh: 350,
    accelerationMs2: 0.5,
    carsPerUnit: 8,
    lengthM: 209,
    weightT: 425,
    powerKw: 10600,
    seatingCapacity: 576,
    totalCapacity: 576,
    costMillionGbp: 20,
    electricSystem: '25 kV 50 Hz AC overhead',
    funFact: 'The Fuxing ("Rejuvenation") is the world\'s fastest train in regular commercial service at 350 km/h, operating on the Beijing–Shanghai line in just 4.5 hours.',
  },
];

/** Look up a rolling stock by ID. */
export function getRollingStock(id: string): RollingStock | undefined {
  return ROLLING_STOCK.find((rs) => rs.id === id);
}

// ── Line statistics ───────────────────────────────────────────────────────────

export type JourneyPhase = 'accelerating' | 'cruising' | 'braking' | 'dwell';

export interface JourneyProfilePoint {
  /** Elapsed journey time in seconds */
  timeSec: number;
  /** Train speed at this point in km/h */
  speedKmh: number;
  /** Distance travelled at this point in km */
  distanceKm: number;
}

export interface JourneyProfileSegment {
  /** Segment start time in seconds */
  startTimeSec: number;
  /** Segment end time in seconds */
  endTimeSec: number;
  /** Segment start speed in km/h */
  startSpeedKmh: number;
  /** Segment end speed in km/h */
  endSpeedKmh: number;
  /** Distance covered at segment start in km */
  startDistanceKm: number;
  /** Distance covered at segment end in km */
  endDistanceKm: number;
  /** Motion phase for this slice of the journey */
  phase: JourneyPhase;
  /** Zero-based index of the leg this segment belongs to */
  legIndex: number;
  /** Zero-based origin station index for the leg */
  fromStationIndex: number;
  /** Zero-based destination station index for the leg */
  toStationIndex: number;
  /** Origin station label when available */
  fromStationName?: string;
  /** Destination station label when available */
  toStationName?: string;
}

export interface JourneyStationStop {
  /** Zero-based station index along the line */
  stationIndex: number;
  /** Station label when available */
  name: string;
  /** Arrival time in seconds */
  arrivalTimeSec: number;
  /** Departure time in seconds */
  departureTimeSec: number;
  /** Dwell duration at this station in seconds */
  dwellTimeSec: number;
  /** Distance travelled by arrival in km */
  distanceKm: number;
}

export interface LineTrainStats {
  /** Distance between each consecutive pair of stations in km */
  legDistances: number[];
  /** Total line distance in km */
  totalDistanceKm: number;
  /** Travel time for each leg in minutes */
  legTimesMin: number[];
  /** Running time excluding station dwell in minutes */
  runningTimeMin: number;
  /** Dwell time spent at intermediate stations in minutes */
  dwellTimeMin: number;
  /** Total end-to-end travel time in minutes (includes 45s dwell per intermediate stop) */
  totalTimeMin: number;
  /** Highest speed reached anywhere along the journey in km/h */
  maxReachedSpeedKmh: number;
  /** Piecewise profile points for plotting speed against time */
  profilePoints: JourneyProfilePoint[];
  /** Piecewise journey segments for graph hover interpolation */
  profileSegments: JourneyProfileSegment[];
  /** Arrival and dwell timings at each stop */
  stationStops: JourneyStationStop[];
  /** Total cost of all units on the line in £M */
  totalCostM: number;
  /** Total passenger capacity across all units */
  totalCapacity: number;
  /** Trains per hour (if enough units assigned) */
  trainsPerHour: number;
  /** Passengers per hour per direction */
  passengersThroughput: number;
}

/**
 * Haversine distance between two WGS-84 points, in km.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RAIL_WINDING_FACTOR = 1.3;
const DWELL_TIME_SEC = 45;
const TURNAROUND_TIME_MIN = 5;

function appendJourneySegment(
  segments: JourneyProfileSegment[],
  points: JourneyProfilePoint[],
  segment: JourneyProfileSegment,
): void {
  if (segment.endTimeSec <= segment.startTimeSec) return;

  segments.push(segment);
  points.push({
    timeSec: segment.endTimeSec,
    speedKmh: segment.endSpeedKmh,
    distanceKm: segment.endDistanceKm,
  });
}

/**
 * Compute line statistics for a given train assignment.
 *
 * @param stations – ordered array of {lng, lat, name?} for each stop on the line
 * @param stock – the rolling stock assigned to the line
 * @param unitCount – number of train units operating on the line
 */
export function computeLineStats(
  stations: { lng: number; lat: number; name?: string }[],
  stock: RollingStock,
  unitCount: number,
): LineTrainStats {
  const legDistances: number[] = [];
  for (let i = 1; i < stations.length; i++) {
    const d = haversineKm(
      stations[i - 1].lat, stations[i - 1].lng,
      stations[i].lat, stations[i].lng,
    );
    legDistances.push(d * RAIL_WINDING_FACTOR);
  }

  const totalDistanceKm = legDistances.reduce((a, b) => a + b, 0);

  const maxSpeedMs = stock.maxSpeedKmh / 3.6;
  const accelMs2 = Math.max(0.1, stock.accelerationMs2);

  const legTimesMin: number[] = [];
  const profilePoints: JourneyProfilePoint[] = [{ timeSec: 0, speedKmh: 0, distanceKm: 0 }];
  const profileSegments: JourneyProfileSegment[] = [];
  const stationStops: JourneyStationStop[] = [
    {
      stationIndex: 0,
      name: stations[0]?.name ?? 'Stop 1',
      arrivalTimeSec: 0,
      departureTimeSec: 0,
      dwellTimeSec: 0,
      distanceKm: 0,
    },
  ];

  let elapsedSec = 0;
  let runningTimeSec = 0;
  let cumulativeDistanceKm = 0;
  let maxReachedSpeedKmh = 0;

  for (let legIndex = 0; legIndex < legDistances.length; legIndex++) {
    const legDistanceKm = legDistances[legIndex];
    const legDistanceM = legDistanceKm * 1000;
    const fromStationName = stations[legIndex]?.name ?? `Stop ${legIndex + 1}`;
    const toStationName = stations[legIndex + 1]?.name ?? `Stop ${legIndex + 2}`;

    const distanceNeededForTopSpeedM = (maxSpeedMs * maxSpeedMs) / accelMs2;
    const peakSpeedMs = legDistanceM >= distanceNeededForTopSpeedM
      ? maxSpeedMs
      : Math.sqrt(legDistanceM * accelMs2);
    const accelTimeSec = peakSpeedMs / accelMs2;
    const cruiseDistanceM = Math.max(0, legDistanceM - distanceNeededForTopSpeedM);
    const cruiseTimeSec = peakSpeedMs > 0 ? cruiseDistanceM / peakSpeedMs : 0;
    const brakeTimeSec = peakSpeedMs / accelMs2;

    const accelDistanceKm = ((peakSpeedMs * peakSpeedMs) / (2 * accelMs2)) / 1000;
    const cruiseDistanceKm = cruiseDistanceM / 1000;
    const brakeDistanceKm = Math.max(0, legDistanceKm - accelDistanceKm - cruiseDistanceKm);
    const peakSpeedKmh = peakSpeedMs * 3.6;

    maxReachedSpeedKmh = Math.max(maxReachedSpeedKmh, peakSpeedKmh);

    const accelStartTimeSec = elapsedSec;
    const accelStartDistanceKm = cumulativeDistanceKm;
    elapsedSec += accelTimeSec;
    cumulativeDistanceKm += accelDistanceKm;
    appendJourneySegment(profileSegments, profilePoints, {
      startTimeSec: accelStartTimeSec,
      endTimeSec: elapsedSec,
      startSpeedKmh: 0,
      endSpeedKmh: peakSpeedKmh,
      startDistanceKm: accelStartDistanceKm,
      endDistanceKm: cumulativeDistanceKm,
      phase: 'accelerating',
      legIndex,
      fromStationIndex: legIndex,
      toStationIndex: legIndex + 1,
      fromStationName,
      toStationName,
    });

    const cruiseStartTimeSec = elapsedSec;
    const cruiseStartDistanceKm = cumulativeDistanceKm;
    elapsedSec += cruiseTimeSec;
    cumulativeDistanceKm += cruiseDistanceKm;
    appendJourneySegment(profileSegments, profilePoints, {
      startTimeSec: cruiseStartTimeSec,
      endTimeSec: elapsedSec,
      startSpeedKmh: peakSpeedKmh,
      endSpeedKmh: peakSpeedKmh,
      startDistanceKm: cruiseStartDistanceKm,
      endDistanceKm: cumulativeDistanceKm,
      phase: 'cruising',
      legIndex,
      fromStationIndex: legIndex,
      toStationIndex: legIndex + 1,
      fromStationName,
      toStationName,
    });

    const brakeStartTimeSec = elapsedSec;
    const brakeStartDistanceKm = cumulativeDistanceKm;
    elapsedSec += brakeTimeSec;
    cumulativeDistanceKm += brakeDistanceKm;
    appendJourneySegment(profileSegments, profilePoints, {
      startTimeSec: brakeStartTimeSec,
      endTimeSec: elapsedSec,
      startSpeedKmh: peakSpeedKmh,
      endSpeedKmh: 0,
      startDistanceKm: brakeStartDistanceKm,
      endDistanceKm: cumulativeDistanceKm,
      phase: 'braking',
      legIndex,
      fromStationIndex: legIndex,
      toStationIndex: legIndex + 1,
      fromStationName,
      toStationName,
    });

    const legTimeSec = accelTimeSec + cruiseTimeSec + brakeTimeSec;
    runningTimeSec += legTimeSec;
    legTimesMin.push(legTimeSec / 60);

    const isIntermediateStop = legIndex < legDistances.length - 1;
    const dwellTimeSec = isIntermediateStop ? DWELL_TIME_SEC : 0;
    stationStops.push({
      stationIndex: legIndex + 1,
      name: toStationName,
      arrivalTimeSec: elapsedSec,
      departureTimeSec: elapsedSec + dwellTimeSec,
      dwellTimeSec,
      distanceKm: cumulativeDistanceKm,
    });

    if (dwellTimeSec > 0) {
      const dwellStartTimeSec = elapsedSec;
      elapsedSec += dwellTimeSec;
      appendJourneySegment(profileSegments, profilePoints, {
        startTimeSec: dwellStartTimeSec,
        endTimeSec: elapsedSec,
        startSpeedKmh: 0,
        endSpeedKmh: 0,
        startDistanceKm: cumulativeDistanceKm,
        endDistanceKm: cumulativeDistanceKm,
        phase: 'dwell',
        legIndex,
        fromStationIndex: legIndex + 1,
        toStationIndex: legIndex + 1,
        fromStationName: toStationName,
        toStationName,
      });
    }
  }

  const dwellTimeMin = Math.max(0, stations.length - 2) * (DWELL_TIME_SEC / 60);
  const runningTimeMin = runningTimeSec / 60;
  const totalTimeMin = runningTimeMin + dwellTimeMin;

  const totalCostM = unitCount * stock.costMillionGbp;
  const totalCapacity = unitCount * stock.totalCapacity;

  // Trains per hour: if a round trip takes T minutes, need T/60 trains to run one per hour
  // With N trains, can run N / (roundTrip/60) trains per hour in each direction
  const roundTripMin = totalTimeMin * 2 + TURNAROUND_TIME_MIN;
  const trainsPerHour = roundTripMin > 0 ? Math.floor((unitCount / (roundTripMin / 60))) : 0;

  const passengersThroughput = trainsPerHour * stock.totalCapacity;

  return {
    legDistances,
    totalDistanceKm,
    legTimesMin,
    runningTimeMin,
    dwellTimeMin,
    totalTimeMin,
    maxReachedSpeedKmh,
    profilePoints,
    profileSegments,
    stationStops,
    totalCostM,
    totalCapacity,
    trainsPerHour,
    passengersThroughput,
  };
}
