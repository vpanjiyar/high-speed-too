/** Camera handles pan/zoom state and coordinate transformations for the map canvas. */
export class Camera {
  /** Centre of the viewport in world coords (normalised 0..1 over UK bounds) */
  x = 0.5;
  y = 0.4;

  /** Zoom level — pixels per world-unit (1 world-unit = full UK width) */
  zoom = 600;

  /** Viewport pixel dimensions */
  width = 0;
  height = 0;

  private minZoom = 200;
  private maxZoom = 50000;

  private dragging = false;
  private hasMoved = false;
  private lastMouse = { x: 0, y: 0 };

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  /** Convert world (normalised) coords to screen pixels */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.width / 2,
      y: (wy - this.y) * this.zoom + this.height / 2,
    };
  }

  /** Convert screen pixels to world (normalised) coords */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.width / 2) / this.zoom + this.x,
      y: (sy - this.height / 2) / this.zoom + this.y,
    };
  }

  /** Handle wheel zoom centred on mouse position */
  onWheel(e: WheelEvent) {
    const mouseWorld = this.screenToWorld(e.offsetX, e.offsetY);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    // Keep mouse position stable
    const afterScreen = this.worldToScreen(mouseWorld.x, mouseWorld.y);
    this.x += (e.offsetX - afterScreen.x) / this.zoom;
    this.y += (e.offsetY - afterScreen.y) / this.zoom;
  }

  onMouseDown(e: MouseEvent) {
    if (e.button === 0 || e.button === 1) {
      this.dragging = true;
      this.hasMoved = false;
      this.lastMouse = { x: e.offsetX, y: e.offsetY };
    }
  }

  onMouseMove(e: MouseEvent) {
    if (!this.dragging) return;
    const dx = e.offsetX - this.lastMouse.x;
    const dy = e.offsetY - this.lastMouse.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      this.hasMoved = true;
    }
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.lastMouse = { x: e.offsetX, y: e.offsetY };
  }

  onMouseUp() {
    this.dragging = false;
  }

  get isDragging() {
    return this.hasMoved;
  }
}
