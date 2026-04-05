// ===== Transport Network Types =====

export const TransportMode = {
  HEAVY_RAIL: 'HEAVY_RAIL',
  METRO: 'METRO',
  TRAM: 'TRAM',
  BUS: 'BUS',
} as const;

export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Stop {
  id: string;
  name: string;
  position: LatLon;
  modes: TransportMode[];
}

export interface Route {
  id: string;
  name: string;
  color: string;
  mode: TransportMode;
  stopIds: string[];
  frequency: number; // services per hour
}

export interface Line {
  id: string;
  name: string;
  routeIds: string[];
  mode: TransportMode;
  color: string;
}

export interface Transfer {
  stopIdA: string;
  stopIdB: string;
  walkingMeters: number;
}

export interface Network {
  stops: Record<string, Stop>;
  routes: Record<string, Route>;
  lines: Record<string, Line>;
  transfers: Transfer[];
}

// ===== Simulation Types =====

export interface SimulationState {
  time: number; // minutes from midnight
  speed: number; // multiplier: 0=paused, 1, 2, 4, 8
  passengerCount: number;
  running: boolean;
}

export interface VehiclePosition {
  routeId: string;
  segmentIndex: number;
  progress: number; // 0..1 along segment
  position: LatLon;
  occupancy: number;
  capacity: number;
}

export interface RouteStats {
  routeId: string;
  ridership: number;
  maxOccupancy: number;
  avgOccupancy: number;
}

export interface StopStats {
  stopId: string;
  boardings: number;
  alightings: number;
}

// ===== Data Schema Types =====

export interface CensusZone {
  code: string;
  name: string;
  population: number;
  workingPopulation: number;
  centroid: LatLon;
}

export interface CensusODFlow {
  originCode: string;
  destinationCode: string;
  count: number;
}

export interface CensusData {
  zones: Record<string, CensusZone>;
  odFlows: CensusODFlow[];
}

export interface NaPTANStop {
  atcoCode: string;
  name: string;
  lat: number;
  lon: number;
  type: 'rail' | 'metro' | 'tram' | 'bus';
  indicator?: string;
}

// ===== Worker Messages =====

export type WorkerCommand =
  | { type: 'init'; census: CensusData; network: Network }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'updateNetwork'; network: Network }
  | { type: 'tick' };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'tickResult'; state: SimulationState; vehicles: VehiclePosition[]; routeStats: RouteStats[]; stopStats: StopStats[] }
  | { type: 'error'; message: string };

// ===== Cost Model =====

export const COST_PER_KM: Record<TransportMode, number> = {
  [TransportMode.BUS]: 0.5,        // £M per km
  [TransportMode.TRAM]: 15,
  [TransportMode.METRO]: 100,
  [TransportMode.HEAVY_RAIL]: 25,
};

export const OPERATING_COST_PER_VEHICLE_HOUR: Record<TransportMode, number> = {
  [TransportMode.BUS]: 50,         // £ per hour
  [TransportMode.TRAM]: 120,
  [TransportMode.METRO]: 200,
  [TransportMode.HEAVY_RAIL]: 300,
};

export const SPEED_KMH: Record<TransportMode, number> = {
  [TransportMode.BUS]: 25,
  [TransportMode.TRAM]: 30,
  [TransportMode.METRO]: 40,
  [TransportMode.HEAVY_RAIL]: 100,
};

export const MODE_COLORS: Record<TransportMode, string> = {
  [TransportMode.HEAVY_RAIL]: '#E32017',
  [TransportMode.METRO]: '#0019A8',
  [TransportMode.TRAM]: '#00782A',
  [TransportMode.BUS]: '#F18F2B',
};
