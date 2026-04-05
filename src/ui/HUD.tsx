import { useGameStore } from '../state/stores';

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

interface HUDProps {
  onSpeedChange: (speed: number) => void;
}

export function HUD({ onSpeedChange }: HUDProps) {
  const sim = useGameStore((s) => s.simulationState);

  const speeds = [0, 1, 2, 4, 8];

  return (
    <div className="hud">
      <div className="hud-time">{formatTime(sim.time)}</div>
      <div className="hud-controls">
        {speeds.map((s) => (
          <button
            key={s}
            className={`hud-speed-btn ${sim.speed === s ? 'active' : ''}`}
            onClick={() => onSpeedChange(s)}
          >
            {s === 0 ? '⏸' : `${s}x`}
          </button>
        ))}
      </div>
      <div className="hud-stats">
        <span className="hud-stat">
          🚶 {sim.passengerCount.toLocaleString()} passengers
        </span>
      </div>
    </div>
  );
}
