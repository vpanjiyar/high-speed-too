import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, LineString, MultiLineString } from 'geojson';

export interface OSMLineFeature {
  type: string; // 'coastline', 'river', 'motorway', 'rail'
  coordinates: number[][]; // [lon, lat][]
}

let cached: OSMLineFeature[] | null = null;

export async function loadOSMData(): Promise<OSMLineFeature[]> {
  if (cached) return cached;

  const resp = await fetch('/data/osm/basemap.topojson');
  if (!resp.ok) throw new Error(`Failed to load OSM data: ${resp.status}`);
  const topo = (await resp.json()) as Topology;

  const features: OSMLineFeature[] = [];

  for (const key of Object.keys(topo.objects)) {
    const geojson = topojson.feature(
      topo,
      topo.objects[key] as GeometryCollection
    ) as FeatureCollection<LineString | MultiLineString>;

    for (const f of geojson.features) {
      const coords =
        f.geometry.type === 'MultiLineString'
          ? f.geometry.coordinates.flat()
          : f.geometry.coordinates;
      features.push({
        type: (f.properties?.type as string) ?? key,
        coordinates: coords,
      });
    }
  }

  cached = features;
  return cached;
}
