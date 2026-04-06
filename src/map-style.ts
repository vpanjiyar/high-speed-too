import type { StyleSpecification, LayerSpecification, ExpressionSpecification, Map as MaplibreMap } from 'maplibre-gl';

// ── OS-inspired colour palette ───────────────────────────────────────────────
const C = {
  // Land & surface
  land:           '#F4EFE0',
  ocean:          '#B0CCDF',
  water:          '#AFC8DC',
  beach:          '#F2E0B8',
  wetland:        '#C8DCC8',

  // Landcover
  forest:         '#C3D69F',
  grass:          '#DCE9BE',
  park:           '#C8E4B0',
  nationalPark:   '#BFE0A8',
  farmland:       '#EDE8D8',
  urban:          '#E4DDD0',

  // Rail infrastructure — line types by mode
  railMainline:        '#1A1A2A',
  railMainlineCasing:  '#6B7280',
  railMetro:           '#003087',
  railMetroCasing:     '#1D4ED8',
  railLightRail:       '#7C3AED',
  railLightCasing:     '#A78BFA',
  railHeritage:        '#92400E',
  railService:         '#9CA3AF',
  railTunnel:          '#94A3B8',

  // Stations (dots)
  stationMainline:     '#0F172A',
  stationMetro:        '#003087',
  stationTram:         '#7C3AED',

  // Buildings
  building:       '#DAD0BE',
  buildingOutline:'#C2B59E',

  // Labels
  label:          '#1A1A2E',
  labelHalo:      'rgba(255, 252, 244, 0.85)',
  streetLabel:    '#3A3A4A',
  streetHalo:     'rgba(255, 252, 244, 0.75)',
  waterLabel:     '#1E5C96',
  waterLabelHalo: 'rgba(175, 200, 220, 0.65)',
  naturalLabel:   '#3C5C28',
  naturalHalo:    'rgba(244, 239, 224, 0.7)',

  // Administrative boundaries
  boundary:       '#BF8060',
  boundaryRegion: '#D4A880',
};


// ── Helpers ──────────────────────────────────────────────────────────────────
// MapLibre's ['match', expr, [values...], true, false] is the idiomatic
// way to test set-membership in filter expressions.
function kindIs(...kinds: string[]): ExpressionSpecification {
  return ['match', ['get', 'kind'], kinds, true, false] as unknown as ExpressionSpecification;
}
function kindDetailIs(...kd: string[]): ExpressionSpecification {
  return ['match', ['get', 'kind_detail'], kd, true, false] as unknown as ExpressionSpecification;
}

const nameExpr = ['coalesce', ['get', 'name:en'], ['get', 'name']] as unknown as ExpressionSpecification;

// ── Style factory ─────────────────────────────────────────────────────────────
export function mapStyle(tilesUrl: string): StyleSpecification {
  const src = 'protomaps';

  const layers: LayerSpecification[] = [
    // ── 1. Background ─────────────────────────────────────────────────────
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': C.ocean },
    },

    // ── 2. Land ───────────────────────────────────────────────────────────
    {
      id: 'earth-fill',
      type: 'fill',
      source: src,
      'source-layer': 'earth',
      paint: { 'fill-color': C.land },
    },

    // ── 3. Water (polygons) ───────────────────────────────────────────────
    {
      id: 'ocean-fill',
      type: 'fill',
      source: src,
      'source-layer': 'water',
      filter: kindIs('ocean', 'other'),
      paint: { 'fill-color': C.ocean },
    },
    {
      id: 'water-fill',
      type: 'fill',
      source: src,
      'source-layer': 'water',
      filter: kindIs('lake', 'water'),
      paint: { 'fill-color': C.water },
    },

    // ── 4. Landcover ──────────────────────────────────────────────────────
    // minzoom: 8 — at the effective minimum zoom (~6.5, constrained by maxBounds
    // on a wide viewport) the tiles include European continental data
    // (Netherlands, Belgium etc.) which renders large green blobs that look like
    // fictitious landmasses. Schematic mode hides these layers entirely; using
    // minzoom: 8 ensures both modes are consistent at low zoom. At zoom 8 the
    // viewport is ≤10° wide so the continental coast is no longer visible.
    {
      id: 'landcover-forest',
      type: 'fill',
      source: src,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'kind'], 'forest'],
      minzoom: 8,
      paint: { 'fill-color': C.forest, 'fill-opacity': 0.75 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: src,
      'source-layer': 'landcover',
      filter: kindIs('grassland', 'farmland'),
      minzoom: 8,
      paint: { 'fill-color': C.grass, 'fill-opacity': 0.5 },
    },

    // ── 5. Landuse ────────────────────────────────────────────────────────
    // Same minzoom rationale as landcover above.
    {
      id: 'landuse-national-park',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('national_park', 'protected_area', 'nature_reserve'),
      minzoom: 8,
      paint: { 'fill-color': C.nationalPark, 'fill-opacity': 0.6 },
    },
    {
      id: 'landuse-park',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('park', 'garden', 'recreation_ground', 'playground', 'pitch'),
      minzoom: 10,
      paint: { 'fill-color': C.park, 'fill-opacity': 0.7 },
    },
    {
      id: 'landuse-forest',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('forest', 'wood'),
      minzoom: 8,
      paint: { 'fill-color': C.forest, 'fill-opacity': 0.8 },
    },
    {
      id: 'landuse-grass',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('grass', 'meadow', 'farmland', 'farmyard', 'orchard'),
      minzoom: 9,
      paint: { 'fill-color': C.farmland, 'fill-opacity': 0.55 },
    },
    {
      id: 'landuse-beach',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('beach', 'sand', 'bare_rock'),
      minzoom: 9,
      paint: { 'fill-color': C.beach, 'fill-opacity': 0.9 },
    },
    {
      id: 'landuse-wetland',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('wetland'),
      minzoom: 8,
      paint: { 'fill-color': C.wetland, 'fill-opacity': 0.75 },
    },
    {
      id: 'landuse-urban',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('commercial', 'industrial', 'residential', 'university', 'college', 'school', 'hospital'),
      minzoom: 9,
      paint: { 'fill-color': C.urban, 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-pedestrian',
      type: 'fill',
      source: src,
      'source-layer': 'landuse',
      filter: kindIs('pedestrian', 'footway'),
      minzoom: 12,
      paint: { 'fill-color': '#EDE8DC', 'fill-opacity': 0.85 },
    },

    // ── 6. Water lines (rivers) ───────────────────────────────────────────
    {
      id: 'water-line',
      type: 'line',
      source: src,
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': C.water,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          8, 0.8, 12, 2, 16, 5],
      },
    },

    // ── 7. Admin boundaries ───────────────────────────────────────────────
    {
      id: 'boundary-region',
      type: 'line',
      source: src,
      'source-layer': 'boundaries',
      filter: kindIs('region', 'county'),
      paint: {
        'line-color': C.boundaryRegion,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 10, 1],
        'line-dasharray': [4, 4],
        'line-opacity': 0.6,
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: src,
      'source-layer': 'boundaries',
      filter: kindIs('country'),
      paint: {
        'line-color': C.boundary,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 2, 12, 3],
        'line-dasharray': [5, 3],
        'line-opacity': 0.8,
      },
    },

    // ── 8. Rail infrastructure ────────────────────────────────────────────
    // National rail lines from GeoJSON — visible at every zoom level.
    // Source: run `npm run rail-lines` to populate public/data/rail_lines.geojson
    {
      id: 'rail-overview-casing',
      type: 'line',
      source: 'rail-network',
      minzoom: 0,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.railMainlineCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          0, 0.3, 4, 1.5, 7, 3, 10, 6, 14, 10, 18, 15],
      },
    },
    {
      id: 'rail-overview',
      type: 'line',
      source: 'rail-network',
      filter: ['!=', ['get', 'tunnel'], true],
      minzoom: 0,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.railMainline,
        'line-width': ['interpolate', ['linear'], ['zoom'],
          0, 0.15, 4, 0.8, 7, 1.5, 10, 3, 14, 6, 18, 10],
      },
    },
    // Tunnelled national rail — dashed overlay
    {
      id: 'rail-overview-tunnel',
      type: 'line',
      source: 'rail-network',
      filter: ['==', ['get', 'tunnel'], true],
      minzoom: 4,
      paint: {
        'line-color': C.railTunnel,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 7, 1.5, 12, 3, 16, 6],
        'line-dasharray': [4, 4],
        'line-opacity': 0.7,
      },
    },
    // City metro / subway / elevated light rail — casing
    {
      id: 'rail-light-casing',
      type: 'line',
      source: src,
      'source-layer': 'roads',
      filter: ['all', kindIs('rail'), kindDetailIs('subway', 'light_rail')],
      minzoom: 6,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.railLightCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 5, 14, 9, 18, 14],
      },
    },
    {
      id: 'rail-light',
      type: 'line',
      source: src,
      'source-layer': 'roads',
      filter: ['all', kindIs('rail'), kindDetailIs('subway', 'light_rail')],
      minzoom: 6,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.railMetro,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 3, 14, 6, 18, 10],
      },
    },
    // Street trams (city metro group)
    {
      id: 'rail-tram',
      type: 'line',
      source: src,
      'source-layer': 'roads',
      filter: ['all', kindIs('rail'), kindDetailIs('tram')],
      minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.railLightRail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 12, 2.5, 16, 5],
      },
    },
    // Heritage / preserved / funicular / monorail
    {
      id: 'rail-heritage',
      type: 'line',
      source: src,
      'source-layer': 'roads',
      filter: ['all', kindIs('rail'), kindDetailIs('preserved', 'funicular', 'monorail')],
      minzoom: 8,
      paint: {
        'line-color': C.railHeritage,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 12, 2.5, 16, 5],
        'line-dasharray': [8, 3],
      },
    },
    // Service / freight sidings — subtle, high zoom only
    {
      id: 'rail-service',
      type: 'line',
      source: src,
      'source-layer': 'roads',
      filter: kindIs('service_rail'),
      minzoom: 12,
      paint: {
        'line-color': C.railService,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2, 18, 4],
        'line-dasharray': [3, 2],
      },
    },




    // ── 12. Buildings ─────────────────────────────────────────────────────
    {
      id: 'building-fill',
      type: 'fill',
      source: src,
      'source-layer': 'buildings',
      filter: ['==', ['get', 'kind'], 'building'],
      minzoom: 14,
      paint: {
        'fill-color': C.building,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.85],
      },
    },
    {
      id: 'building-outline',
      type: 'line',
      source: src,
      'source-layer': 'buildings',
      filter: ['==', ['get', 'kind'], 'building'],
      minzoom: 14,
      paint: {
        'line-color': C.buildingOutline,
        'line-width': 0.6,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1],
      },
    },

    // ── 13. Water labels ──────────────────────────────────────────────────
    {
      id: 'water-label-line',
      type: 'symbol',
      source: src,
      'source-layer': 'water',
      filter: ['all', ['has', 'name'], ['==', ['geometry-type'], 'LineString']],
      minzoom: 5,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13, 14, 16],
        'text-max-width': 8,
        'symbol-placement': 'line',
      },
      paint: {
        'text-color': C.waterLabel,
        'text-halo-color': C.waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water-label-point',
      type: 'symbol',
      source: src,
      'source-layer': 'water',
      filter: ['all', ['has', 'name'], ['!=', ['geometry-type'], 'LineString']],
      minzoom: 5,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13, 14, 16],
        'text-max-width': 8,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': C.waterLabel,
        'text-halo-color': C.waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },

    // ── 14. Rail line / station name labels ─────────────────────────────
    {
      id: 'rail-label',
      type: 'symbol',
      source: src,
      'source-layer': 'roads',
      filter: ['all',
        kindIs('rail'),
        kindDetailIs('rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'),
        ['has', 'name'],
      ],
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': nameExpr,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 17, 12],
        'text-max-angle': 30,
        'symbol-spacing': 500,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': C.railMainline,
        'text-halo-color': 'rgba(255, 252, 244, 0.9)',
        'text-halo-width': 2,
      },
    },

    // ── 15. POI labels ────────────────────────────────────────────────────
    {
      id: 'poi-landmark',
      type: 'symbol',
      source: src,
      'source-layer': 'pois',
      filter: kindIs(
        'landmark', 'monument', 'memorial', 'artwork', 'attraction',
        'viewpoint', 'castle', 'ruins', 'information',
        'museum', 'theatre', 'library', 'townhall',
        'stadium', 'national_park', 'nature_reserve',
      ),
      minzoom: 12,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 14],
        'text-max-width': 9,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'icon-allow-overlap': false,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': C.naturalLabel,
        'text-halo-color': C.naturalHalo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'poi-transit',
      type: 'symbol',
      source: src,
      'source-layer': 'pois',
      filter: kindIs('station'),
      minzoom: 9,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 17, 13],
        'text-max-width': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'poi-general',
      type: 'symbol',
      source: src,
      'source-layer': 'pois',
      filter: ['all',
        ['has', 'name'],
        ['!', kindIs(
          'landmark', 'monument', 'memorial', 'artwork', 'attraction', 'viewpoint',
          'castle', 'ruins', 'information', 'museum', 'theatre', 'library', 'townhall',
          'stadium', 'national_park', 'nature_reserve', 'station', 'bus_stop',
          'aerodrome', 'airfield',
        )],
      ],
      minzoom: 15,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-max-width': 8,
        'text-anchor': 'top',
        'text-offset': [0, 0.3],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.5,
      },
    },

    // ── 16. NaPTAN station markers ─────────────────────────────────────────
    // Generated by `npm run naptan` → public/data/stations.geojson
    // Mainline rail stations (RLY) — visible from zoom 5
    {
      id: 'naptan-station-mainline',
      type: 'circle',
      source: 'naptan',
      filter: ['==', ['get', 'stopType'], 'RLY'],
      minzoom: 5,
      paint: {
        'circle-color': C.stationMainline,
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          5, 1.5, 8, 3, 12, 5, 16, 8],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.5, 14, 2],
      },
    },
    // Metro / LRT / underground stations (MET)
    {
      id: 'naptan-station-metro',
      type: 'circle',
      source: 'naptan',
      filter: ['==', ['get', 'stopType'], 'MET'],
      minzoom: 7,
      paint: {
        'circle-color': C.stationMetro,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 4, 16, 7],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1.5,
      },
    },
    // Mainline station labels
    {
      id: 'naptan-label-mainline',
      type: 'symbol',
      source: 'naptan',
      filter: ['==', ['get', 'stopType'], 'RLY'],
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 8, 12, 11, 16, 14],
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-max-width': 10,
        'text-optional': true,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': C.stationMainline,
        'text-halo-color': 'rgba(255, 252, 244, 0.95)',
        'text-halo-width': 2,
      },
    },
    // Metro / LRT station labels
    {
      id: 'naptan-label-metro',
      type: 'symbol',
      source: 'naptan',
      filter: ['==', ['get', 'stopType'], 'MET'],
      minzoom: 10,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 12],
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-max-width': 10,
        'text-optional': true,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': C.stationMetro,
        'text-halo-color': 'rgba(255, 252, 244, 0.95)',
        'text-halo-width': 2,
      },
    },

    // ── 17. Place labels ──────────────────────────────────────────────────
    {
      id: 'place-country',
      type: 'symbol',
      source: src,
      'source-layer': 'places',
      filter: kindIs('country'),
      maxzoom: 7,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 6, 16],
        'text-letter-spacing': 0.08,
        'text-transform': 'uppercase',
        'text-max-width': 10,
      },
      paint: {
        'text-color': '#1A1A2E',
        'text-halo-color': 'rgba(255,252,244,0.8)',
        'text-halo-width': 2,
      },
    },
    {
      id: 'place-region',
      type: 'symbol',
      source: src,
      'source-layer': 'places',
      filter: kindIs('region'),
      minzoom: 5,
      maxzoom: 10,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 15],
        'text-letter-spacing': 0.05,
        'text-transform': 'uppercase',
        'text-max-width': 10,
      },
      paint: {
        'text-color': '#2A2A3E',
        'text-halo-color': 'rgba(255,252,244,0.8)',
        'text-halo-width': 2,
      },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: src,
      'source-layer': 'places',
      filter: ['all',
        kindIs('locality'),
        kindDetailIs('city', 'town'),
      ],
      minzoom: 5,
      layout: {
        'text-field': nameExpr,
        'text-font': [
          'match', ['get', 'kind_detail'],
          'city', ['literal', ['Noto Sans Medium']],
          ['literal', ['Noto Sans Regular']],
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'],
          5, ['match', ['get', 'kind_detail'], 'city', 11, 9],
          10, ['match', ['get', 'kind_detail'], 'city', 16, 14],
          14, ['match', ['get', 'kind_detail'], 'city', 20, 17],
        ],
        'text-max-width': 10,
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 2,
      },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: src,
      'source-layer': 'places',
      filter: ['all',
        kindIs('locality'),
        kindDetailIs('village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'),
      ],
      minzoom: 9,
      layout: {
        'text-field': nameExpr,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13],
        'text-max-width': 10,
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.5,
      },
    },
  ];

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tilesUrl}`,
        attribution:
          '© <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a> contributors · ' +
          '<a href="https://protomaps.com" target="_blank">Protomaps</a>',
      },
      // NaPTAN station data — run `npm run naptan` to generate public/data/stations.geojson
      naptan: {
        type: 'geojson',
        data: '/data/stations.geojson',
      },
      // UK national rail network — run `npm run rail-lines` to generate public/data/rail_lines.geojson
      'rail-network': {
        type: 'geojson',
        data: '/data/rail_lines.geojson',
      },
    },
    layers,
  };
}

// ── Schematic (Mini Metro) mode ───────────────────────────────────────────────
// Hides all decorative geography and simplifies the base map to a clean
// black-and-white outline — just coastline + city labels — so the user's
// custom rail network reads like an abstract transit diagram.

const SCHEMATIC_HIDDEN_LAYERS: string[] = [
  // Landcover
  'landcover-forest', 'landcover-grass',
  // Landuse
  'landuse-national-park', 'landuse-park', 'landuse-forest', 'landuse-grass',
  'landuse-beach', 'landuse-wetland', 'landuse-urban', 'landuse-pedestrian',
  // Water lines
  'water-line',
  // Buildings
  'building-fill', 'building-outline',
  // Water labels
  'water-label-line', 'water-label-point',
  // Non-transit POI — transit POIs stay under the "Stations" overlay toggle
  'poi-landmark', 'poi-general',
  // Minor place labels
  'place-village',
  // Sub-national boundaries
  'boundary-region',
  // NOTE: rail infrastructure and station layers (rail-overview-*, naptan-*, etc.)
  // are deliberately excluded — they remain under the Overlays panel toggles in
  // both detailed and schematic mode.
];

interface PaintTweak {
  layerId: string;
  property: string;
  schematic: unknown;
  detailed: unknown;
}

const SCHEMATIC_PAINT_TWEAKS: PaintTweak[] = [
  // Background → off-white instead of ocean blue
  { layerId: 'background',   property: 'background-color', schematic: '#EBEBEB', detailed: C.ocean },
  // Land → pure white
  { layerId: 'earth-fill',   property: 'fill-color',       schematic: '#FFFFFF', detailed: C.land  },
  // Ocean / lakes → mid grey
  { layerId: 'ocean-fill',   property: 'fill-color',       schematic: '#D4D4D4', detailed: C.ocean },
  { layerId: 'water-fill',   property: 'fill-color',       schematic: '#D4D4D4', detailed: C.water },
  // Country border → solid thin grey line
  { layerId: 'boundary-country', property: 'line-color',   schematic: '#AAAAAA', detailed: C.boundary },
  { layerId: 'boundary-country', property: 'line-opacity', schematic: 1,         detailed: 0.8 },
  { layerId: 'boundary-country', property: 'line-width',
    schematic: ['interpolate', ['linear'], ['zoom'], 3, 0.5, 6, 1, 12, 1.5],
    detailed:  ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 2, 12, 3],
  },
  // Place labels → greyscale
  { layerId: 'place-country', property: 'text-color',      schematic: '#555555', detailed: '#1A1A2E' },
  { layerId: 'place-country', property: 'text-halo-color', schematic: 'rgba(255,255,255,0.9)', detailed: 'rgba(255,252,244,0.8)' },
  { layerId: 'place-region',  property: 'text-color',      schematic: '#888888', detailed: '#2A2A3E' },
  { layerId: 'place-region',  property: 'text-halo-color', schematic: 'rgba(255,255,255,0.9)', detailed: 'rgba(255,252,244,0.8)' },
  { layerId: 'place-city',    property: 'text-color',      schematic: '#222222', detailed: C.label  },
  { layerId: 'place-city',    property: 'text-halo-color', schematic: 'rgba(255,255,255,0.9)', detailed: C.labelHalo },
];

/**
 * Toggle the map between detailed (OS-style) and schematic (Mini Metro-style) views.
 * All custom GeoJSON layers (user network, census) are unaffected.
 */
export function applySchematicMode(map: MaplibreMap, enabled: boolean): void {
  const visibility = enabled ? 'none' : 'visible';
  for (const id of SCHEMATIC_HIDDEN_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'visibility', visibility);
  }
  for (const tweak of SCHEMATIC_PAINT_TWEAKS) {
    if (!map.getLayer(tweak.layerId)) continue;
    map.setPaintProperty(tweak.layerId, tweak.property, enabled ? tweak.schematic : tweak.detailed);
  }
}
