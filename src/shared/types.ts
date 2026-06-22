export interface PlayerInput {
  thrust: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
}

export interface PlayerData {
  id: string;
  name: string;
  score: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  isThrusting: boolean;
  isAlive: boolean;
  color: string;
  invulnerable: boolean;
  invulnerableTimer: number;
  respawnTimer: number;
}

export interface AsteroidData {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number; // 3 = Large, 2 = Medium, 1 = Small
  angle: number;
  angularSpeed: number;
  shapeSeed: number;
}

export interface BulletData {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: string;
}

export interface GameStatePayload {
  players: PlayerData[];
  asteroids: AsteroidData[];
  bullets: BulletData[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  isSystem: boolean;
  timestamp: number;
}

/** Compact tuple wire formats (short on the wire) */
export type CompactPlayerUpdate = [string, number, number, number, number, number, number];
export type CompactAsteroidCorrection = [string, number, number, number];
export type CompactAsteroidSpawn = [string, number, number, number, number, number, number, number, number];
export type CompactBulletSpawn = [string, number, number, number, number, string];
export type CompactPlayerSpawn = [string, string, string, number, number, number, number, number, number];

export interface GameRuntimeConfig {
  asteroidMinCount: number;
  asteroidMaxCount: number;
  asteroidSplitEnabled: boolean;
}

export interface SnapshotPayload {
  tick: number;
  players: PlayerData[];
  asteroids: AsteroidData[];
  config: GameRuntimeConfig;
}

export interface DeltaPayload {
  t: number;
  p?: CompactPlayerUpdate[];
  a?: CompactAsteroidCorrection[];
  's+'?: {
    p?: CompactPlayerSpawn[];
    a?: CompactAsteroidSpawn[];
    b?: CompactBulletSpawn[];
  };
  's-'?: string[];
}

export interface SpawnPayload {
  p?: CompactPlayerSpawn[];
  a?: CompactAsteroidSpawn[];
  b?: CompactBulletSpawn[];
}

export interface DespawnPayload {
  ids: string[];
}

export type ServerMessageType =
  | 'init'
  | 'snapshot'
  | 'delta'
  | 'spawn'
  | 'despawn'
  | 'effect'
  | 'leaderboard'
  | 'chat'
  | 'chatHistory';

export interface ServerMessage {
  type: ServerMessageType;
  payload: any;
}

export interface ClientMessageType {
  type: 'join' | 'input' | 'chat';
  payload: any;
}

// Configuration Constants
export const GAME_CONFIG = {
  FIELD_WIDTH: 1600,
  FIELD_HEIGHT: 1200,
  MAX_PLAYERS: 20,
  TICK_RATE: 60,
  BROADCAST_RATE: 15,
  FULL_RESYNC_INTERVAL_TICKS: 900,
  POSITION_QUANTIZE: 1,
  ASTEROID_MIN_COUNT: 1,
  ASTEROID_MAX_COUNT: 2,
  RESPAWN_DELAY_FRAMES: 120,
  INVULNERABILITY_FRAMES: 180,
  /** Send asteroid position correction every N delta broadcasts */
  ASTEROID_CORRECTION_INTERVAL: 4,
  /** Player heartbeat every N delta broadcasts even if unchanged */
  PLAYER_HEARTBEAT_INTERVAL: 4,
  /** Position change threshold before including in delta */
  DELTA_POSITION_THRESHOLD: 2,
};
