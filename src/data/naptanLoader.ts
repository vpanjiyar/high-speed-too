import type { NaPTANStop } from '../types';

let cached: NaPTANStop[] | null = null;

export async function loadNaPTAN(): Promise<NaPTANStop[]> {
  if (cached) return cached;
  const resp = await fetch('/data/naptan/stops.json');
  if (!resp.ok) throw new Error(`Failed to load NaPTAN: ${resp.status}`);
  cached = (await resp.json()) as NaPTANStop[];
  return cached;
}
