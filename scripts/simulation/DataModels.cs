namespace HighSpeedToo.Simulation;

/// <summary>
/// Represents one commuter agent. Struct for cache-friendly iteration.
/// Each agent represents ~100 real commuters (scaled by Weight).
/// </summary>
public struct PassengerAgent
{
    public int Id;
    public double HomeX;     // Longitude
    public double HomeY;     // Latitude
    public double WorkX;
    public double WorkY;
    public int DepartureTimeMinutes;
    public AgentState State;
    public int CurrentRouteId;
    public int CurrentStopIndex;
    public int Weight;        // How many real commuters this agent represents
}

public enum AgentState
{
    AtHome,
    Travelling,
    AtWork,
    Returning,
}

/// <summary>
/// Census zone — corresponds to an LSOA.
/// </summary>
public class Zone
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public int Population { get; set; }
    public int WorkingPopulation { get; set; }
    public double Longitude { get; set; }
    public double Latitude { get; set; }
}

/// <summary>
/// Origin-destination commuter flow between two zones.
/// </summary>
public struct ODFlow
{
    public int OriginZoneIndex;
    public int DestZoneIndex;
    public int Flow;
}

/// <summary>
/// A public transport stop (station, bus stop, tram stop, etc.).
/// </summary>
public class TransportStop
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public double Longitude { get; set; }
    public double Latitude { get; set; }
    public TransportMode Mode { get; set; }
    public string NaptanCode { get; set; } = "";
    public int BoardingsToday { get; set; }
}

/// <summary>
/// A public transport route with an ordered list of stops.
/// </summary>
public class TransportRoute
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public TransportMode Mode { get; set; }
    public List<int> StopIds { get; set; } = new();
    public int FrequencyMinutes { get; set; } = 10;
    public double SpeedKmH { get; set; } = 40;
    public int DailyRidership { get; set; }
}

public enum TransportMode
{
    HeavyRail,
    Metro,
    Tram,
    Bus,
}

/// <summary>
/// Result of a journey search.
/// </summary>
public class JourneyResult
{
    public int RouteId { get; set; }
    public int OriginStopId { get; set; }
    public int DestStopId { get; set; }
    public int TravelTimeMinutes { get; set; }
    public List<JourneyLeg>? Legs { get; set; }
}

/// <summary>
/// One leg of a multi-modal journey.
/// </summary>
public class JourneyLeg
{
    public int RouteId { get; set; }
    public int BoardStopId { get; set; }
    public int AlightStopId { get; set; }
    public TransportMode Mode { get; set; }
    public int DurationMinutes { get; set; }
}
