import type { Network, Transfer } from '../types';
import { haversineMetres } from '../utils/geo';

const DEFAULT_WALK_DISTANCE = 200; // metres

/**
 * Detect transfers between stops of different routes that are within walking distance.
 */
export function detectTransfers(
  network: Network,
  maxDistance = DEFAULT_WALK_DISTANCE
): Transfer[] {
  const stops = Object.values(network.stops);
  const transfers: Transfer[] = [];

  // Build a map of which routes serve each stop
  const stopRoutes = new Map<string, Set<string>>();
  for (const route of Object.values(network.routes)) {
    for (const sid of route.stopIds) {
      if (!stopRoutes.has(sid)) stopRoutes.set(sid, new Set());
      stopRoutes.get(sid)!.add(route.id);
    }
  }

  // O(n²) — fine for hundreds of stops, use quadtree if thousands
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i];
      const b = stops[j];

      // Only create transfer if stops serve different routes
      const aRoutes = stopRoutes.get(a.id);
      const bRoutes = stopRoutes.get(b.id);
      if (!aRoutes || !bRoutes) continue;
      const overlap = [...aRoutes].some((r) => bRoutes.has(r));
      if (overlap) continue; // Same route — not a transfer

      const dist = haversineMetres(a.position, b.position);
      if (dist <= maxDistance) {
        transfers.push({
          stopIdA: a.id,
          stopIdB: b.id,
          walkingMeters: Math.round(dist),
        });
      }
    }
  }

  return transfers;
}
