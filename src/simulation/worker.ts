/**
 * Simulation Web Worker.
 *
 * Runs the passenger simulation off the main thread.
 * Initially a pure-TypeScript simulation; the Rust/WASM engine
 * will be loaded here once built.
 */

import type {
  WorkerCommand,
  WorkerResponse,
  Network,
  CensusData,
  SimulationState,
  VehiclePosition,
  RouteStats,
  StopStats,
  LatLon,
} from '../types';


let network: Network = { stops: {}, routes: {}, lines: {}, transfers: [] };
let census: CensusData | null = null;
let simState: SimulationState = {
  time: 420,
  speed: 1,
  passengerCount: 0,
  running: false,
};

// Simple agent representation
interface Agent {
  home: LatLon;
  work: LatLon;
  routeId: string | null;
  currentSegment: number;
  progress: number;
  active: boolean;
}

let agents: Agent[] = [];
let tickInterval: ReturnType<typeof setInterval> | null = null;

function respond(msg: WorkerResponse) {
  self.postMessage(msg);
}

function generateAgents() {
  agents = [];

  if (!census) return;

  // For each OD flow, create agents proportional to count (scaled down)
  const scaleFactor = 0.01; // 1% of real flows for perf
  for (const flow of census.odFlows) {
    const origin = census.zones[flow.originCode];
    const dest = census.zones[flow.destinationCode];
    if (!origin || !dest) continue;

    const count = Math.max(1, Math.round(flow.count * scaleFactor));
    for (let i = 0; i < count; i++) {
      agents.push({
        home: {
          lat: origin.centroid.lat + (Math.random() - 0.5) * 0.01,
          lon: origin.centroid.lon + (Math.random() - 0.5) * 0.01,
        },
        work: {
          lat: dest.centroid.lat + (Math.random() - 0.5) * 0.01,
          lon: dest.centroid.lon + (Math.random() - 0.5) * 0.01,
        },
        routeId: null,
        currentSegment: 0,
        progress: 0,
        active: false,
      });
    }
  }
}



function assignRoutes() {
  // Simple: assign each agent to a route that has stops near both origin and destination
  const routes = Object.values(network.routes);
  if (routes.length === 0) return;

  for (const agent of agents) {
    for (const route of routes) {
      const stopIds = route.stopIds;
      if (stopIds.length < 2) continue;

      // Check if route has a stop near home and near work
      let nearHome = false;
      let nearWork = false;
      for (const sid of stopIds) {
        const stop = network.stops[sid];
        if (!stop) continue;
        const dHome = Math.hypot(stop.position.lat - agent.home.lat, stop.position.lon - agent.home.lon);
        const dWork = Math.hypot(stop.position.lat - agent.work.lat, stop.position.lon - agent.work.lon);
        if (dHome < 0.05) nearHome = true;
        if (dWork < 0.05) nearWork = true;
      }

      if (nearHome && nearWork) {
        agent.routeId = route.id;
        agent.active = true;
        break;
      }
    }
  }
}

function simulateTick() {
  if (!simState.running) return;

  simState.time += 1; // 1 minute per tick
  if (simState.time >= 1440) simState.time = 0; // wrap at midnight

  // Move active agents along their routes
  let activeCount = 0;
  for (const agent of agents) {
    if (!agent.active || !agent.routeId) continue;
    activeCount++;

    const route = network.routes[agent.routeId];
    if (!route || route.stopIds.length < 2) continue;

    // Advance progress
    agent.progress += 0.01 * simState.speed;
    if (agent.progress >= 1) {
      agent.currentSegment++;
      agent.progress = 0;
      if (agent.currentSegment >= route.stopIds.length - 1) {
        agent.currentSegment = 0; // loop
      }
    }
  }

  simState.passengerCount = activeCount;

  // Generate vehicle positions from routes
  const vehicles: VehiclePosition[] = [];
  for (const route of Object.values(network.routes)) {
    if (route.stopIds.length < 2) continue;

    // Create vehicles based on frequency
    const numVehicles = Math.max(1, Math.round(route.frequency / 4));

    for (let v = 0; v < numVehicles; v++) {
      const offset = v / numVehicles;
      const totalProgress = (simState.time / 60 + offset) % 1;
      const totalSegments = route.stopIds.length - 1;
      const seg = Math.floor(totalProgress * totalSegments);
      const segProgress = (totalProgress * totalSegments) % 1;

      const fromStop = network.stops[route.stopIds[seg]];
      const toStop = network.stops[route.stopIds[Math.min(seg + 1, route.stopIds.length - 1)]];
      if (!fromStop || !toStop) continue;

      const position: LatLon = {
        lat: fromStop.position.lat + (toStop.position.lat - fromStop.position.lat) * segProgress,
        lon: fromStop.position.lon + (toStop.position.lon - fromStop.position.lon) * segProgress,
      };

      // Count passengers on this route segment
      const pax = agents.filter(
        (a) => a.active && a.routeId === route.id && a.currentSegment === seg
      ).length;

      vehicles.push({
        routeId: route.id,
        segmentIndex: seg,
        progress: segProgress,
        position,
        occupancy: pax,
        capacity: route.mode === 'BUS' ? 80 : route.mode === 'TRAM' ? 200 : 800,
      });
    }
  }

  // Route stats
  const routeStats: RouteStats[] = Object.values(network.routes).map((route) => {
    const pax = agents.filter((a) => a.active && a.routeId === route.id).length;
    return {
      routeId: route.id,
      ridership: pax,
      maxOccupancy: pax,
      avgOccupancy: pax,
    };
  });

  // Stop stats
  const stopStats: StopStats[] = Object.values(network.stops).map((stop) => ({
    stopId: stop.id,
    boardings: 0,
    alightings: 0,
  }));

  respond({
    type: 'tickResult',
    state: { ...simState },
    vehicles,
    routeStats,
    stopStats,
  });
}

function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(simulateTick, 1000 / simState.speed);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;

  switch (cmd.type) {
    case 'init':
      census = cmd.census;
      network = cmd.network;
      generateAgents();
      assignRoutes();
      respond({ type: 'ready' });
      break;

    case 'start':
      simState.running = true;
      startTicking();
      break;

    case 'pause':
      simState.running = false;
      stopTicking();
      break;

    case 'setSpeed':
      simState.speed = cmd.speed;
      if (simState.running) {
        stopTicking();
        startTicking();
      }
      break;

    case 'updateNetwork':
      network = cmd.network;
      assignRoutes();
      break;

    case 'tick':
      simulateTick();
      break;
  }
};
