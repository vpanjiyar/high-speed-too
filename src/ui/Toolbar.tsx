import { TransportMode } from '../types';
import { useGameStore } from '../state/stores';
import type { ActiveTool } from '../state/stores';

const MODES: { mode: TransportMode; label: string; icon: string }[] = [
  { mode: TransportMode.HEAVY_RAIL, label: 'Rail', icon: '🚂' },
  { mode: TransportMode.METRO, label: 'Metro', icon: '🚇' },
  { mode: TransportMode.TRAM, label: 'Tram', icon: '🚊' },
  { mode: TransportMode.BUS, label: 'Bus', icon: '🚌' },
];

const TOOLS: { tool: ActiveTool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: '🖱️' },
  { tool: 'stop', label: 'Place Stop', icon: '📍' },
  { tool: 'route', label: 'Draw Route', icon: '✏️' },
  { tool: 'delete', label: 'Delete', icon: '🗑️' },
];

interface ToolbarProps {
  onFinishRoute: () => void;
}

export function Toolbar({ onFinishRoute }: ToolbarProps) {
  const activeTool = useGameStore((s) => s.activeTool);
  const activeMode = useGameStore((s) => s.activeMode);
  const drawingStops = useGameStore((s) => s.drawingRouteStops);
  const setActiveTool = useGameStore((s) => s.setActiveTool);
  const setActiveMode = useGameStore((s) => s.setActiveMode);
  const showAnalytics = useGameStore((s) => s.showAnalytics);
  const showNaPTAN = useGameStore((s) => s.showNaPTAN);
  const toggleAnalytics = useGameStore((s) => s.toggleAnalytics);
  const toggleNaPTAN = useGameStore((s) => s.toggleNaPTAN);

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <div className="toolbar-label">Mode</div>
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={`toolbar-btn ${activeMode === m.mode ? 'active' : ''}`}
            onClick={() => setActiveMode(m.mode)}
            data-mode={m.mode}
            data-active={activeMode === m.mode ? 'true' : 'false'}
            title={m.label}
          >
            <span className="toolbar-icon">{m.icon}</span>
            <span className="toolbar-text">{m.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section">
        <div className="toolbar-label">Tools</div>
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`toolbar-btn ${activeTool === t.tool ? 'active' : ''}`}
            onClick={() => setActiveTool(t.tool)}
            title={t.label}
          >
            <span className="toolbar-icon">{t.icon}</span>
            <span className="toolbar-text">{t.label}</span>
          </button>
        ))}
      </div>

      {activeTool === 'route' && drawingStops.length > 0 && (
        <div className="toolbar-section">
          <div className="toolbar-label">Drawing Route ({drawingStops.length} stops)</div>
          <button className="toolbar-btn finish-btn" onClick={onFinishRoute}>
            ✅ Finish Route
          </button>
        </div>
      )}

      <div className="toolbar-section">
        <div className="toolbar-label">Layers</div>
        <button
          className={`toolbar-btn ${showNaPTAN ? 'active' : ''}`}
          onClick={toggleNaPTAN}
        >
          📌 NaPTAN
        </button>
        <button
          className={`toolbar-btn ${showAnalytics ? 'active' : ''}`}
          onClick={toggleAnalytics}
        >
          📊 Analytics
        </button>
      </div>
    </div>
  );
}
