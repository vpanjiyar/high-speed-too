# Plan: High Speed Too — UK Public Transport Simulator

## TL;DR

Build "High Speed Too", a 2D schematic open-source UK public transport sandbox simulator inspired by Subway Builder. Players place routes and stops on a real UK map across four transport modes (heavy rail, metro, tram, bus), with passengers driven by ONS Census 2021 data. Built with **Godot 4** (GDScript + C# for simulation), fully offline, cross-platform desktop.

---

## Architecture Overview

```
high-speed-too/
├── project.godot              # Godot 4 project
├── data/                      # Pre-processed UK data (shipped with game)
│   ├── census/                # ONS Census 2021 population + commute OD
│   ├── geography/             # Simplified UK boundaries (LSOA/MSOA polygons)
│   ├── naptan/                # Stops/stations reference
│   └── osm/                   # Simplified road/rail network geometry
├── scripts/                   # GDScript game logic
│   ├── map/                   # Map rendering, pan/zoom, tile layers
│   ├── network/               # Route/line/stop data model
│   ├── simulation/            # Passenger agent simulation (C# for perf)
│   ├── ui/                    # HUD, panels, analytics dashboards
│   └── data/                  # Data loaders for census/geography
├── tools/                     # Offline data pipeline (Python scripts)
│   ├── census_processor.py    # Download & simplify ONS Census data
│   ├── naptan_processor.py    # Process NaPTAN stops
│   ├── osm_processor.py       # Extract UK geometry from OSM
│   └── geography_processor.py # Simplify boundary shapefiles
├── assets/                    # Sprites, fonts, colors, audio
│   ├── themes/                # Line colors, stop icons per mode
│   └── fonts/
└── export/                    # Export presets for Win/Mac/Linux
```

---

## Phase 1: Data Pipeline & Project Scaffold

**Goal:** Process real UK data into game-ready formats, set up Godot project.

### Steps

1. **Set up Godot 4.3+ project** with C# support. Configure for 2D. Set up export presets for Windows, macOS, Linux.

2. **Build Python data pipeline** (`tools/`) — standalone scripts that run once to produce data files shipped with the game:
   - **census_processor.py**: Download ONS Census 2021 LSOA-level population data + travel-to-work origin-destination matrices from NOMIS. Output as compressed JSON/MessagePack keyed by LSOA code. Include: total population, working population, workplace zone OD flows.
   - **geography_processor.py**: Download and simplify ONS boundary files (LSOA/MSOA polygons). Simplify geometry (Douglas-Peucker) to reduce file size while preserving shape. Output as GeoJSON or custom binary. Target: <50MB for whole UK.
   - **naptan_processor.py**: Download NaPTAN CSV. Extract bus stops, rail stations, tram stops, metro stations. Filter to essential fields (name, lat/lon, type, indicator). Output as compressed CSV/JSON.
   - **osm_processor.py**: Extract simplified coastline, major roads, rivers, rail lines from UK OSM PBF extract (Geofabrik). Output as simplified line geometry for rendering.

3. **Define data schemas**: Document the exact format each processor outputs so the Godot data loaders can parse them.

*Depends on: nothing — can start immediately*

---

## Phase 2: Map Rendering

**Goal:** Render interactive zoomable UK map with census-coloured regions.

### Steps

4. **Implement pan/zoom camera** with smooth scrolling, zoom levels from national overview to street-level. Clamp to UK bounds.

5. **Render UK geography**: Load simplified boundary polygons. Draw LSOA/MSOA regions as filled polygons with edges. Color by population density (heatmap). At low zoom show MSOA, at high zoom show LSOA.

6. **Render base layers**: Coastline, major rivers, motorways, existing rail lines (from OSM data) as background context lines. These are non-interactive — just visual reference.

7. **Render NaPTAN reference layer**: Optionally show existing real-world stops/stations as small dots for reference when building routes.

8. **Implement LOD (Level of Detail)**: At national zoom, show only region outlines + major cities labels. At regional zoom, show detailed boundaries. At city zoom, show individual streets/blocks.

*Depends on: Phase 1 (needs processed data files)*

---

## Phase 3: Network Building

**Goal:** Let players create routes, place stops, and build transport networks.

### Steps

9. **Data model for transport network**:
   - `TransportMode` enum: `HEAVY_RAIL`, `METRO`, `TRAM`, `BUS`
   - `Stop`: name, position, modes served, zone
   - `Route`: name, color, mode, ordered list of stops, frequency (trains/buses per hour)
   - `Line`: collection of routes (e.g. "Northern Line" has multiple branches)
   - `Network`: all lines, stops, connections, transfer points

10. **Stop placement tool**: Click on map to place a stop. Snap to roads (for bus/tram) or free placement (for rail/metro). Shows cost estimate. Different visual per mode (circle=rail, diamond=metro, square=tram, dot=bus).

11. **Route drawing tool**: Select mode → click stops in order to define route. Auto-draw connecting lines (straight for rail, follow roads for bus). Set frequency via slider. Assign color.

12. **Transfer detection**: Automatically detect where stops from different routes/modes are within walking distance (configurable, default 200m). Show transfer indicators.

13. **Network editing**: Delete/move stops, reorder route stops, change frequencies, split/merge routes. Undo/redo system.

14. **Cost model (light)**: Simple cost per km by mode (bus cheapest, metro most expensive). Running costs per vehicle-hour. Revenue from fares. Not a deep economic sim — just enough to show viability.

*Depends on: Phase 2 (needs map rendering to place things on)*

---

## Phase 4: Passenger Simulation Engine (C#)

**Goal:** Simulate realistic UK commuter flows using census data. This is the core differentiator.

### Steps

15. **Population generation**: For each LSOA, generate virtual residents proportional to census population. Assign home location (random point within LSOA polygon). Use OD matrix to assign workplace LSOA. Result: millions of commuter agents with (home, work) pairs.

16. **Gravity model for non-commute trips**: Generate additional trips for shopping, leisure, education using distance-decay model. Weight by population density of destination.

17. **RAPTOR pathfinding**: Implement RAPTOR (Round-bAsed Public Transit Optimized Router) algorithm for multi-modal journey planning:
    - Given (origin, destination, departure_time), find optimal route across all modes
    - Account for: walk to first stop, wait time, ride time, transfer time + walk, ride time, walk from last stop
    - Prefer fewer transfers. Penalize long walks.
    - Cache frequent OD pair results for performance.

18. **Mode choice model**: Each agent decides whether to use public transport based on:
    - Journey time by PT vs. implied car time (based on distance)
    - Frequency of service (high frequency = more attractive)
    - Number of transfers (penalty)
    - Income distribution (from census) — lower income more likely to use PT
    - Simple logit model

19. **Time-of-day simulation**: AM peak (7-9), interpeak, PM peak (17-19), evening. Weight trip generation by time period. Step simulation in 1-minute ticks during active play, with fast-forward.

20. **Vehicle simulation**: Trains/buses/trams move along routes at set speeds. Board/alight passengers at stops. Track occupancy. Show overcrowding.

21. **Performance optimization**: 
    - Spatial indexing (quadtree) for nearest-stop queries
    - Batch pathfinding across agents with same OD zone pair
    - Run simulation on background thread (C#)  
    - Target: simulate 1M+ agents at 60fps with fast-forward

*Depends on: Phase 3 (needs network to route passengers through)*
*RAPTOR implementation is the hardest single component*

---

## Phase 5: Analytics & UI

**Goal:** Provide the in-depth analysis that makes this game compelling.

### Steps

22. **HUD**: Current time, simulation speed controls (pause/1x/2x/4x/8x), active passengers count, revenue/cost ticker.

23. **Network analytics dashboard**:
    - Ridership by route (bar chart)
    - Ridership by stop (table, sortable)
    - Busiest segments (line thickness visualization)
    - Mode share pie chart (rail vs bus vs tram vs metro)
    - Overcrowding alerts

24. **Passenger flow visualization**: Animate dots flowing along routes. Thickness/color of flow lines proportional to passenger volume. Toggle by mode.

25. **Individual commuter inspector**: Click a zone → see sample commuters, their origin, destination, chosen route, journey time, alternatives they rejected and why.

26. **Catchment analysis**: Click a stop → see isochrone (areas reachable within 15/30/45/60 mins). Highlight population served.

27. **Comparison tool**: Before/after metrics when adding a new route. "Adding this bus route would serve X additional passengers and reduce average journey time by Y minutes."

*Depends on: Phase 4 (needs simulation data to display)*

---

## Phase 6: Polish & Release

### Steps

28. **Save/Load**: Serialize entire network + simulation state to JSON file. Auto-save.

29. **Map themes**: Day/night mode. Colorblind-friendly palette. Style inspired by TfL Tube map aesthetics.

30. **Tutorial**: Interactive walkthrough — "Place your first bus stop", "Draw a route", "Watch passengers board".

31. **Sound design**: Ambient city sounds, satisfying clicks for placement, chimes for milestones.

32. **Performance testing**: Profile with full UK dataset. Ensure <2GB RAM, <500MB disk, stable 60fps.

33. **Export & packaging**: Godot export to Win/Mac/Linux executables. Include all data files. Create GitHub release pipeline.

34. **Open source setup**: Choose license (MIT or GPLv3). README, CONTRIBUTING.md, issue templates. Document data pipeline. CI/CD with GitHub Actions for automated builds.

---

## Relevant Files & Technologies

### Tech Stack
- **Engine:** Godot 4.3+ (GDScript for UI/map, C# for simulation engine)
- **Data pipeline:** Python 3.11+ with geopandas, shapely, requests, msgpack
- **Pathfinding:** RAPTOR algorithm (Microsoft Research paper: "Round-Based Public Transit Routing")
- **Data format:** MessagePack or compressed JSON for census/geography, CSV for NaPTAN

### Key Data Sources (all open license)
- **ONS Census 2021** (NOMIS) — population, travel-to-work OD matrices — OGL v3.0
- **ONS Boundary Files** — LSOA/MSOA polygons — OGL v3.0
- **NaPTAN** (DfT) — all UK public transport stops/stations — OGL v3.0
- **OpenStreetMap** (Geofabrik UK extract) — coastline, roads, rivers, rail — ODbL
- **BODS** (DfT) — bus route data for reference — OGL v3.0

### Key Algorithms
- **RAPTOR** pathfinding for multi-modal journey planning
- **Logit mode choice model** for passenger transport decisions
- **Douglas-Peucker** for geometry simplification
- **Quadtree** spatial indexing for agent-stop queries
- **Gravity model** for trip distribution

---

## Verification

1. **Phase 1**: Run each Python processor script → verify output files exist, are valid JSON/CSV, total size <100MB compressed
2. **Phase 2**: Launch Godot project → UK map renders, pan/zoom works, population heatmap visible, zoom from national to city level
3. **Phase 3**: Place 3 bus stops, draw a route, set frequency → route renders on map, stops show mode icon
4. **Phase 4**: Load census data → generate agents → add bus route → verify passengers appear on route, ridership numbers match expectations for corridor population
5. **Phase 5**: Open analytics dashboard → verify ridership chart, passenger flow overlay, commuter inspector all show data
6. **Phase 6**: Export to Windows → install on clean machine → full gameplay loop works offline with no server
7. **Overall**: `git clone` → run data pipeline → open in Godot → build → play. Document this in README.

---

## Decisions

- **Godot 4 over Unity/Unreal**: Fully open-source (MIT), lightweight, excellent 2D, free forever. Aligns with open-source goal.
- **C# for simulation**: GDScript is too slow for millions of agents. C# in Godot gives .NET performance with engine integration. Alternative: GDExtension in Rust/C++ if C# insufficient.
- **LSOA granularity**: ~35,000 zones for England & Wales. Fine enough for realistic simulation, coarse enough for performance. MSOA (~7,000) as fallback if too heavy.
- **Census 2021 over 2011**: Most recent data, though travel-to-work patterns may be post-COVID (more WFH). Acceptable trade-off.
- **No server dependency**: All data pre-processed and shipped. No API calls at runtime. Map tiles from pre-processed OSM, not web tile servers.
- **Sandbox only**: No scenarios/campaigns. Players have full freedom. Simplifies scope significantly.
- **Schematic 2D style**: Reduces art requirements dramatically. One person can build this. Inspired by Mini Metro / TfL map aesthetics.
- **Four modes at launch**: Heavy rail, metro, tram, bus. Coaches and ferries excluded from v1.
- **Light cost model**: Not a business/management sim. Costs exist to ground decisions but aren't the focus.

---

## Further Considerations

1. **Scotland & Northern Ireland census data**: ONS Census 2021 covers England & Wales. Scotland uses NRS (National Records of Scotland) with different formats. Northern Ireland uses NISRA. The data pipeline will need separate processors for each. Recommendation: start with England & Wales, add Scotland/NI in a follow-up.

2. **Game name / HS2 reference**: The name "High Speed Too" is a great pun. Consider a tagline like "The transport network the UK actually needs" to lean into the satirical angle. The loading screen could show real HS2 cost overrun stats.

3. **Multiplayer / sharing**: Even as single-player, consider early design for network export/import so players can share their creations (JSON files). This is essentially free with the save system.
