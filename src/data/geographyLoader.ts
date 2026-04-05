import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export interface GeographyFeature {
  code: string;
  name: string;
  coordinates: number[][][]; // array of rings, each ring is [lon,lat][]
}

let cached: GeographyFeature[] | null = null;

export async function loadGeography(): Promise<GeographyFeature[]> {
  if (cached) return cached;

  const resp = await fetch('/data/geography/boundaries.topojson');
  if (!resp.ok) throw new Error(`Failed to load geography: ${resp.status}`);
  const topo = (await resp.json()) as Topology;

  // Get the first object key
  const objectKey = Object.keys(topo.objects)[0];
  if (!objectKey) throw new Error('No objects in TopoJSON');

  const geojson = topojson.feature(
    topo,
    topo.objects[objectKey] as GeometryCollection
  ) as FeatureCollection<Polygon | MultiPolygon>;

  cached = geojson.features.map((f) => {
    const coords =
      f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates.flat()
        : f.geometry.coordinates;
    return {
      code: (f.properties?.code as string) ?? '',
      name: (f.properties?.name as string) ?? '',
      coordinates: coords,
    };
  });

  return cached;
}
