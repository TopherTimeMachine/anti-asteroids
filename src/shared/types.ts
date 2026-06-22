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
  shapeSeed: number; // For procedurally drawing retro jagged edges consistently on all clients
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

export type ServerMessageType = 'init' | 'state' | 'effect' | 'leaderboard' | 'chat' | 'chatHistory';

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
  TICK_RATE: 60, // 60 ticks per second
  BROADCAST_RATE: 30, // 30 state broadcasts per second
  ASTEROID_MIN_COUNT: 4,
  RESPAWN_DELAY_FRAMES: 120, // 2 seconds at 60fps
  INVULNERABILITY_FRAMES: 180, // 3 seconds at 60fps
};
