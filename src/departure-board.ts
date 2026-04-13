// ── Departure board ───────────────────────────────────────────────────────────
// Dot-matrix style departure board for a selected station.
// Supports simulated (from the sim engine) and live (RTT API) modes.

import type { Simulation } from './simulation';
import type { Network } from './network';
import { fetchLiveDepartures, tiploc2Crs, type RttDeparture } from './rtt-client';

const MAX_ROWS = 8;
const BOARD_HORIZON_SEC = 2 * 3600;
const DEFAULT_DWELL_SEC = 45;

/** One departure row */
interface DepartureRow {
  sortTimeSec: number;
  timeStr: string;
  destination: string;
  platform: string | number;
  kind: 'arr' | 'dep';
  statusLabel: string;
  statusClass: string;
}

/** Build a clock string "HH:MM" from simTimeSec (treats 0 = 06:00 local) */
function simToClockStr(simSec: number, baseSec = 6 * 3600): string {
  const total = Math.floor(baseSec + simSec) % 86400;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class DepartureBoard {
  private readonly el: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly liveBadge: HTMLElement;
  private readonly modeBtnSim: HTMLElement;
  private readonly modeBtnLive: HTMLElement;
  private readonly filterBtnBoth: HTMLElement;
  private readonly filterBtnDep: HTMLElement;
  private readonly filterBtnArr: HTMLElement;

  private stationId: string | null = null;
  private stationCrs: string | null = null;
  private onClose: (() => void) | null = null;
  private mode: 'simulated' | 'live' = 'simulated';
  private filter: 'both' | 'dep' | 'arr' = 'both';
  private livePollTimer: ReturnType<typeof setInterval> | null = null;
  private activeVisibilityMotion: { token: symbol; animations: Animation[] } | null = null;

  constructor() {
    this.el         = document.getElementById('departure-board')!;
    this.nameEl     = document.getElementById('db-station-name')!;
    this.rowsEl     = document.getElementById('db-rows')!;
    this.closeBtn   = document.getElementById('db-close')!;
    this.liveBadge  = document.getElementById('db-live-badge')!;
    this.modeBtnSim = document.getElementById('db-mode-sim')!;
    this.modeBtnLive = document.getElementById('db-mode-live')!;
    this.filterBtnBoth = document.getElementById('db-filter-both')!;
    this.filterBtnDep = document.getElementById('db-filter-dep')!;
    this.filterBtnArr = document.getElementById('db-filter-arr')!;

    this.closeBtn.addEventListener('click', () => this._handleClose());

    this.modeBtnSim.addEventListener('click', () => this.setMode('simulated'));
    this.modeBtnLive.addEventListener('click', () => this.setMode('live'));
    this.filterBtnBoth.addEventListener('click', () => this.setFilter('both'));
    this.filterBtnDep.addEventListener('click', () => this.setFilter('dep'));
    this.filterBtnArr.addEventListener('click', () => this.setFilter('arr'));
    this._syncFilterButtons();
  }

  setOnClose(cb: () => void): void { this.onClose = cb; }

  open(stationId: string, stationName: string, crs?: string): void {
    this.stationId = stationId;
    // Try to resolve CRS from raw code (might be a TIPLOC from ATCO)
    this.stationCrs = crs ? (tiploc2Crs(crs) || crs) : null;
    this.nameEl.textContent = stationName;
    this._setAnimatedVisibility(true);
    this.setMode(this.mode); // refresh badge/buttons
  }

  close(): void {
    this.stationId = null;
    this.stationCrs = null;
    this._setAnimatedVisibility(false);
    this.rowsEl.innerHTML = '';
    this._stopLivePoll();
  }

  isOpen(): boolean { return !this.el.classList.contains('hidden'); }

  setMode(mode: 'simulated' | 'live'): void {
    this.mode = mode;
    this.modeBtnSim.classList.toggle('db-mode-btn--active', mode === 'simulated');
    this.modeBtnLive.classList.toggle('db-mode-btn--active', mode === 'live');
    this.liveBadge.classList.toggle('hidden', mode !== 'live');

    if (mode === 'live') {
      this._startLivePoll();
    } else {
      this._stopLivePoll();
    }
  }

  setFilter(filter: 'both' | 'dep' | 'arr'): void {
    this.filter = filter;
    this._syncFilterButtons();
  }

  private _syncFilterButtons(): void {
    this.filterBtnBoth.classList.toggle('db-mode-btn--active', this.filter === 'both');
    this.filterBtnDep.classList.toggle('db-mode-btn--active', this.filter === 'dep');
    this.filterBtnArr.classList.toggle('db-mode-btn--active', this.filter === 'arr');
  }

  private _setAnimatedVisibility(visible: boolean): void {
    const hidden = this.el.classList.contains('hidden');
    const state = this.el.dataset.motionState;

    if (visible) {
      if (state === 'entering' || state === 'open') return;
      if (!hidden && state !== 'exiting') return;
    } else {
      if (state === 'exiting' || state === 'closed') return;
      if (hidden && state !== 'entering') return;
    }

    if (this.activeVisibilityMotion) {
      this.activeVisibilityMotion.animations.forEach((animation) => animation.cancel());
      this.activeVisibilityMotion = null;
    }

    if (visible) {
      this.el.classList.remove('hidden');
      this.el.setAttribute('aria-hidden', 'false');
    }

    this.el.dataset.motionState = visible ? 'entering' : 'exiting';
    this.el.style.pointerEvents = 'none';

    const animation = this.el.animate(
      visible
        ? [
            { opacity: 0, transform: 'translateY(20px) scale(0.96)' },
            { opacity: 1, transform: 'translateY(-4px) scale(1.01)', offset: 0.72 },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ]
        : [
            { opacity: 1, transform: 'translateY(0) scale(1)' },
            { opacity: 0.78, transform: 'translateY(6px) scale(0.985)', offset: 0.45 },
            { opacity: 0, transform: 'translateY(18px) scale(0.95)' },
          ],
      {
        duration: visible ? 220 : 150,
        easing: visible ? 'cubic-bezier(0.22, 1.24, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both',
      },
    );

    const token = Symbol();
    this.activeVisibilityMotion = { token, animations: [animation] };

    void animation.finished.catch(() => undefined).then(() => {
      if (!this.activeVisibilityMotion || this.activeVisibilityMotion.token !== token) return;

      animation.cancel();
      this.activeVisibilityMotion = null;
      this.el.style.pointerEvents = '';

      if (visible) {
        this.el.dataset.motionState = 'open';
        return;
      }

      this.el.classList.add('hidden');
      this.el.dataset.motionState = 'closed';
      this.el.setAttribute('aria-hidden', 'true');
    });
  }

  /** Refresh the board from current simulation state. Call on each tick. */
  update(sim: Simulation, network: Network): void {
    if (!this.stationId || this.mode !== 'simulated') return;

    const simTimeSec = sim.getSimTimeSec();
    const caches = sim.getPolylineCaches();
    const rows: DepartureRow[] = [];
    const trains = sim.getTrains();

    const stablePlatformForTrain = (trainId: string, platformCount: number): number => {
      let hash = 0;
      for (let i = 0; i < trainId.length; i++) hash = ((hash << 5) - hash + trainId.charCodeAt(i)) | 0;
      return (Math.abs(hash) % Math.max(1, platformCount)) + 1;
    };

    const dwellAt = (line: Network['lines'][number], stationId: string): number => {
      return line.stationDwellTimes?.[stationId] ?? DEFAULT_DWELL_SEC;
    };

    const pushRow = (
      absTimeSec: number,
      destination: string,
      platform: number,
      kind: 'arr' | 'dep',
      statusLabel: string,
      statusClass: string,
    ): void => {
      const delta = absTimeSec - simTimeSec;
      if (delta < -30 || delta > BOARD_HORIZON_SEC) return;
      rows.push({
        sortTimeSec: absTimeSec,
        timeStr: simToClockStr(absTimeSec),
        destination,
        platform,
        kind,
        statusLabel,
        statusClass,
      });
    };

    for (const train of trains) {
      const line = network.getLine(train.lineId);
      if (!line) continue;
      const cache = caches.get(line.id);
      if (!cache) continue;

      const stationIdx = line.stationIds.indexOf(this.stationId);
      if (stationIdx < 0) continue;

      const stationCount = line.stationIds.length;
      const stationObj = network.getStation(this.stationId);
      const platformCount = stationObj?.platforms ?? 2;
      const platform = stablePlatformForTrain(train.id, platformCount);
      const terminalArrivalSec = cache.stationStops[stationCount - 1]?.arrivalTimeSec ?? cache.oneWayTravelSec;
      const holdBeforeDepartureSec = train.status === 'dwelling' || train.status === 'turnaround'
        ? train.dwellRemainingSec
        : 0;

      const destinationForward = network.getStation(line.stationIds[stationCount - 1]!)?.name ?? 'Terminal';
      const destinationReverse = network.getStation(line.stationIds[0]!)?.name ?? 'Terminal';
      const originForward = destinationReverse;
      const originReverse = destinationForward;

      const profileIdx = train.direction === 'forward' ? stationIdx : stationCount - 1 - stationIdx;
      const profileStop = cache.stationStops[profileIdx];
      if (!profileStop) continue;

      // Can this train still call at the selected station on this current run?
      const servesAhead = train.direction === 'forward'
        ? stationIdx >= train.nextStationIndex
        : stationIdx <= train.nextStationIndex;

      if (servesAhead) {
        const targetOffsetSec = train.direction === 'forward'
          ? profileStop.arrivalTimeSec
          : Math.max(0, terminalArrivalSec - profileStop.arrivalTimeSec);
        const arrRemainingSec = Math.max(0, targetOffsetSec - train.legElapsedSec) + holdBeforeDepartureSec;
        const arrAbs = simTimeSec + arrRemainingSec;

        pushRow(
          arrAbs,
          train.direction === 'forward' ? `From ${originForward}` : `From ${originReverse}`,
          platform,
          'arr',
          arrRemainingSec < 60 ? 'Arr due' : 'Arr',
          arrRemainingSec < 60 ? 'due' : '',
        );

        // Departure after station dwell (if not terminal in current direction)
        const canDepartSameDir = train.direction === 'forward'
          ? stationIdx < stationCount - 1
          : stationIdx > 0;
        if (canDepartSameDir) {
          const depAbs = arrAbs + dwellAt(line, this.stationId);
          pushRow(
            depAbs,
            train.direction === 'forward' ? `To ${destinationForward}` : `To ${destinationReverse}`,
            platform,
            'dep',
            depAbs - simTimeSec < 60 ? 'Dep due' : 'Dep',
            depAbs - simTimeSec < 60 ? 'due' : '',
          );
        }
      }

      // If the train is currently turning at this station terminal, show its next departure.
      const turningHere = train.status === 'turnaround' && (
        (train.direction === 'forward' && stationIdx === stationCount - 1) ||
        (train.direction === 'reverse' && stationIdx === 0)
      );
      if (turningHere) {
        const depAbs = simTimeSec + train.dwellRemainingSec;
        const depTo = train.direction === 'forward' ? `To ${destinationReverse}` : `To ${destinationForward}`;
        pushRow(
          depAbs,
          depTo,
          platform,
          'dep',
          train.dwellRemainingSec < 60 ? 'Dep due' : 'Dep',
          train.dwellRemainingSec < 60 ? 'due' : '',
        );
      }
    }

    rows.sort((a, b) => a.sortTimeSec - b.sortTimeSec);
    const filtered = this.filter === 'both'
      ? rows
      : rows.filter((row) => row.kind === this.filter);
    this._renderRows(filtered.slice(0, MAX_ROWS));
  }

  private _startLivePoll(): void {
    this._stopLivePoll();
    this._fetchLive();
    this.livePollTimer = setInterval(() => this._fetchLive(), 60_000);
  }

  private _stopLivePoll(): void {
    if (this.livePollTimer) {
      clearInterval(this.livePollTimer);
      this.livePollTimer = null;
    }
  }

  private async _fetchLive(): Promise<void> {
    const crs = this.stationCrs;
    if (!crs) {
      this._renderRows([{
        sortTimeSec: 0,
        timeStr: '--:--',
        destination: 'No CRS code for this station — try a mainline NaPTAN station',
        platform: '-',
        kind: 'dep',
        statusLabel: '',
        statusClass: '',
      }]);
      return;
    }

    try {
      const departures: RttDeparture[] = await fetchLiveDepartures(crs);
      if (this.mode !== 'live') return; // mode changed during fetch

      if (departures.length === 0) {
        this._renderRows([{
          sortTimeSec: 0,
          timeStr: '--:--',
          destination: `No live departures for ${crs} — check VITE_RTT_AUTH env var`,
          platform: '-',
          kind: 'dep',
          statusLabel: '',
          statusClass: '',
        }]);
        return;
      }

      this._renderRows(departures.map(d => ({
        sortTimeSec: 0,
        timeStr: d.timeStr,
        destination: d.destination,
        platform: d.platform,
        kind: 'dep',
        statusLabel: d.statusLabel,
        statusClass: d.statusClass,
      })));
    } catch {
      this._renderRows([{
        sortTimeSec: 0,
        timeStr: '--:--',
        destination: 'RTT API unavailable',
        platform: '-',
        kind: 'dep',
        statusLabel: 'Error',
        statusClass: 'delayed',
      }]);
    }
  }

  private _renderRows(rows: DepartureRow[]): void {
    const existing = this.rowsEl.querySelectorAll<HTMLElement>('.db-row');

    if (rows.length === 0) {
      this.rowsEl.innerHTML = '<div style="color:#555;padding:6px 0;font-size:12px">No board entries for this filter and time window.</div>';
      return;
    }

    rows.forEach((row, idx) => {
      let rowEl: HTMLElement;
      if (idx < existing.length && existing[idx]) {
        rowEl = existing[idx] as HTMLElement;
      } else {
        rowEl = document.createElement('div');
        rowEl.className = 'db-row';
        this.rowsEl.appendChild(rowEl);
      }

      const newContent = `
        <span class="db-cell db-cell--time">${escapeHtml(row.timeStr)}</span>
        <span class="db-cell">${escapeHtml(row.destination)}</span>
        <span class="db-cell db-cell--plat">${escapeHtml(String(row.platform))}</span>
        <span class="db-cell db-cell--status ${row.statusClass}">${escapeHtml(row.statusLabel)}</span>
      `;

      if (rowEl.innerHTML.trim() !== newContent.trim()) {
        rowEl.innerHTML = newContent;
        rowEl.classList.remove('db-row--updating');
        void rowEl.offsetWidth;
        rowEl.classList.add('db-row--updating');
      }
    });

    for (let i = rows.length; i < existing.length; i++) {
      existing[i]?.remove();
    }
  }

  private _handleClose(): void {
    this.close();
    this.onClose?.();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
