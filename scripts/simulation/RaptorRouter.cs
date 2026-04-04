using System;
using System.Collections.Generic;

namespace HighSpeedToo.Simulation;

/// <summary>
/// RAPTOR (Round-based Public Transit Optimized Router) pathfinder.
/// Finds optimal multi-modal journeys with transfers.
///
/// Based on: Delling, Pajor, Werneck — "Round-Based Public Transit Routing"
/// Microsoft Research, 2012.
///
/// Algorithm overview:
///   Round 0: Mark origin stop(s) with arrival time = departure time.
///   Round k: For each marked stop, scan all routes through it.
///            For each subsequent stop on each route, update arrival time
///            if this route provides an earlier arrival than known.
///   Transfers: After each round, propagate walking transfers from
///              newly-improved stops.
///   Repeat until no improvements found.
///
/// Each round adds one more vehicle segment to the journey, so
/// k rounds = k-1 transfers.
/// </summary>
public class RaptorRouter
{
    private const int MaxRounds = 5;       // Max transfers + 1
    private const double WalkSpeedKmH = 5; // Walking speed for transfers
    private const double MaxWalkKm = 0.8;  // Max walk distance for transfers

    private readonly List<TransportStop> _stops;
    private readonly List<TransportRoute> _routes;
    private readonly QuadTree _stopIndex;

    // Precomputed: which routes serve each stop
    private readonly Dictionary<int, List<int>> _stopToRoutes;

    // Arrival times: [round][stopId] -> earliest arrival in minutes
    private int[][] _arrivals = Array.Empty<int[]>();

    // Journey reconstruction: [round][stopId] -> how we got here
    private JourneyEntry[][] _journey = Array.Empty<JourneyEntry[]>();

    private struct JourneyEntry
    {
        public int RouteId;    // -1 if walking
        public int BoardStop;  // Stop where we boarded this route
        public int ArrivalTime;
    }

    public RaptorRouter(List<TransportStop> stops, List<TransportRoute> routes, QuadTree stopIndex)
    {
        _stops = stops;
        _routes = routes;
        _stopIndex = stopIndex;

        // Build stop → route index
        _stopToRoutes = new Dictionary<int, List<int>>();
        for (int r = 0; r < routes.Count; r++)
        {
            foreach (int stopId in routes[r].StopIds)
            {
                if (!_stopToRoutes.TryGetValue(stopId, out var routeList))
                {
                    routeList = new List<int>();
                    _stopToRoutes[stopId] = routeList;
                }
                routeList.Add(r);
            }
        }
    }

    /// <summary>
    /// Find the best journey from origin to destination at a given departure time.
    /// </summary>
    public JourneyResult? FindJourney(
        double originLon, double originLat,
        double destLon, double destLat,
        int departureTimeMinutes)
    {
        // Find nearby stops
        var originStops = _stopIndex.FindInRadius(originLon, originLat, MaxWalkKm);
        var destStops = _stopIndex.FindInRadius(destLon, destLat, MaxWalkKm);

        if (originStops.Count == 0 || destStops.Count == 0)
            return null;

        int maxStopId = GetMaxStopId();

        // Initialize arrival arrays
        _arrivals = new int[MaxRounds + 1][];
        _journey = new JourneyEntry[MaxRounds + 1][];

        for (int k = 0; k <= MaxRounds; k++)
        {
            _arrivals[k] = new int[maxStopId + 1];
            _journey[k] = new JourneyEntry[maxStopId + 1];
            Array.Fill(_arrivals[k], int.MaxValue);
        }

        // Track which stops were improved in previous round
        var markedStops = new HashSet<int>();

        // Round 0: walk from origin to nearby stops
        foreach (var stop in originStops)
        {
            double walkDist = DistKm(originLon, originLat, stop.Longitude, stop.Latitude);
            int walkTime = (int)(walkDist / WalkSpeedKmH * 60);
            int arrivalTime = departureTimeMinutes + walkTime;

            if (arrivalTime < _arrivals[0][stop.Id])
            {
                _arrivals[0][stop.Id] = arrivalTime;
                _journey[0][stop.Id] = new JourneyEntry
                {
                    RouteId = -1,
                    BoardStop = -1,
                    ArrivalTime = arrivalTime,
                };
                markedStops.Add(stop.Id);
            }
        }

        // Best known arrival at any destination stop
        int bestArrival = int.MaxValue;
        int bestDestStopId = -1;
        int bestRound = -1;

        // Check if destination reachable on foot
        foreach (var stop in destStops)
        {
            if (_arrivals[0][stop.Id] < bestArrival)
            {
                bestArrival = _arrivals[0][stop.Id];
                bestDestStopId = stop.Id;
                bestRound = 0;
            }
        }

        // Rounds 1..MaxRounds
        for (int k = 1; k <= MaxRounds; k++)
        {
            // Copy previous round's arrivals as starting point
            Array.Copy(_arrivals[k - 1], _arrivals[k], _arrivals[k].Length);
            Array.Copy(_journey[k - 1], _journey[k], _journey[k].Length);

            var newMarked = new HashSet<int>();

            // Collect routes to scan (routes through any marked stop)
            var routesToScan = new HashSet<int>();
            foreach (int stopId in markedStops)
            {
                if (_stopToRoutes.TryGetValue(stopId, out var routes))
                {
                    foreach (int r in routes)
                        routesToScan.Add(r);
                }
            }

            // Scan each route
            foreach (int routeIdx in routesToScan)
            {
                var route = _routes[routeIdx];
                ScanRoute(k, route, markedStops, newMarked);
            }

            // Transfer stage: walk from improved stops to nearby stops
            foreach (int stopId in newMarked.ToArray())
            {
                var stop = GetStop(stopId);
                if (stop == null) continue;

                var nearby = _stopIndex.FindInRadius(
                    stop.Longitude, stop.Latitude, MaxWalkKm
                );

                foreach (var neighbor in nearby)
                {
                    if (neighbor.Id == stopId) continue;

                    double walkDist = DistKm(
                        stop.Longitude, stop.Latitude,
                        neighbor.Longitude, neighbor.Latitude
                    );
                    int walkTime = (int)(walkDist / WalkSpeedKmH * 60);
                    int arrivalTime = _arrivals[k][stopId] + walkTime;

                    if (arrivalTime < _arrivals[k][neighbor.Id])
                    {
                        _arrivals[k][neighbor.Id] = arrivalTime;
                        _journey[k][neighbor.Id] = new JourneyEntry
                        {
                            RouteId = -1,
                            BoardStop = stopId,
                            ArrivalTime = arrivalTime,
                        };
                        newMarked.Add(neighbor.Id);
                    }
                }
            }

            markedStops = newMarked;

            // Check destinations
            foreach (var stop in destStops)
            {
                if (_arrivals[k][stop.Id] < bestArrival)
                {
                    bestArrival = _arrivals[k][stop.Id];
                    bestDestStopId = stop.Id;
                    bestRound = k;
                }
            }

            // Early termination if no improvements
            if (markedStops.Count == 0)
                break;
        }

        if (bestDestStopId < 0 || bestArrival == int.MaxValue)
            return null;

        // Reconstruct journey
        return ReconstructJourney(bestRound, bestDestStopId, departureTimeMinutes);
    }

    private void ScanRoute(int round, TransportRoute route,
        HashSet<int> markedStops, HashSet<int> newMarked)
    {
        // Find the earliest point where we can board this route
        bool boarded = false;
        int boardStop = -1;
        int boardTime = int.MaxValue;

        // Travel time between consecutive stops (simplified: distance-based)
        for (int i = 0; i < route.StopIds.Count; i++)
        {
            int stopId = route.StopIds[i];

            // Can we board here with a better time than previously known?
            if (!boarded && _arrivals[round - 1][stopId] < int.MaxValue)
            {
                // Check if a vehicle departs after we arrive
                int arriveAt = _arrivals[round - 1][stopId];
                int nextDeparture = GetNextDeparture(route, arriveAt);

                if (nextDeparture < int.MaxValue)
                {
                    boarded = true;
                    boardStop = stopId;
                    boardTime = nextDeparture;
                }
            }

            if (boarded && i > 0)
            {
                // Calculate arrival at this stop
                var prevStop = GetStop(route.StopIds[i - 1]);
                var currStop = GetStop(stopId);
                if (prevStop == null || currStop == null) continue;

                double dist = DistKm(
                    prevStop.Longitude, prevStop.Latitude,
                    currStop.Longitude, currStop.Latitude
                );
                int travelTime = Math.Max(1, (int)(dist / route.SpeedKmH * 60));
                boardTime += travelTime;

                if (boardTime < _arrivals[round][stopId])
                {
                    _arrivals[round][stopId] = boardTime;
                    _journey[round][stopId] = new JourneyEntry
                    {
                        RouteId = route.Id,
                        BoardStop = boardStop,
                        ArrivalTime = boardTime,
                    };
                    newMarked.Add(stopId);
                }
            }
        }
    }

    private int GetNextDeparture(TransportRoute route, int afterMinutes)
    {
        if (route.FrequencyMinutes <= 0) return int.MaxValue;

        // Frequency-based: next departure is at most freq minutes away
        int remainder = afterMinutes % route.FrequencyMinutes;
        return afterMinutes + (route.FrequencyMinutes - remainder);
    }

    private JourneyResult ReconstructJourney(int round, int destStopId, int departureTime)
    {
        var legs = new List<JourneyLeg>();

        int currentStop = destStopId;
        for (int k = round; k >= 1; k--)
        {
            var entry = _journey[k][currentStop];
            if (entry.RouteId >= 0)
            {
                var route = _routes.Find(r => r.Id == entry.RouteId);
                legs.Insert(0, new JourneyLeg
                {
                    RouteId = entry.RouteId,
                    BoardStopId = entry.BoardStop,
                    AlightStopId = currentStop,
                    Mode = route?.Mode ?? TransportMode.Bus,
                    DurationMinutes = entry.ArrivalTime -
                        (k > 0 ? _arrivals[k - 1][entry.BoardStop] : departureTime),
                });
                currentStop = entry.BoardStop;
            }
            else if (entry.BoardStop >= 0)
            {
                // Walking transfer
                currentStop = entry.BoardStop;
            }
        }

        var destStop = GetStop(destStopId);
        int totalTime = _arrivals[round][destStopId] - departureTime;

        return new JourneyResult
        {
            RouteId = legs.Count > 0 ? legs[0].RouteId : -1,
            OriginStopId = legs.Count > 0 ? legs[0].BoardStopId : -1,
            DestStopId = destStopId,
            TravelTimeMinutes = totalTime,
            Legs = legs,
        };
    }

    private TransportStop? GetStop(int id)
    {
        foreach (var stop in _stops)
            if (stop.Id == id)
                return stop;
        return null;
    }

    private int GetMaxStopId()
    {
        int max = 0;
        foreach (var stop in _stops)
            if (stop.Id > max)
                max = stop.Id;
        return max;
    }

    private static double DistKm(double lon1, double lat1, double lon2, double lat2)
    {
        double dx = (lon2 - lon1) * 70;
        double dy = (lat2 - lat1) * 111;
        return Math.Sqrt(dx * dx + dy * dy);
    }
}
