import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Camera } from './Camera';
import { latLonToNorm } from '../utils/geo';
import type { GeographyFeature } from '../data/geographyLoader';
import type { OSMLineFeature } from '../data/osmLoader';
import type { NaPTANStop, Network, VehiclePosition, TransportMode } from '../types';
import { MODE_COLORS } from '../types';

const STOP_SHAPES: Record<TransportMode, string> = {
  HEAVY_RAIL: 'circle',
  METRO: 'diamond',
  TRAM: 'square',
  BUS: 'dot',
};

const BASE_COLORS: Record<string, number> = {
  coastline: 0x4a90d9,
  river: 0x4a90d9,
  motorway: 0x999999,
  rail: 0x333333,
};

export class MapRenderer {
  app: Application;
  camera: Camera;
  private container: HTMLElement;
  private resizeObserver?: ResizeObserver;

  // Graphics layers (drawn each frame)
  private geoGraphics = new Graphics();
  private baseMapGraphics = new Graphics();
  private networkGraphics = new Graphics();
  private flowGraphics = new Graphics();
  private naptanGraphics = new Graphics();
  private labelContainer = new Container();

  // Data references
  private geography: GeographyFeature[] = [];
  private osmData: OSMLineFeature[] = [];
  private naptanStops: NaPTANStop[] = [];
  private network: Network = { stops: {}, routes: {}, lines: {}, transfers: [] };
  private vehicles: VehiclePosition[] = [];
  private showNaPTAN = false;
  private censusPopulation: Record<string, number> = {};

  // Callbacks
  onMapClick?: (worldX: number, worldY: number) => void;

  private initialized = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.app = new Application();
    this.camera = new Camera();
  }

  async init() {
    await this.app.init({
      resizeTo: this.container,
      background: 0xf0f0f0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    this.container.appendChild(this.app.canvas);

    // Add layers in order (bottom to top)
    this.app.stage.addChild(this.geoGraphics);
    this.app.stage.addChild(this.baseMapGraphics);
    this.app.stage.addChild(this.naptanGraphics);
    this.app.stage.addChild(this.networkGraphics);
    this.app.stage.addChild(this.flowGraphics);
    this.app.stage.addChild(this.labelContainer);

    this.camera.resize(this.app.screen.width, this.app.screen.height);

    // Event handlers on canvas
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.onWheel(e);
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => this.camera.onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.camera.onMouseMove(e));
    canvas.addEventListener('mouseup', () => this.camera.onMouseUp());
    canvas.addEventListener('mouseleave', () => this.camera.onMouseUp());

    canvas.addEventListener('click', (e) => {
      if (this.camera.isDragging) return;
      const world = this.camera.screenToWorld(e.offsetX, e.offsetY);
      this.onMapClick?.(world.x, world.y);
    });

    // Resize handler
    this.resizeObserver = new ResizeObserver(() => {
      const screen = (this.app as any).screen;
      if (!screen) return;
      this.camera.resize(screen.width, screen.height);
    });
    this.resizeObserver.observe(this.container);

    // Main render loop
    this.app.ticker.add(() => this.draw());

    this.initialized = true;
  }

  setGeography(geo: GeographyFeature[]) {
    this.geography = geo;
  }

  setOSMData(data: OSMLineFeature[]) {
    this.osmData = data;
  }

  setNaPTAN(stops: NaPTANStop[]) {
    this.naptanStops = stops;
  }

  setCensusPopulation(pop: Record<string, number>) {
    this.censusPopulation = pop;
  }

  setNetwork(network: Network) {
    this.network = network;
  }

  setVehicles(vehicles: VehiclePosition[]) {
    this.vehicles = vehicles;
  }

  setShowNaPTAN(show: boolean) {
    this.showNaPTAN = show;
  }

  private draw() {
    this.drawGeography();
    this.drawBaseMap();
    this.drawNaPTAN();
    this.drawNetwork();
    this.drawVehicles();
  }

  private drawGeography() {
    const g = this.geoGraphics;
    g.clear();

    if (this.geography.length === 0) return;

    const maxPop = Math.max(1, ...Object.values(this.censusPopulation));

    for (const feature of this.geography) {
      const pop = this.censusPopulation[feature.code] ?? 0;
      const intensity = Math.min(1, pop / maxPop);
      // Interpolate white → blue based on population
      const r = Math.round(240 - intensity * 180);
      const gb = Math.round(240 - intensity * 60);
      const color = (r << 16) | (gb << 8) | 240;

      for (const ring of feature.coordinates) {
        if (ring.length < 3) continue;
        const first = latLonToNorm({ lat: ring[0][1], lon: ring[0][0] });
        const firstScreen = this.camera.worldToScreen(first.x, first.y);

        g.fill({ color, alpha: 0.6 });
        g.stroke({ color: 0xcccccc, width: 0.5 });
        g.moveTo(firstScreen.x, firstScreen.y);

        for (let i = 1; i < ring.length; i++) {
          const pt = latLonToNorm({ lat: ring[i][1], lon: ring[i][0] });
          const screen = this.camera.worldToScreen(pt.x, pt.y);
          g.lineTo(screen.x, screen.y);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
  }

  private drawBaseMap() {
    const g = this.baseMapGraphics;
    g.clear();

    for (const feature of this.osmData) {
      const color = BASE_COLORS[feature.type] ?? 0x999999;
      const width = feature.type === 'motorway' ? 2 : feature.type === 'rail' ? 1.5 : 1;

      if (feature.coordinates.length < 2) continue;

      const first = latLonToNorm({ lat: feature.coordinates[0][1], lon: feature.coordinates[0][0] });
      const firstScreen = this.camera.worldToScreen(first.x, first.y);

      g.stroke({ color, width, alpha: 0.8 });
      g.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < feature.coordinates.length; i++) {
        const pt = latLonToNorm({ lat: feature.coordinates[i][1], lon: feature.coordinates[i][0] });
        const screen = this.camera.worldToScreen(pt.x, pt.y);
        g.lineTo(screen.x, screen.y);
      }
      g.stroke();
    }
  }

  private drawNaPTAN() {
    const g = this.naptanGraphics;
    g.clear();
    if (!this.showNaPTAN) return;

    const dotSize = Math.max(1, 2 * (this.camera.zoom / 1000));

    for (const stop of this.naptanStops) {
      const norm = latLonToNorm({ lat: stop.lat, lon: stop.lon });
      const screen = this.camera.worldToScreen(norm.x, norm.y);

      // Skip if off-screen
      if (screen.x < -10 || screen.x > this.camera.width + 10 ||
          screen.y < -10 || screen.y > this.camera.height + 10) continue;

      g.fill({ color: 0x666666, alpha: 0.4 });
      g.circle(screen.x, screen.y, dotSize);
      g.fill();
    }
  }

  private drawNetwork() {
    const g = this.networkGraphics;
    g.clear();
    this.labelContainer.removeChildren();

    const { stops, routes } = this.network;

    // Draw routes (lines connecting stops)
    for (const route of Object.values(routes)) {
      if (route.stopIds.length < 2) continue;
      const color = parseInt(route.color.replace('#', ''), 16) || 0xff0000;
      const width = Math.max(2, 4 * (this.camera.zoom / 2000));

      g.stroke({ color, width, alpha: 0.8 });

      const firstStop = stops[route.stopIds[0]];
      if (!firstStop) continue;
      const firstNorm = latLonToNorm(firstStop.position);
      const firstScreen = this.camera.worldToScreen(firstNorm.x, firstNorm.y);
      g.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < route.stopIds.length; i++) {
        const stop = stops[route.stopIds[i]];
        if (!stop) continue;
        const norm = latLonToNorm(stop.position);
        const screen = this.camera.worldToScreen(norm.x, norm.y);
        g.lineTo(screen.x, screen.y);
      }
      g.stroke();
    }

    // Draw stops
    const stopSize = Math.max(3, 6 * (this.camera.zoom / 2000));
    for (const stop of Object.values(stops)) {
      const norm = latLonToNorm(stop.position);
      const screen = this.camera.worldToScreen(norm.x, norm.y);

      if (screen.x < -20 || screen.x > this.camera.width + 20 ||
          screen.y < -20 || screen.y > this.camera.height + 20) continue;

      const mode = stop.modes[0] ?? 'BUS';
      const color = parseInt(MODE_COLORS[mode].replace('#', ''), 16);
      const shape = STOP_SHAPES[mode];

      g.fill({ color: 0xffffff });
      g.stroke({ color, width: 2 });

      if (shape === 'circle' || shape === 'dot') {
        const r = shape === 'dot' ? stopSize * 0.6 : stopSize;
        g.circle(screen.x, screen.y, r);
      } else if (shape === 'diamond') {
        g.moveTo(screen.x, screen.y - stopSize);
        g.lineTo(screen.x + stopSize, screen.y);
        g.lineTo(screen.x, screen.y + stopSize);
        g.lineTo(screen.x - stopSize, screen.y);
        g.closePath();
      } else {
        // square
        g.rect(screen.x - stopSize, screen.y - stopSize, stopSize * 2, stopSize * 2);
      }

      g.fill();
      g.stroke();

      // Draw stop name at high zoom
      if (this.camera.zoom > 3000) {
        const label = new Text({
          text: stop.name,
          style: new TextStyle({
            fontSize: 10,
            fill: 0x333333,
            fontFamily: 'Arial',
          }),
        });
        label.x = screen.x + stopSize + 4;
        label.y = screen.y - 5;
        this.labelContainer.addChild(label);
      }
    }

    // Draw transfers
    g.stroke({ color: 0x999999, width: 1 });
    for (const transfer of this.network.transfers) {
      const a = stops[transfer.stopIdA];
      const b = stops[transfer.stopIdB];
      if (!a || !b) continue;
      const aNorm = latLonToNorm(a.position);
      const bNorm = latLonToNorm(b.position);
      const aScreen = this.camera.worldToScreen(aNorm.x, aNorm.y);
      const bScreen = this.camera.worldToScreen(bNorm.x, bNorm.y);

      g.setStrokeStyle({ color: 0x999999, width: 1 });
      g.moveTo(aScreen.x, aScreen.y);
      g.lineTo(bScreen.x, bScreen.y);
      g.stroke();
    }
  }

  private drawVehicles() {
    const g = this.flowGraphics;
    g.clear();

    const vehicleSize = Math.max(3, 5 * (this.camera.zoom / 2000));

    for (const vehicle of this.vehicles) {
      const norm = latLonToNorm(vehicle.position);
      const screen = this.camera.worldToScreen(norm.x, norm.y);

      if (screen.x < -10 || screen.x > this.camera.width + 10 ||
          screen.y < -10 || screen.y > this.camera.height + 10) continue;

      const route = this.network.routes[vehicle.routeId];
      const color = route
        ? parseInt(route.color.replace('#', ''), 16)
        : 0xff0000;

      // Color intensity based on occupancy
      const occupancyRatio = vehicle.capacity > 0 ? vehicle.occupancy / vehicle.capacity : 0;
      const alpha = 0.5 + occupancyRatio * 0.5;

      g.fill({ color, alpha });
      g.circle(screen.x, screen.y, vehicleSize);
      g.fill();
    }
  }

  destroy() {
    if (!this.initialized) return;
    this.initialized = false;
    try {
      // Stop observing resize events so callbacks don't run after destroy
      this.resizeObserver?.disconnect();
      this.app.destroy(true);
    } catch {
      // PixiJS may throw during teardown; safe to ignore
    }
  }
}
