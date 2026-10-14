import type { VehicleType } from './types';

export interface VehicleSpec {
  type: VehicleType;
  name: string;
  prompt: string;
  maxSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  turnRate: number;
  maxHealth: number;
  amphibious: boolean;
  seatHeight: number;
}

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  scout_runner: {
    type: 'scout_runner',
    name: 'Scout Runner 4x4',
    prompt: 'DRIVE SCOUT RUNNER',
    maxSpeed: 28,
    reverseSpeed: 11,
    acceleration: 21,
    turnRate: 2.15,
    maxHealth: 500,
    amphibious: false,
    seatHeight: 1.05
  },
  armored_truck: {
    type: 'armored_truck',
    name: 'Brawler MRAP',
    prompt: 'DRIVE BRAWLER MRAP',
    maxSpeed: 23,
    reverseSpeed: 9,
    acceleration: 16,
    turnRate: 1.65,
    maxHealth: 850,
    amphibious: false,
    seatHeight: 1.35
  },
  strike_bike: {
    type: 'strike_bike',
    name: 'Valkyrie Recon ATV',
    prompt: 'RIDE VALKYRIE ATV',
    maxSpeed: 35,
    reverseSpeed: 12,
    acceleration: 29,
    turnRate: 2.75,
    maxHealth: 360,
    amphibious: false,
    seatHeight: 0.95
  },
  patrol_boat: {
    type: 'patrol_boat',
    name: 'Mako Gunboat RHIB',
    prompt: 'PILOT MAKO GUNBOAT',
    maxSpeed: 30,
    reverseSpeed: 10,
    acceleration: 23,
    turnRate: 2.25,
    maxHealth: 550,
    amphibious: true,
    seatHeight: 0.9
  }
};

export const VEHICLE_SPAWNS: ReadonlyArray<{ id: string; type: VehicleType; x: number; z: number; yaw?: number }> = [
  // Original 9 canonical spawn points preserved for deterministic tests & familiar routes
  { id: 'runner_spawn',    type: 'scout_runner',  x: -1550, z: -1177, yaw: 0.4 },
  { id: 'runner_depot',    type: 'scout_runner',  x: 45,    z: 35,    yaw: 0.6 },
  { id: 'runner_town',     type: 'scout_runner',  x: -1650, z: -1170, yaw: -0.5 },
  { id: 'runner_airfield', type: 'scout_runner',  x: 1760,  z: 185,   yaw: 1.2 },
  { id: 'runner_farm',     type: 'scout_runner',  x: -1580, z: 1620,  yaw: -0.8 },
  { id: 'runner_harbor',   type: 'scout_runner',  x: 1600,  z: 1600,  yaw: 0.3 },
  { id: 'runner_camp',     type: 'scout_runner',  x: -1810, z: 80,    yaw: 0.9 },
  { id: 'runner_south',    type: 'scout_runner',  x: 70,    z: 1800,  yaw: -1.1 },
  { id: 'runner_ridge',    type: 'scout_runner',  x: 10,    z: -1700, yaw: 0.2 },

  // Central Depot Fleet (Armored MRAP, Recon ATVs, North/West/South Gate Runners)
  { id: 'mrap_depot_w',    type: 'armored_truck', x: -62,   z: -28,   yaw: -1.2 },
  { id: 'atv_depot_n',     type: 'strike_bike',   x: 18,    z: -74,   yaw: 0.0 },
  { id: 'atv_depot_s',     type: 'strike_bike',   x: -24,   z: 76,    yaw: 3.1 },
  { id: 'mrap_depot_e',    type: 'armored_truck', x: 118,   z: -16,   yaw: 1.5 },

  // Old Town Fleet
  { id: 'mrap_town',       type: 'armored_truck', x: -1725, z: -1290, yaw: 0.8 },
  { id: 'atv_town_e',      type: 'strike_bike',   x: -1510, z: -1240, yaw: -1.4 },

  // Quarry Fleet
  { id: 'mrap_quarry',     type: 'armored_truck', x: 1580,  z: -1180, yaw: 0.5 },
  { id: 'atv_quarry',      type: 'strike_bike',   x: 1720,  z: -1310, yaw: -0.9 },
  { id: 'runner_quarry',   type: 'scout_runner',  x: 1540,  z: -1320, yaw: 1.8 },

  // Harbor & Coastal Fleet
  { id: 'mrap_harbor',     type: 'armored_truck', x: 1715,  z: 1490,  yaw: -0.6 },
  { id: 'atv_harbor',      type: 'strike_bike',   x: 1540,  z: 1510,  yaw: 1.1 },
  { id: 'boat_harbor_1',   type: 'patrol_boat',   x: 1790,  z: 1620,  yaw: 0.7 },
  { id: 'boat_harbor_2',   type: 'patrol_boat',   x: 1460,  z: 1690,  yaw: 2.3 },

  // East Airfield Fleet
  { id: 'mrap_airfield',   type: 'armored_truck', x: 1855,  z: 45,    yaw: -1.5 },
  { id: 'atv_airfield_n',  type: 'strike_bike',   x: 1735,  z: 35,    yaw: 0.4 },

  // Farmstead Fleet
  { id: 'mrap_farm',       type: 'armored_truck', x: -1665, z: 1495,  yaw: 0.3 },
  { id: 'atv_farm',        type: 'strike_bike',   x: -1515, z: 1535,  yaw: -1.2 },

  // West Camp & Radio Ridge Fleet
  { id: 'atv_camp',        type: 'strike_bike',   x: -1785, z: 15,    yaw: 1.4 },
  { id: 'mrap_ridge',      type: 'armored_truck', x: 145,   z: -1835, yaw: -0.5 },
  { id: 'atv_ridge',       type: 'strike_bike',   x: 55,    z: -1955, yaw: 2.1 },

  // South Village Fleet
  { id: 'mrap_south',      type: 'armored_truck', x: 155,   z: 1885,  yaw: 0.9 },
  { id: 'atv_south',       type: 'strike_bike',   x: 35,    z: 1790,  yaw: -0.7 },

  // Mid-Valley Lakes, Rivers & Highway Intersections
  { id: 'boat_lake_nw',    type: 'patrol_boat',   x: -560,  z: -480,  yaw: 0.8 },
  { id: 'boat_lake_se',    type: 'patrol_boat',   x: 620,   z: 540,   yaw: -1.0 },
  { id: 'boat_lake_sw',    type: 'patrol_boat',   x: -640,  z: 580,   yaw: 0.5 },
  { id: 'atv_cross_ne',    type: 'strike_bike',   x: 680,   z: -560,  yaw: -0.6 },
  { id: 'runner_cross_sw', type: 'scout_runner',  x: -680,  z: 420,   yaw: 1.2 }
];
