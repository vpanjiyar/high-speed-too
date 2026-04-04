using System;
using System.Collections.Generic;

namespace HighSpeedToo.Simulation;

/// <summary>
/// QuadTree spatial index for fast nearest-stop lookups.
/// Divides UK geographic space recursively.
/// </summary>
public class QuadTree
{
    private const int MaxItems = 8;
    private const int MaxDepth = 12;

    private readonly double _minX, _minY, _maxX, _maxY;
    private readonly int _depth;
    private List<TransportStop>? _items;
    private QuadTree[]? _children;

    public QuadTree(double minX, double minY, double maxX, double maxY, int depth = 0)
    {
        _minX = minX;
        _minY = minY;
        _maxX = maxX;
        _maxY = maxY;
        _depth = depth;
        _items = new List<TransportStop>();
    }

    public void Insert(TransportStop stop)
    {
        if (!Contains(stop.Longitude, stop.Latitude))
            return;

        if (_children != null)
        {
            InsertIntoChild(stop);
            return;
        }

        _items!.Add(stop);

        if (_items.Count > MaxItems && _depth < MaxDepth)
        {
            Subdivide();
        }
    }

    public TransportStop? FindNearest(double x, double y, double maxDistKm)
    {
        TransportStop? best = null;
        double bestDistSq = maxDistKm * maxDistKm;
        FindNearestRecursive(x, y, ref best, ref bestDistSq);
        return best;
    }

    public List<TransportStop> FindInRadius(double x, double y, double radiusKm)
    {
        var results = new List<TransportStop>();
        FindInRadiusRecursive(x, y, radiusKm * radiusKm, results);
        return results;
    }

    // ── Internal ────────────────────────────────────────

    private void FindNearestRecursive(double x, double y,
        ref TransportStop? best, ref double bestDistSq)
    {
        // Skip this quad if the closest point in it is farther than current best
        double closestX = Math.Clamp(x, _minX, _maxX);
        double closestY = Math.Clamp(y, _minY, _maxY);
        double quadDistSq = DistSqKm(x, y, closestX, closestY);

        if (quadDistSq > bestDistSq)
            return;

        if (_items != null)
        {
            foreach (var stop in _items)
            {
                double distSq = DistSqKm(x, y, stop.Longitude, stop.Latitude);
                if (distSq < bestDistSq)
                {
                    bestDistSq = distSq;
                    best = stop;
                }
            }
        }

        if (_children != null)
        {
            foreach (var child in _children)
            {
                child.FindNearestRecursive(x, y, ref best, ref bestDistSq);
            }
        }
    }

    private void FindInRadiusRecursive(double x, double y,
        double radiusSq, List<TransportStop> results)
    {
        double closestX = Math.Clamp(x, _minX, _maxX);
        double closestY = Math.Clamp(y, _minY, _maxY);
        if (DistSqKm(x, y, closestX, closestY) > radiusSq)
            return;

        if (_items != null)
        {
            foreach (var stop in _items)
            {
                if (DistSqKm(x, y, stop.Longitude, stop.Latitude) <= radiusSq)
                    results.Add(stop);
            }
        }

        if (_children != null)
        {
            foreach (var child in _children)
                child.FindInRadiusRecursive(x, y, radiusSq, results);
        }
    }

    private void Subdivide()
    {
        double midX = (_minX + _maxX) / 2;
        double midY = (_minY + _maxY) / 2;
        int nextDepth = _depth + 1;

        _children = new QuadTree[4];
        _children[0] = new QuadTree(_minX, _minY, midX, midY, nextDepth); // SW
        _children[1] = new QuadTree(midX, _minY, _maxX, midY, nextDepth); // SE
        _children[2] = new QuadTree(_minX, midY, midX, _maxY, nextDepth); // NW
        _children[3] = new QuadTree(midX, midY, _maxX, _maxY, nextDepth); // NE

        foreach (var item in _items!)
            InsertIntoChild(item);

        _items = null;
    }

    private void InsertIntoChild(TransportStop stop)
    {
        foreach (var child in _children!)
        {
            if (child.Contains(stop.Longitude, stop.Latitude))
            {
                child.Insert(stop);
                return;
            }
        }
    }

    private bool Contains(double x, double y)
        => x >= _minX && x <= _maxX && y >= _minY && y <= _maxY;

    /// <summary>
    /// Approximate squared distance in km between two lon/lat points.
    /// </summary>
    private static double DistSqKm(double lon1, double lat1, double lon2, double lat2)
    {
        double dx = (lon2 - lon1) * 70;  // ~70 km per degree longitude at UK latitude
        double dy = (lat2 - lat1) * 111; // ~111 km per degree latitude
        return dx * dx + dy * dy;
    }
}
