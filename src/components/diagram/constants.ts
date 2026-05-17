import { STATION_PK } from '../../data/stationPK';

export const KNOWN_STATION_ORDER = [
  'AVC104OBS', 'AVC84OBS', 'AVC64OBS', 'AVC44OBS', 'AVC24OBS', 'AVC14OBS', 'AVC34OBS', 'AVC54OBS',
  'OBS', 'TCY', 'JNA', 'AVC20CHP', 'CHP', 'SEV', 'INS', 'CUA', 'AVC20ABAD', 'BAD', 'AVCZSAL', 'SAL',
  'ISA', 'AVC20PIN', 'PIN', 'MER', 'CAN', 'SLA', 'MOC', 'BAL', 'AVC14BAL', 'BOU', 'GOM', 'ZAR',
  'AVC14ZAR', 'AVC24ZAR', 'PAN', 'AVC62PAN', 'AVC44PAN', 'AVC24PAN', 'AVC14PAN', 'AVC64PAN',
  'AVC46PAN', 'AVC26PAN', 'AVC16PAN',
];

export const PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#a78bfa', '#fb923c',
  '#34d399', '#f87171', '#c084fc', '#e879f9', '#22d3ee', '#a3e635',
  '#fbbf24', '#2dd4bf', '#818cf8', '#fb7185', '#4ade80', '#94a3b8',
  '#fca5a5', '#86efac', '#fde68a', '#c4b5fd', '#67e8f9', '#fdba74',
];

export const CURSOR_COLORS = ['#ef4444', '#3b82f6'];
export const MARGIN = { left: 5, right: 30, top: 50, bottom: 20 };
export const STATION_COL_W = 70;
export const DEFAULT_PX_PER_HOUR = 200;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 10;
export const SNAP_PX = 20;
export const FONT = 'Inter, system-ui, sans-serif';

export const PERIOD_COLORS = {
  PM: { color: 'rgba(239,68,68,0.12)', lc: '#ef4444' },
  PV: { color: 'rgba(245,158,11,0.12)', lc: '#f59e0b' },
  V: { color: 'rgba(16,185,129,0.08)', lc: '#10b981' },
  N: { color: 'rgba(100,116,139,0.10)', lc: '#64748b' },
} as const;

// PK-based maniobra zone boundaries (meters)
const MAN_PAN_PK_MAX = 550.0;
const MAN_OBS_PK_MIN = 17393.430;

// All AVC stations are maniobra, regardless of PK
export const MANIOBRA_STATIONS = new Set(
  Object.keys(STATION_PK).filter(name => name.startsWith('AVC') || name === 'AVCZSAL'),
);
if (STATION_PK['VIAC'] !== undefined) MANIOBRA_STATIONS.add('VIAC');

export interface ManiobraZone {
  id: string;
  label: string;
  stations: string[];
}

export const MANIOBRA_ZONES: ManiobraZone[] = [
  {
    id: 'pan_deep',
    label: 'MAN PAN',
    stations: [...MANIOBRA_STATIONS].filter(s => (STATION_PK[s] ?? Infinity) <= MAN_PAN_PK_MAX),
  },
  {
    id: 'obs_deep',
    label: 'MAN OBS',
    stations: [...MANIOBRA_STATIONS].filter(s => (STATION_PK[s] ?? 0) >= MAN_OBS_PK_MIN && s !== 'AVCZSAL'),
  },
];
