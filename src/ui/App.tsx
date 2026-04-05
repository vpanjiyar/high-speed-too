import { useEffect, useRef, useCallback } from 'react';
import { MapRenderer } from '../map/MapRenderer';
import { SimulationBridge } from '../simulation/SimulationBridge';
import { useGameStore, useNetworkStore } from '../state/stores';
import { HUD } from './HUD';
import { Toolbar } from './Toolbar';
import { AnalyticsPanel } from './AnalyticsPanel';
import { loadCensusData } from '../data/censusLoader';
import { loadGeography } from '../data/geographyLoader';
import { loadNaPTAN } from '../data/naptanLoader';
import { loadOSMData } from '../data/osmLoader';
import { detectTransfers } from '../network/transfers';
import { normToLatLon } from '../utils/geo';
import { uid } from '../utils/geo';
import { MODE_COLORS } from '../types';
import type { Stop, Route } from '../types';
import { saveNetwork } from '../utils/persistence';

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const simRef = useRef<SimulationBridge | null>(null);

  const network = useNetworkStore((s) => s.network);
  const addStop = useNetworkStore((s) => s.addStop);
  const removeStop = useNetworkStore((s) => s.removeStop);
  const addRoute = useNetworkStore((s) => s.addRoute);
  const setTransfers = useNetworkStore((s) => s.setTransfers);
  const undo = useNetworkStore((s) => s.undo);
  const redo = useNetworkStore((s) => s.redo);

  const activeTool = useGameStore((s) => s.activeTool);
  const activeMode = useGameStore((s) => s.activeMode);
  const showAnalytics = useGameStore((s) => s.showAnalytics);
  const showNaPTAN = useGameStore((s) => s.showNaPTAN);
  const drawingStops = useGameStore((s) => s.drawingRouteStops);
  const addDrawingStop = useGameStore((s) => s.addDrawingStop);
  const clearDrawingRoute = useGameStore((s) => s.clearDrawingRoute);
  const setSimulationState = useGameStore((s) => s.setSimulationState);
  const setRouteStats = useGameStore((s) => s.setRouteStats);
  const setStopStats = useGameStore((s) => s.setStopStats);
  const setVehicles = useGameStore((s) => s.setVehicles);

  // Initialize renderer and simulation
  useEffect(() => {
    if (!canvasRef.current) return;

    let cancelled = false;

    const renderer = new MapRenderer(canvasRef.current);
    rendererRef.current = renderer;

    const sim = new SimulationBridge();
    simRef.current = sim;

    sim.setTickCallback((state, vehicles, routeStats, stopStats) => {
      if (cancelled) return;
      setSimulationState(state);
      setVehicles(vehicles);
      setRouteStats(routeStats);
      setStopStats(stopStats);
      renderer.setVehicles(vehicles);
    });

    (async () => {
      await renderer.init();
      if (cancelled) { renderer.destroy(); return; }

      // Load data in parallel, but don't fail if files are missing
      const [census, geography, naptan, osmData] = await Promise.all([
        loadCensusData().catch(() => null),
        loadGeography().catch(() => []),
        loadNaPTAN().catch(() => []),
        loadOSMData().catch(() => []),
      ]);
      if (cancelled) { renderer.destroy(); return; }

      if (geography.length > 0) renderer.setGeography(geography);
      if (osmData.length > 0) renderer.setOSMData(osmData);
      if (naptan.length > 0) renderer.setNaPTAN(naptan);

      // Set census population for heatmap
      if (census) {
        const pop: Record<string, number> = {};
        for (const [code, zone] of Object.entries(census.zones)) {
          pop[code] = zone.population;
        }
        renderer.setCensusPopulation(pop);

        // Initialize simulation
        await sim.init(census, network);
      }
    })();

    return () => {
      cancelled = true;
      renderer.destroy();
      sim.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync network to renderer and simulation
  useEffect(() => {
    rendererRef.current?.setNetwork(network);
    simRef.current?.updateNetwork(network);

    // Auto-detect transfers
    const transfers = detectTransfers(network);
    if (JSON.stringify(transfers) !== JSON.stringify(network.transfers)) {
      setTransfers(transfers);
    }

    // Auto-save
    saveNetwork(network).catch(console.error);
  }, [network, setTransfers]);

  // Sync NaPTAN visibility
  useEffect(() => {
    rendererRef.current?.setShowNaPTAN(showNaPTAN);
  }, [showNaPTAN]);

  // Handle map clicks
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    renderer.onMapClick = (worldX: number, worldY: number) => {
      const latLon = normToLatLon(worldX, worldY);

      if (activeTool === 'stop') {
        const stop: Stop = {
          id: uid(),
          name: `Stop ${Object.keys(network.stops).length + 1}`,
          position: latLon,
          modes: [activeMode],
        };
        addStop(stop);
      } else if (activeTool === 'route') {
        // Find nearest stop to click
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const [id, stop] of Object.entries(network.stops)) {
          const dx = stop.position.lat - latLon.lat;
          const dy = stop.position.lon - latLon.lon;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearestDist) {
            nearestDist = d;
            nearestId = id;
          }
        }
        // Only add if reasonably close (within ~5km in degrees)
        if (nearestId && nearestDist < 0.05) {
          addDrawingStop(nearestId);
        }
      } else if (activeTool === 'delete') {
        // Find and delete nearest stop
        let nearestId: string | null = null;
        let nearestDist = Infinity;
        for (const [id, stop] of Object.entries(network.stops)) {
          const dx = stop.position.lat - latLon.lat;
          const dy = stop.position.lon - latLon.lon;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < nearestDist) {
            nearestDist = d;
            nearestId = id;
          }
        }
        if (nearestId && nearestDist < 0.05) {
          removeStop(nearestId);
        }
      }
    };
  }, [activeTool, activeMode, network.stops, addStop, removeStop, addDrawingStop]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Finish drawing a route
  const handleFinishRoute = useCallback(() => {
    if (drawingStops.length < 2) return;

    const route: Route = {
      id: uid(),
      name: `Route ${Object.keys(network.routes).length + 1}`,
      color: MODE_COLORS[activeMode],
      mode: activeMode,
      stopIds: [...drawingStops],
      frequency: 6, // default: every 10 minutes
    };
    addRoute(route);
    clearDrawingRoute();
  }, [drawingStops, activeMode, network.routes, addRoute, clearDrawingRoute]);

  // Speed control
  const handleSpeedChange = useCallback((speed: number) => {
    const sim = simRef.current;
    if (!sim) return;
    if (speed === 0) {
      sim.pause();
    } else {
      sim.setSpeed(speed);
      sim.start();
    }
  }, []);

  return (
    <div className="app">
      <div className="canvas-container" ref={canvasRef} />
      <Toolbar onFinishRoute={handleFinishRoute} />
      <HUD onSpeedChange={handleSpeedChange} />
      {showAnalytics && <AnalyticsPanel />}
    </div>
  );
}
