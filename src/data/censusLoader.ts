import type { CensusData } from '../types';

let cached: CensusData | null = null;

export async function loadCensusData(): Promise<CensusData> {
  if (cached) return cached;
  const resp = await fetch('/data/census/census.json');
  if (!resp.ok) throw new Error(`Failed to load census data: ${resp.status}`);
  cached = (await resp.json()) as CensusData;
  return cached;
}
