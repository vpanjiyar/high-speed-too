# New Plan: High Speed Too — UK Public Transport Sandbox

## Current Project Status

`high-speed-too` is currently a web-based UK map viewer built with:

- `vite` + TypeScript
- `maplibre-gl` for rendering vector tiles
- `pmtiles` for reading a single static tile archive (`public/tiles/uk.pmtiles`)
- Custom OS-inspired visual style in `src/map-style.ts`
- `scripts/download-tiles.mjs` to fetch and extract UK tiles from Protomaps
- `scripts/diagnostic.mjs` for automated rendering verification

The app launches a single-page map in `index.html`, adds navigation/scale controls, and gracefully warns when the PMTiles file is missing.

## Goal

Evolve this repository from a static UK map demo into a playable UK public transport sandbox with:

- interactive route and stop building
- transport network modelling
- passenger demand / journey planning
- analytics dashboards and mode-share visualization
- offline-friendly data pipeline and export-ready build

## Phase 1: Stabilize Current Web Map Foundation

### Objectives

- Keep the base map working reliably
- Harden tile downloading and runtime error handling
- Add a better visual identity and minimal UI chrome

### Tasks

1. Rename the app from `UK Map` to `High Speed Too`.
2. Improve `README.md` to describe the transport sandbox goal and development flow.
3. Add a lightweight loading indicator or placeholder while tiles hydrate.
4. Improve the missing-tile warning in `index.html`/`style.css` with a direct link to the download step.
5. Add a config layer for optional offline glyph/font hosting and full offline use.
6. Add a small `src/app-state.ts` or `src/ui.ts` module for future UI state.

## Phase 2: Build the Transport Project Skeleton

### Objectives

- Add a simple transport network model in the browser
- Establish a UI for placeable stops and routes
- Keep the implementation web-native, avoiding a rewrite to Godot

### Tasks

1. Define core domain models in `src/model/`:
   - `TransportMode` (`rail`, `metro`, `tram`, `bus`)
   - `Stop` (id, name, location, mode tags)
   - `Route` (id, name, mode, stops, color, frequency)
   - `Network` container for stops/routes and transfer edges
2. Add an interactive overlay canvas or `geojson` layer for stop/route drawing.
3. Implement map click handling in `src/main.ts` for placing stops.
4. Add a simple route builder UI card in `index.html`/`style.css`.
5. Support route editing and deletion, with route rendering as line layers in MapLibre.
6. Add early persistence: save/load network JSON in browser local storage.

## Phase 3: Add UK Reference Data and Map Overlays

### Objectives

- Bring real-world transport context into the map
- Enable future simulation with actual UK geography and stop reference data

### Tasks

1. Add a simple data import pipeline for reference layers:
   - NaPTAN stops/stations
   - OSM/Protomaps roads/rail background layers
   - Optional UK administrative boundaries
2. Add a `data/` folder and processing scripts if needed.
3. Create a `src/data-loader.ts` to fetch local JSON/GeoJSON reference data.
4. Render the real-world reference stops as optional toggleable layers.
5. Add a mode legend and layer toggles in the UI.

## Phase 4: Passenger Demand and Journey Planning

### Objectives

- Simulate demand using simple UK-inspired commuter flows
- Add pathfinding and network usage analytics

### Tasks

1. Build a lightweight demand model in `src/simulation/`:
   - generate trips from synthetic origin/destination zones
   - use population-weighted demand if census-like data is available
2. Implement a browser-friendly journey planner:
   - nearest-stop search
   - route travel-time estimate across stops
   - transfer penalties and mode preferences
3. Add a simple boarding/alighting simulation loop:
   - compute passenger flow counts for each route
   - animate flows on top of the map
4. Expose route performance indicators: ridership, load, estimated travel time.

## Phase 5: Analytics, UI, and Gameplay Features

### Objectives

- Make transport design feel meaningful and strategic
- Provide feedback on network impact and passenger service

### Tasks

1. Add a dashboard panel for:
   - route ridership
   - stop usage
   - network coverage heatmap
   - mode share
2. Add a simple time-of-day control and simulation speed buttons.
3. Add a comparison panel for “before/after” network changes.
4. Add a small “route viability” score for new routes.
5. Add isochrone or catchment visualization if the data model supports it.

## Phase 6: Polish, Build, and Release

### Objectives

- Package the app as a solid static web experience
- Document the data and development flow

### Tasks

1. Finalize `package.json` scripts and Vite settings.
2. Add `npm run build` validation for the transport sandbox.
3. Add automated diagnostics / smoke test coverage using `scripts/diagnostic.mjs`.
4. Document offline requirement for `public/tiles/uk.pmtiles` and HTTP range support.
5. Add `CONTRIBUTING.md` or extend `README.md` with contribution guidance.
6. Consider GitHub Pages / static hosting deployment notes.

## Recommended File Structure Going Forward

```
high-speed-too/
├── public/
│   ├── tiles/uk.pmtiles
│   └── ...
├── scripts/
│   ├── download-tiles.mjs
│   ├── diagnostic.mjs
│   └── ...
├── src/
│   ├── main.ts
│   ├── map-style.ts
│   ├── ui.ts
│   ├── model/
│   ├── simulation/
│   ├── data-loader.ts
│   └── style.css
├── data/          # optional reference data and processed UK layers
├── package.json
├── README.md
└── new_plan.md
```

## Notes

- The current repository is not a Godot project; it is a browser-based MapLibre app.
- The fastest path to progress is to keep the existing `vite` + `maplibre-gl` stack and build the transport sandbox inside that web app.
- `scripts/download-tiles.mjs` and `src/map-style.ts` are strong foundations for a polished UK-themed interface.
