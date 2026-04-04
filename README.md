# High Speed Too 🚄

An open-source UK public transport simulation game. Build bus, tram, metro, and intercity rail networks across the whole of Great Britain and Northern Ireland, powered by real census data and realistic passenger simulation.

*Inspired by [Subway Builder](https://store.steampowered.com/app/Subway_Builder/) — but for the UK, and with the full spectrum of public transport.*

> The name is a gentle nod to [HS2](https://en.wikipedia.org/wiki/High_Speed_2).

## Features

- **Four transport modes**: Heavy rail, metro/underground, tram/light rail, and bus
- **Real UK geography**: Coastline, cities, and regions rendered on a 2D schematic map
- **Census-driven simulation**: 33,755 LSOAs with population data and commuter origin–destination flows
- **RAPTOR pathfinding**: Multi-modal journey planning with transfers (Microsoft Research algorithm)
- **Mode choice model**: Logit-based passenger decision-making — journey time, frequency, transfers, cost
- **Sandbox gameplay**: Build freely, analyse ridership, optimise your network
- **Fully offline**: All data bundled — no server dependency
- **Open source**: MIT licence

## Getting Started

### Prerequisites

- [Godot 4.3+](https://godotengine.org/download) (.NET edition — includes C# support)
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Python 3.10+](https://www.python.org/downloads/) (for data pipeline only)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/high-speed-too.git
   cd high-speed-too
   ```

2. **Generate game data** (one-time)
   ```bash
   cd tools
   pip install -r requirements.txt
   python run_pipeline.py
   cd ..
   ```

3. **Open in Godot**
   - Launch Godot (.NET edition)
   - Click "Import" and select the `project.godot` file
   - Press F5 to run

### Controls

| Action | Input |
|--------|-------|
| Pan map | WASD or middle-mouse drag |
| Zoom | Scroll wheel |
| Place stop | Select mode + stop tool, click map |
| Draw route | Select mode + route tool, click stops, right-click to finish |
| Select/move | Select tool, click elements |

## Architecture

```
high-speed-too/
├── project.godot          # Godot project config
├── HighSpeedToo.csproj    # C# project (simulation engine)
├── scenes/
│   └── main.tscn          # Main game scene
├── scripts/
│   ├── main.gd            # Game controller (GDScript)
│   ├── map/
│   │   └── map_camera.gd  # Pan & zoom camera
│   └── simulation/        # C# simulation engine
│       ├── SimulationEngine.cs   # Core tick loop & agent management
│       ├── RaptorRouter.cs       # RAPTOR pathfinding algorithm
│       ├── ModeChoiceModel.cs    # Logit mode choice
│       ├── QuadTree.cs           # Spatial index
│       └── DataModels.cs         # Structs & classes
├── tools/                 # Python data pipeline
│   ├── run_pipeline.py
│   ├── census_processor.py
│   ├── geography_processor.py
│   ├── naptan_processor.py
│   └── requirements.txt
├── data/                  # Generated game data (git-ignored)
│   ├── census/
│   ├── geography/
│   └── naptan/
└── assets/
    └── icon.svg
```

## How It Works

### Passenger Simulation

1. **Census data** provides population per zone (LSOA) and commuter flows between zones
2. **Agent generation** creates scaled passenger agents from origin–destination matrix
3. Each game tick, agents decide whether to travel based on time of day
4. **RAPTOR** finds the fastest multi-modal route (bus → walk → metro → rail, etc.)
5. **Mode choice model** determines if each agent actually uses PT or drives
6. Ridership statistics feed back into the analytics panel

### RAPTOR Algorithm

Round-based pathfinding that naturally handles multi-modal transfers:
- Round 1: Direct routes (no transfer)
- Round 2: One transfer
- Round 3+: Two or more transfers
- Walking transfers propagated between rounds

### Mode Choice

Multinomial logit model weighing:
- Total journey time
- Wait time (half headway)
- Number of transfers
- Walk access/egress time
- Mode-specific attractiveness (rail > metro > tram > bus)
- Competing car journey time and cost

## Data Sources

| Dataset | Source | Licence |
|---------|--------|---------|
| Population by LSOA | [ONS Census 2021](https://www.nomisweb.co.uk/) | OGL v3 |
| Commuter flows | [ONS Origin–Destination](https://www.nomisweb.co.uk/) | OGL v3 |
| Transport stops | [NaPTAN](https://data.gov.uk/dataset/naptan) | OGL v3 |
| Coastline/boundaries | [OS Open Data](https://osdatahub.os.uk/) | OGL v3 |

*The data pipeline generates synthetic data by default. Pass `--real` to download from source.*

## Contributing

Contributions welcome! See the architecture overview above and the issues tab.

```bash
# Run the data pipeline
cd tools && python run_pipeline.py

# Open in Godot and iterate
```

## Licence

MIT — see [LICENCE](LICENCE).

## Acknowledgements

- **Subway Builder** for the gameplay inspiration
- **ONS** for open census data
- **DfT** for NaPTAN transport data
- **Microsoft Research** for the RAPTOR algorithm paper
- **Godot Engine** community
