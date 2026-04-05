# High Speed Too

A prototype of the UK transport sandbox project "High Speed Too".

This repo currently provides an interactive UK map demo with rail infrastructure overlays and Census 2021 data. The broader objective is to build an open-source, offline-capable UK public transport simulator inspired by Subway Builder, where players can place routes and stops across multiple modes and serve passenger demand driven by real census data.

- **Objective**: build an open-source UK transport sandbox that combines real-world geography, ONS Census population data, and public transport network design.
- **Prototype**: web-based MapLibre demo showing UK vector tiles, national rail and metro/tram lines, station points, and census overlays for population, density, and working-age population.
- **Data**: OpenStreetMap via Protomaps (ODbL licence), plus processed UK boundaries from ONS.

## Project objective

The long-term goal for `High Speed Too` is:

- a 2D schematic UK public transport sandbox simulator
- support for heavy rail, metro, tram, and bus networks
- passenger demand driven by ONS Census 2021 data
- offline desktop delivery with all data shipped locally
- open-source development and a transparent data pipeline

This repo is an early stage proof-of-concept for the map and data overlay layer that will support the eventual simulator.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Download UK tile data

This fetches only the UK region (~150–300 MB) from the Protomaps planet file using HTTP range-requests.

```bash
npm run download-tiles
```

The tile file is saved to `public/tiles/uk.pmtiles`.

> **Manual alternative** – if the script fails, install the
> [pmtiles CLI](https://github.com/protomaps/go-pmtiles/releases) and run:
> ```bash
> pmtiles extract https://build.protomaps.com/20250401.pmtiles public/tiles/uk.pmtiles --bbox=-10.6,49.8,1.8,60.9
> ```
> Replace `20250401` with the latest build date.

### 3. Start the dev server

```bash
npm run dev
```

Open http://localhost:5173 to view the prototype.

## Features

- UK-wide vector tile basemap using `pmtiles`
- Toggleable national rail, metro/tram lines, and station overlays
- Interactive Census overlay with:
  - population
  - density
  - working-age percentage
- Zoom hotlinks for UK, region, city, and street levels

## Data pipeline

This repository contains tools to process additional UK transport and census data.

- `npm run census` — run `tools/census_processor.py`
- `npm run geography` — run `tools/geography_processor.py --merge-census`
- `npm run naptan` — run `tools/naptan_processor.py`
- `npm run rail-lines` — run `tools/rail_lines_processor.py`
- `npm run census-merge` — run `npm run census && npm run geography`

The `public/data/` folder holds preprocessed boundary data used by the census overlay.

## Production build

```bash
npm run build
```

Copy `public/tiles/uk.pmtiles` into the same folder as the generated `dist/` assets.

## Hosting notes

- The `.pmtiles` file must be served with **HTTP range-request support**.
- Glyphs are loaded from `protomaps.github.io`. To go fully offline, download the fonts from
  https://github.com/protomaps/basemaps-assets and update `src/map-style.ts`.

## Licence

Map data © [OpenStreetMap contributors](https://openstreetmap.org/copyright), ODbL.  
Basemap tiles © [Protomaps](https://protomaps.com).
