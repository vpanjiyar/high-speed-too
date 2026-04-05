import type {
  WorkerCommand,
  WorkerResponse,
  Network,
  CensusData,
  SimulationState,
  VehiclePosition,
  RouteStats,
  StopStats,
} from '../types';

type TickCallback = (
  state: SimulationState,
  vehicles: VehiclePosition[],
  routeStats: RouteStats[],
  stopStats: StopStats[]
) => void;

/**
 * Bridge between the main thread and the simulation Web Worker.
 */
export class SimulationBridge {
  private worker: Worker;
  private onTick: TickCallback | null = null;
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'ready':
          this.readyResolve?.();
          break;
        case 'tickResult':
          this.onTick?.(msg.state, msg.vehicles, msg.routeStats, msg.stopStats);
          break;
        case 'error':
          console.error('Simulation error:', msg.message);
          break;
      }
    };
  }

  async init(census: CensusData, network: Network): Promise<void> {
    return new Promise<void>((resolve) => {
      this.readyResolve = resolve;
      this.send({ type: 'init', census, network });
    });
  }

  start() {
    this.send({ type: 'start' });
  }

  pause() {
    this.send({ type: 'pause' });
  }

  setSpeed(speed: number) {
    this.send({ type: 'setSpeed', speed });
  }

  updateNetwork(network: Network) {
    this.send({ type: 'updateNetwork', network });
  }

  setTickCallback(cb: TickCallback) {
    this.onTick = cb;
  }

  destroy() {
    this.worker.terminate();
  }

  private send(cmd: WorkerCommand) {
    this.worker.postMessage(cmd);
  }
}
