import { create } from 'zustand';
import type {
  Network,
  Stop,
  Route,
  Line,
  Transfer,
  TransportMode,
  SimulationState,
  RouteStats,
  StopStats,
  VehiclePosition,
} from '../types';

// ===== Network Store =====

interface NetworkState {
  network: Network;
  history: Network[];
  historyIndex: number;

  addStop: (stop: Stop) => void;
  removeStop: (id: string) => void;
  updateStop: (id: string, updates: Partial<Stop>) => void;

  addRoute: (route: Route) => void;
  removeRoute: (id: string) => void;
  updateRoute: (id: string, updates: Partial<Route>) => void;

  addLine: (line: Line) => void;
  removeLine: (id: string) => void;

  setTransfers: (transfers: Transfer[]) => void;

  undo: () => void;
  redo: () => void;

  loadNetwork: (network: Network) => void;
}

function emptyNetwork(): Network {
  return { stops: {}, routes: {}, lines: {}, transfers: [] };
}

function pushHistory(state: { network: Network; history: Network[]; historyIndex: number }) {
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(structuredClone(state.network));
  return { history: newHistory, historyIndex: newHistory.length - 1 };
}

export const useNetworkStore = create<NetworkState>((set) => ({
  network: emptyNetwork(),
  history: [emptyNetwork()],
  historyIndex: 0,

  addStop: (stop) =>
    set((state) => {
      const network = structuredClone(state.network);
      network.stops[stop.id] = stop;
      return { network, ...pushHistory({ ...state, network }) };
    }),

  removeStop: (id) =>
    set((state) => {
      const network = structuredClone(state.network);
      delete network.stops[id];
      // Remove stop from all routes
      for (const route of Object.values(network.routes)) {
        route.stopIds = route.stopIds.filter((sid) => sid !== id);
      }
      // Remove transfers involving this stop
      network.transfers = network.transfers.filter(
        (t) => t.stopIdA !== id && t.stopIdB !== id
      );
      return { network, ...pushHistory({ ...state, network }) };
    }),

  updateStop: (id, updates) =>
    set((state) => {
      const network = structuredClone(state.network);
      if (network.stops[id]) {
        Object.assign(network.stops[id], updates);
      }
      return { network, ...pushHistory({ ...state, network }) };
    }),

  addRoute: (route) =>
    set((state) => {
      const network = structuredClone(state.network);
      network.routes[route.id] = route;
      return { network, ...pushHistory({ ...state, network }) };
    }),

  removeRoute: (id) =>
    set((state) => {
      const network = structuredClone(state.network);
      delete network.routes[id];
      // Remove from lines
      for (const line of Object.values(network.lines)) {
        line.routeIds = line.routeIds.filter((rid) => rid !== id);
      }
      return { network, ...pushHistory({ ...state, network }) };
    }),

  updateRoute: (id, updates) =>
    set((state) => {
      const network = structuredClone(state.network);
      if (network.routes[id]) {
        Object.assign(network.routes[id], updates);
      }
      return { network, ...pushHistory({ ...state, network }) };
    }),

  addLine: (line) =>
    set((state) => {
      const network = structuredClone(state.network);
      network.lines[line.id] = line;
      return { network, ...pushHistory({ ...state, network }) };
    }),

  removeLine: (id) =>
    set((state) => {
      const network = structuredClone(state.network);
      delete network.lines[id];
      return { network, ...pushHistory({ ...state, network }) };
    }),

  setTransfers: (transfers) =>
    set((state) => {
      const network = structuredClone(state.network);
      network.transfers = transfers;
      return { network, ...pushHistory({ ...state, network }) };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      return {
        network: structuredClone(state.history[newIndex]),
        historyIndex: newIndex,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      return {
        network: structuredClone(state.history[newIndex]),
        historyIndex: newIndex,
      };
    }),

  loadNetwork: (network) =>
    set(() => ({
      network: structuredClone(network),
      history: [structuredClone(network)],
      historyIndex: 0,
    })),
}));

// ===== Game Store =====

export type ActiveTool = 'select' | 'stop' | 'route' | 'delete';

interface GameState {
  activeTool: ActiveTool;
  activeMode: TransportMode;
  simulationState: SimulationState;
  routeStats: RouteStats[];
  stopStats: StopStats[];
  vehicles: VehiclePosition[];
  showAnalytics: boolean;
  showNaPTAN: boolean;
  drawingRouteStops: string[]; // stop IDs being drawn into a route

  setActiveTool: (tool: ActiveTool) => void;
  setActiveMode: (mode: TransportMode) => void;
  setSimulationState: (state: SimulationState) => void;
  setRouteStats: (stats: RouteStats[]) => void;
  setStopStats: (stats: StopStats[]) => void;
  setVehicles: (vehicles: VehiclePosition[]) => void;
  toggleAnalytics: () => void;
  toggleNaPTAN: () => void;

  addDrawingStop: (stopId: string) => void;
  clearDrawingRoute: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  activeTool: 'select',
  activeMode: 'HEAVY_RAIL' as TransportMode,
  simulationState: {
    time: 420, // 7:00 AM
    speed: 1,
    passengerCount: 0,
    running: false,
  },
  routeStats: [],
  stopStats: [],
  vehicles: [],
  showAnalytics: false,
  showNaPTAN: false,
  drawingRouteStops: [],

  setActiveTool: (tool) => set({ activeTool: tool }),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setSimulationState: (state) => set({ simulationState: state }),
  setRouteStats: (stats) => set({ routeStats: stats }),
  setStopStats: (stats) => set({ stopStats: stats }),
  setVehicles: (vehicles) => set({ vehicles }),
  toggleAnalytics: () => set((s) => ({ showAnalytics: !s.showAnalytics })),
  toggleNaPTAN: () => set((s) => ({ showNaPTAN: !s.showNaPTAN })),

  addDrawingStop: (stopId) =>
    set((s) => ({ drawingRouteStops: [...s.drawingRouteStops, stopId] })),
  clearDrawingRoute: () => set({ drawingRouteStops: [] }),
}));
