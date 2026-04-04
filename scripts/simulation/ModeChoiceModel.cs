using System;

namespace HighSpeedToo.Simulation;

/// <summary>
/// Logit mode choice model. Determines probability of a commuter
/// choosing public transport vs private car for their commute.
///
/// Based on multinomial logit:
///   P(PT) = exp(V_PT) / (exp(V_PT) + exp(V_Car))
///
/// Utility functions include:
///   - Journey time
///   - Wait time / frequency
///   - Number of transfers
///   - Walk access time
///   - Cost (simplified)
/// </summary>
public static class ModeChoiceModel
{
    // ── Calibration coefficients ─────────────────────────
    // Negative = disutility (makes mode less attractive)

    private const double Beta_TravelTime = -0.04;   // per minute
    private const double Beta_WaitTime = -0.06;      // waiting feels worse
    private const double Beta_Transfers = -0.5;      // per transfer
    private const double Beta_WalkTime = -0.08;      // walking to/from stop
    private const double Beta_Frequency = 0.02;      // per departure/hr
    private const double Beta_Cost = -0.003;         // per pence

    // Car baseline (alternative-specific constant)
    private const double ASC_Car = 0.5;  // Slight car preference baseline

    // PT modes have different attractiveness modifiers
    private const double ASC_HeavyRail = 0.3;
    private const double ASC_Metro = 0.2;
    private const double ASC_Tram = 0.1;
    private const double ASC_Bus = -0.1;

    /// <summary>
    /// Calculate probability of choosing public transport.
    /// Returns value between 0 and 1.
    /// </summary>
    public static double CalculatePTProbability(
        JourneyResult? ptJourney,
        double straightLineDistKm,
        TransportMode bestMode = TransportMode.Bus)
    {
        // If no PT journey available, probability is 0
        if (ptJourney == null)
            return 0.0;

        // Calculate PT utility
        double vPT = CalculatePTUtility(ptJourney, bestMode);

        // Calculate car utility (simplified)
        double vCar = CalculateCarUtility(straightLineDistKm);

        // Logit probability
        double expPT = Math.Exp(Math.Min(vPT, 20));   // Clamp to prevent overflow
        double expCar = Math.Exp(Math.Min(vCar, 20));

        return expPT / (expPT + expCar);
    }

    private static double CalculatePTUtility(JourneyResult journey, TransportMode mode)
    {
        double utility = 0;

        // Travel time disutility
        utility += Beta_TravelTime * journey.TravelTimeMinutes;

        // Transfer penalty
        int transfers = (journey.Legs?.Count ?? 1) - 1;
        utility += Beta_Transfers * Math.Max(0, transfers);

        // Wait time (assumes half the headway)
        double avgFreqMinutes = 10; // Default
        utility += Beta_WaitTime * (avgFreqMinutes / 2);

        // Walk access/egress (estimated 5 min each)
        utility += Beta_WalkTime * 10;

        // Mode-specific constant
        utility += mode switch
        {
            TransportMode.HeavyRail => ASC_HeavyRail,
            TransportMode.Metro => ASC_Metro,
            TransportMode.Tram => ASC_Tram,
            TransportMode.Bus => ASC_Bus,
            _ => 0,
        };

        return utility;
    }

    private static double CalculateCarUtility(double distKm)
    {
        double utility = ASC_Car;

        // Car travel time: assume 40 km/h average in urban, 80 in rural
        double speed = distKm > 20 ? 60 : 35; // km/h blended
        double travelTime = distKm / speed * 60; // minutes
        utility += Beta_TravelTime * travelTime;

        // Fuel/parking cost: ~20p per km + parking
        double costPence = distKm * 20 + (distKm < 10 ? 500 : 0); // parking if urban
        utility += Beta_Cost * costPence;

        return utility;
    }

    /// <summary>
    /// Quick check: is PT competitive for this distance?
    /// Used for early filtering before running full RAPTOR.
    /// </summary>
    public static bool IsPTPotentiallyCompetitive(double distKm)
    {
        // PT rarely competitive for < 0.5 km (walk) or > 200 km (fly)
        return distKm >= 0.5 && distKm <= 200;
    }
}
