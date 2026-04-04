using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading.Tasks;

namespace HighSpeedToo.Simulation;

/// <summary>
/// Core simulation engine. Manages passenger agents, pathfinding, and
/// mode choice. Runs on a background thread for performance.
/// </summary>
public partial class SimulationEngine : Node
{
    // ── Signals ──────────────────────────────────────────
    [Signal] public delegate void SimulationTickedEventHandler(int totalPassengers, int activePassengers);
    [Signal] public delegate void PassengerBoardedEventHandler(int routeId, int stopId);

    // ── Configuration ────────────────────────────────────
    [Export] public int TicksPerGameMinute { get; set; } = 1;
    [Export] public float SimulationSpeed { get; set; } = 1.0f;

    // ── State ────────────────────────────────────────────
    public bool IsRunning { get; private set; }
    public int CurrentTimeMinutes { get; private set; } = 420; // 07:00
    public int TotalAgents => _agents.Count;
    public int ActivePassengers => _activePassengers;

    private readonly List<PassengerAgent> _agents = new();
    private readonly List<TransportRoute> _routes = new();
    private readonly List<TransportStop> _stops = new();
    private readonly Dictionary<string, Zone> _zones = new();
    private readonly List<ODFlow> _odFlows = new();

    private int _activePassengers;
    private readonly Random _rng = new(42);
    private QuadTree? _stopIndex;

    // ── Lifecycle ────────────────────────────────────────

    public override void _Ready()
    {
        GD.Print("SimulationEngine ready.");
    }

    public override void _Process(double delta)
    {
        if (!IsRunning) return;

        // Advance simulation time
        CurrentTimeMinutes += (int)(delta * SimulationSpeed * 10);
        if (CurrentTimeMinutes >= 1440)
            CurrentTimeMinutes -= 1440;

        // Process agent decisions
        ProcessAgentTick();
    }

    // ── Data Loading ─────────────────────────────────────

    /// <summary>
    /// Load census population data from processed JSON.
    /// </summary>
    public void LoadPopulationData(string path)
    {
        if (!FileAccess.FileExists(path))
        {
            GD.PrintErr($"Population data not found: {path}");
            return;
        }

        try
        {
            string jsonText = ReadGzippedJson(path);
            using var doc = JsonDocument.Parse(jsonText);
            var root = doc.RootElement;

            if (root.TryGetProperty("lsoas", out var lsoasArray))
            {
                foreach (var lsoa in lsoasArray.EnumerateArray())
                {
                    var zone = new Zone
                    {
                        Code = lsoa.GetProperty("code").GetString() ?? "",
                        Name = lsoa.GetProperty("name").GetString() ?? "",
                        Population = lsoa.GetProperty("population").GetInt32(),
                        WorkingPopulation = lsoa.GetProperty("working_pop").GetInt32(),
                        Longitude = lsoa.GetProperty("lon").GetDouble(),
                        Latitude = lsoa.GetProperty("lat").GetDouble(),
                    };
                    _zones[zone.Code] = zone;
                }
            }

            GD.Print($"Loaded {_zones.Count} zones, total pop: {GetTotalPopulation():N0}");
        }
        catch (Exception ex)
        {
            GD.PrintErr($"Failed to load population data: {ex.Message}");
        }
    }

    /// <summary>
    /// Load origin-destination commuter matrix.
    /// </summary>
    public void LoadODMatrix(string path)
    {
        if (!FileAccess.FileExists(path))
        {
            GD.PrintErr($"OD matrix not found: {path}");
            return;
        }

        try
        {
            string jsonText = ReadGzippedJson(path);
            using var doc = JsonDocument.Parse(jsonText);
            var root = doc.RootElement;

            if (root.TryGetProperty("flows", out var flowsArray))
            {
                foreach (var flow in flowsArray.EnumerateArray())
                {
                    _odFlows.Add(new ODFlow
                    {
                        OriginZoneIndex = flow.GetProperty("o").GetInt32(),
                        DestZoneIndex = flow.GetProperty("d").GetInt32(),
                        Flow = flow.GetProperty("flow").GetInt32(),
                    });
                }
            }

            GD.Print($"Loaded {_odFlows.Count} OD flow pairs");
        }
        catch (Exception ex)
        {
            GD.PrintErr($"Failed to load OD matrix: {ex.Message}");
        }
    }

    // ── Network Management ───────────────────────────────

    public void AddStop(TransportStop stop)
    {
        _stops.Add(stop);
        RebuildSpatialIndex();
    }

    public void AddRoute(TransportRoute route)
    {
        _routes.Add(route);
    }

    public void RemoveStop(int stopId)
    {
        _stops.RemoveAll(s => s.Id == stopId);
        RebuildSpatialIndex();
    }

    public void RemoveRoute(int routeId)
    {
        _routes.RemoveAll(r => r.Id == routeId);
    }

    // ── Agent Generation ─────────────────────────────────

    /// <summary>
    /// Generate passenger agents from census data.
    /// Each agent represents ~100 real commuters (for performance).
    /// </summary>
    public void GenerateAgents(int scaleFactor = 100)
    {
        _agents.Clear();

        int agentId = 0;
        var zoneList = new List<Zone>(_zones.Values);

        foreach (var flow in _odFlows)
        {
            if (flow.OriginZoneIndex >= zoneList.Count ||
                flow.DestZoneIndex >= zoneList.Count)
                continue;

            var origin = zoneList[flow.OriginZoneIndex];
            var dest = zoneList[flow.DestZoneIndex];

            // Scale down: 1 agent per scaleFactor real commuters
            int agentCount = Math.Max(1, flow.Flow / scaleFactor);

            for (int i = 0; i < agentCount; i++)
            {
                var agent = new PassengerAgent
                {
                    Id = agentId++,
                    HomeX = origin.Longitude + (_rng.NextDouble() - 0.5) * 0.01,
                    HomeY = origin.Latitude + (_rng.NextDouble() - 0.5) * 0.01,
                    WorkX = dest.Longitude + (_rng.NextDouble() - 0.5) * 0.01,
                    WorkY = dest.Latitude + (_rng.NextDouble() - 0.5) * 0.01,
                    DepartureTimeMinutes = GenerateDepartureTime(),
                    State = AgentState.AtHome,
                    Weight = scaleFactor,
                };
                _agents.Add(agent);
            }
        }

        GD.Print($"Generated {_agents.Count} agents (representing {_agents.Count * scaleFactor:N0} commuters)");
    }

    private int GenerateDepartureTime()
    {
        // AM peak: normal distribution centered at 8:00 (480 mins), std 30 mins
        double minutes = 480 + _rng.NextDouble() * 60 - 30 + _rng.NextDouble() * 60 - 30;
        return Math.Clamp((int)minutes, 360, 600); // 6:00-10:00
    }

    // ── Simulation Tick ──────────────────────────────────

    public void Start()
    {
        IsRunning = true;
        GD.Print("Simulation started.");
    }

    public void Stop()
    {
        IsRunning = false;
        GD.Print("Simulation paused.");
    }

    private void ProcessAgentTick()
    {
        int active = 0;

        for (int i = 0; i < _agents.Count; i++)
        {
            ref var agent = ref System.Runtime.InteropServices.CollectionsMarshal
                .AsSpan(_agents)[i];

            switch (agent.State)
            {
                case AgentState.AtHome:
                    if (CurrentTimeMinutes >= agent.DepartureTimeMinutes)
                    {
                        // Try to find a route
                        var journey = FindJourney(
                            agent.HomeX, agent.HomeY,
                            agent.WorkX, agent.WorkY
                        );

                        if (journey != null)
                        {
                            agent.State = AgentState.Travelling;
                            agent.CurrentRouteId = journey.RouteId;
                            agent.CurrentStopIndex = 0;
                            active++;
                        }
                        else
                        {
                            // No PT available — drives (not counted)
                            agent.State = AgentState.AtWork;
                        }
                    }
                    break;

                case AgentState.Travelling:
                    active++;
                    // Simplified: travel takes 30 game-minutes
                    if (CurrentTimeMinutes >= agent.DepartureTimeMinutes + 30)
                    {
                        agent.State = AgentState.AtWork;
                    }
                    break;

                case AgentState.AtWork:
                    // PM return: after 17:00
                    if (CurrentTimeMinutes >= 1020) // 17:00
                    {
                        agent.State = AgentState.Returning;
                        active++;
                    }
                    break;

                case AgentState.Returning:
                    active++;
                    if (CurrentTimeMinutes >= 1080) // 18:00
                    {
                        agent.State = AgentState.AtHome;
                        // Reset for next day
                        agent.DepartureTimeMinutes = GenerateDepartureTime();
                    }
                    break;
            }
        }

        _activePassengers = active;
    }

    // ── Pathfinding (Simplified) ─────────────────────────

    /// <summary>
    /// Find a journey between origin and destination.
    /// This is a simplified version — full RAPTOR implementation in Phase 4.
    /// </summary>
    private JourneyResult? FindJourney(double originX, double originY,
                                        double destX, double destY)
    {
        if (_routes.Count == 0 || _stops.Count == 0)
            return null;

        // Find nearest stop to origin
        var nearestOrigin = FindNearestStop(originX, originY);
        if (nearestOrigin == null) return null;

        // Find nearest stop to destination
        var nearestDest = FindNearestStop(destX, destY);
        if (nearestDest == null) return null;

        // Check if any route connects these stops
        foreach (var route in _routes)
        {
            bool hasOrigin = false;
            bool hasDest = false;

            foreach (var stopId in route.StopIds)
            {
                if (stopId == nearestOrigin.Id) hasOrigin = true;
                if (stopId == nearestDest.Id) hasDest = true;
            }

            if (hasOrigin && hasDest)
            {
                return new JourneyResult
                {
                    RouteId = route.Id,
                    OriginStopId = nearestOrigin.Id,
                    DestStopId = nearestDest.Id,
                    TravelTimeMinutes = 30,
                };
            }
        }

        return null;
    }

    private TransportStop? FindNearestStop(double x, double y, double maxDistKm = 2.0)
    {
        // Use spatial index if available
        if (_stopIndex != null)
        {
            return _stopIndex.FindNearest(x, y, maxDistKm);
        }

        // Brute force fallback
        TransportStop? best = null;
        double bestDist = double.MaxValue;

        foreach (var stop in _stops)
        {
            double dx = (stop.Longitude - x) * 70; // rough km
            double dy = (stop.Latitude - y) * 111;
            double dist = dx * dx + dy * dy;

            if (dist < bestDist)
            {
                bestDist = dist;
                best = stop;
            }
        }

        if (best != null && Math.Sqrt(bestDist) <= maxDistKm)
            return best;

        return null;
    }

    // ── Spatial Index ────────────────────────────────────

    private void RebuildSpatialIndex()
    {
        _stopIndex = new QuadTree(-8, 49, 3, 62); // UK bounds
        foreach (var stop in _stops)
        {
            _stopIndex.Insert(stop);
        }
    }

    // ── Analytics ────────────────────────────────────────

    public int GetTotalPopulation()
    {
        int total = 0;
        foreach (var zone in _zones.Values)
            total += zone.Population;
        return total;
    }

    public Dictionary<int, int> GetRidershipByRoute()
    {
        var ridership = new Dictionary<int, int>();
        foreach (var agent in _agents)
        {
            if (agent.State == AgentState.Travelling && agent.CurrentRouteId >= 0)
            {
                ridership.TryGetValue(agent.CurrentRouteId, out int count);
                ridership[agent.CurrentRouteId] = count + agent.Weight;
            }
        }
        return ridership;
    }

    public int GetTotalDailyRidership()
    {
        int total = 0;
        foreach (var agent in _agents)
        {
            if (agent.CurrentRouteId >= 0)
                total += agent.Weight;
        }
        return total;
    }

    // ── Helpers ──────────────────────────────────────────

    private static string ReadGzippedJson(string path)
    {
        // Handle both .json.gz and .json files
        if (path.EndsWith(".gz"))
        {
            using var fileStream = new FileStream(
                ProjectSettings.GlobalizePath(path),
                FileMode.Open, FileAccess.Read
            );
            using var gzStream = new GZipStream(fileStream, CompressionMode.Decompress);
            using var reader = new StreamReader(gzStream);
            return reader.ReadToEnd();
        }
        else
        {
            using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
            return file?.GetAsText() ?? "{}";
        }
    }
}
