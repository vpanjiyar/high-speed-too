import { useGameStore, useNetworkStore } from '../state/stores';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { MODE_COLORS, TransportMode } from '../types';

const PIE_COLORS = [
  MODE_COLORS[TransportMode.HEAVY_RAIL],
  MODE_COLORS[TransportMode.METRO],
  MODE_COLORS[TransportMode.TRAM],
  MODE_COLORS[TransportMode.BUS],
];

export function AnalyticsPanel() {
  const routeStats = useGameStore((s) => s.routeStats);
  const stopStats = useGameStore((s) => s.stopStats);
  const routes = useNetworkStore((s) => s.network.routes);
  const stops = useNetworkStore((s) => s.network.stops);

  // Ridership by route
  const ridershipData = routeStats.map((rs) => ({
    name: routes[rs.routeId]?.name ?? rs.routeId.slice(0, 8),
    ridership: rs.ridership,
    color: routes[rs.routeId]?.color ?? '#999',
  }));

  // Mode share
  const modeShare: Record<string, number> = {};
  for (const rs of routeStats) {
    const route = routes[rs.routeId];
    if (!route) continue;
    const mode = route.mode;
    modeShare[mode] = (modeShare[mode] ?? 0) + rs.ridership;
  }
  const pieData = Object.entries(modeShare).map(([mode, value]) => ({
    name: mode,
    value,
  }));

  // Top stops
  const topStops = [...stopStats]
    .sort((a, b) => b.boardings - a.boardings)
    .slice(0, 10)
    .map((ss) => ({
      name: stops[ss.stopId]?.name ?? ss.stopId.slice(0, 8),
      boardings: ss.boardings,
      alightings: ss.alightings,
    }));

  return (
    <div className="analytics-panel">
      <h3>📊 Network Analytics</h3>

      <div className="analytics-section">
        <h4>Ridership by Route</h4>
        {ridershipData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ridershipData}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="ridership" fill="#4a90d9" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="analytics-empty">No routes yet. Draw a route to see ridership.</p>
        )}
      </div>

      <div className="analytics-section">
        <h4>Mode Share</h4>
        {pieData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name }) => name}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="analytics-empty">No passenger data yet.</p>
        )}
      </div>

      <div className="analytics-section">
        <h4>Top Stops</h4>
        {topStops.length > 0 ? (
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Stop</th>
                <th>Boardings</th>
                <th>Alightings</th>
              </tr>
            </thead>
            <tbody>
              {topStops.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.boardings}</td>
                  <td>{s.alightings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="analytics-empty">No stop data yet.</p>
        )}
      </div>
    </div>
  );
}
