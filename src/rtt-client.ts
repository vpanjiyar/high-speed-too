// ── Real Time Trains API client ───────────────────────────────────────────────
// Fetches live departure data from RTT via the Vite dev-server proxy.
// Requires VITE_RTT_AUTH env var (base64-encoded username:password).
// Docs: https://www.realtimetrains.co.uk/about/developer/pull/docs/locationlist/

export interface RttDeparture {
  timeStr: string;         // "HH:MM"
  destination: string;
  platform: string;
  statusLabel: string;     // "On time", "Exp HH:MM", "Cancelled"
  statusClass: string;     // 'due' | 'delayed' | 'cancelled' | ''
}

interface RttLocationService {
  locationDetail: {
    gbttBookedDeparture?: string;   // "0823"
    realtimeDeparture?: string;     // "0825"
    destination?: { description: string }[];
    platform?: string;
    cancelReasonCode?: string;
    displayAs?: string;
  };
}

interface RttSearchResult {
  services?: RttLocationService[];
}

const RTT_BASE = '/api/rtt';

// Common TIPLOC → CRS mappings for major UK stations
// CRS codes are 3-letter codes used by RTT; TIPLOCs are derived from NaPTAN ATCO codes
const TIPLOC_TO_CRS: Record<string, string> = {
  'VICTRIA': 'VIC', 'VICTRIC': 'VIC', 'WATRLMN': 'WAT', 'LNDN': 'LON',
  'EUSTON': 'EUS', 'STPX': 'STP', 'KNGX': 'KGX', 'LIVST': 'LST',
  'PADTON': 'PAD', 'FENCHRS': 'FST', 'CHRX': 'CHX', 'CNLST': 'CST',
  'LNDNBDG': 'LBG', 'MRGT': 'MAR', 'MNCRPIC': 'MAN', 'MNCROXR': 'MCO',
  'BHMNS': 'BHM', 'BRSTLTM': 'BRI', 'LEDS': 'LDS', 'SHEFFLD': 'SHF',
  'NWCSTLE': 'NCL', 'EDINBUR': 'EDB', 'GLAS': 'GLC', 'RDNGSTN': 'RDG',
  'CREWBHM': 'CRE', 'CREWE': 'CRE', 'YORK': 'YRK', 'DRBY': 'DBY',
  'NTNG': 'NOT', 'NTTM': 'NOT', 'COVNTRY': 'COV', 'SDON': 'SDN',
  'GATWICK': 'GTW', 'GTWK': 'GTW', 'CLPHMJN': 'CLJ', 'CRYDONE': 'CRO',
  'CAMBDGE': 'CBG', 'EXETSD': 'EXD', 'PLYMTH': 'PLY', 'SWINDON': 'SWI',
  'CARDIFF': 'CDF', 'CRDFC': 'CDF', 'BATH': 'BTH', 'BTHSPA': 'BTH',
  'BRGHLTN': 'BTN', 'BRIGHTN': 'BTN', 'SOTON': 'SOU', 'BMOUTH': 'BMH',
  'PRST': 'PRE', 'LVRPLSH': 'LIV', 'LIVRL': 'LIV', 'ABRDEEN': 'ABD',
  'DUNDEE': 'DEE', 'PRTH': 'PTH', 'STRLNG': 'STG', 'INVRNSS': 'INV',
  'IPSWICH': 'IPS', 'NRCH': 'NRW', 'NORWICH': 'NRW', 'CLCHSTR': 'COL',
  'PTBRO': 'PBO', 'GRNWCH': 'GNW', 'STPNCRS': 'STP', 'FRNDNLT': 'FPK',
  'FRNTPKN': 'FPK', 'HTRWAJ5': 'HWV', 'THMSLNK': 'ZFD', 'FARNGDN': 'ZFD',
  'CTYM': 'CTM', 'CTYMRD': 'CTM', 'BLKFRS': 'BFR', 'ELPHNT': 'EPH',
  'LUTNARP': 'LTN', 'LUTON': 'LUT', 'STHMPTN': 'SOU', 'STNSTED': 'SSD',
};

/** Try to convert a TIPLOC (from ATCO code) into a CRS code. */
export function tiploc2Crs(tiploc: string): string {
  if (!tiploc) return '';
  const upper = tiploc.toUpperCase();
  // Direct lookup
  if (TIPLOC_TO_CRS[upper]) return TIPLOC_TO_CRS[upper]!;
  // If it's already 3 chars, it might already be a CRS
  if (upper.length === 3) return upper;
  return '';
}

function formatHhmm(raw: string): string {
  if (raw.length === 4) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  return raw;
}

function parseHhmm(raw: string): number {
  const h = parseInt(raw.slice(0, 2), 10);
  const m = parseInt(raw.slice(2), 10);
  return h * 60 + m;
}

export async function fetchLiveDepartures(crs: string): Promise<RttDeparture[]> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  const url = `${RTT_BASE}/json/search/${encodeURIComponent(crs)}/${dateStr}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(`RTT fetch failed: ${resp.status} ${resp.statusText}`);
    return [];
  }

  const data: RttSearchResult = await resp.json();
  if (!data.services) return [];

  const rows: RttDeparture[] = [];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  for (const svc of data.services) {
    const loc = svc.locationDetail;
    const bookedDep = loc.gbttBookedDeparture;
    if (!bookedDep) continue;

    // Only show future departures (within next 2 hours)
    const depMins = parseHhmm(bookedDep);
    if (depMins < nowMins - 5 || depMins > nowMins + 120) continue;

    const dest = loc.destination?.[0]?.description ?? 'Unknown';
    const platform = loc.platform ?? '-';

    let statusLabel = 'On time';
    let statusClass = '';

    if (loc.cancelReasonCode || loc.displayAs === 'CANCELLED_CALL') {
      statusLabel = 'Cancelled';
      statusClass = 'cancelled';
    } else if (loc.realtimeDeparture && loc.realtimeDeparture !== bookedDep) {
      statusLabel = `Exp ${formatHhmm(loc.realtimeDeparture)}`;
      statusClass = 'delayed';
    } else {
      const delta = depMins - nowMins;
      if (delta <= 1) {
        statusLabel = 'Due';
        statusClass = 'due';
      }
    }

    rows.push({
      timeStr: formatHhmm(bookedDep),
      destination: dest,
      platform,
      statusLabel,
      statusClass,
    });
  }

  rows.sort((a, b) => a.timeStr.localeCompare(b.timeStr));
  return rows.slice(0, 8);
}
