import { GAME_CONFIG } from './types.js';

export function quantize(value: number, step: number = GAME_CONFIG.POSITION_QUANTIZE): number {
  return Math.round(value / step) * step;
}

export function wrapSimple(
  x: number,
  y: number,
  fieldW: number = GAME_CONFIG.FIELD_WIDTH,
  fieldH: number = GAME_CONFIG.FIELD_HEIGHT
): { x: number; y: number } {
  let wx = x;
  let wy = y;
  if (wx < 0) wx += fieldW;
  if (wx > fieldW) wx -= fieldW;
  if (wy < 0) wy += fieldH;
  if (wy > fieldH) wy -= fieldH;
  return { x: wx, y: wy };
}

export function wrapAsteroid(
  x: number,
  y: number,
  radius: number,
  fieldW: number = GAME_CONFIG.FIELD_WIDTH,
  fieldH: number = GAME_CONFIG.FIELD_HEIGHT
): { x: number; y: number } {
  let wx = x;
  let wy = y;
  if (wx < -radius) wx += fieldW + radius * 2;
  if (wx > fieldW + radius) wx -= fieldW + radius * 2;
  if (wy < -radius) wy += fieldH + radius * 2;
  if (wy > fieldH + radius) wy -= fieldH + radius * 2;
  return { x: wx, y: wy };
}

/** Server simulation advances once per tick; vx/vy are pixels per tick, not per second. */
export function extrapolateLinear(
  x: number,
  y: number,
  vx: number,
  vy: number,
  dtSec: number,
  tickRate: number = GAME_CONFIG.TICK_RATE
): { x: number; y: number } {
  const ticks = dtSec * tickRate;
  return { x: x + vx * ticks, y: y + vy * ticks };
}

export function extrapolateAngle(
  angle: number,
  angularSpeed: number,
  dtSec: number,
  tickRate: number = GAME_CONFIG.TICK_RATE
): number {
  return angle + angularSpeed * dtSec * tickRate;
}

/** Player flag bitmask for compact wire updates */
export const PLAYER_FLAG_THRUSTING = 1;
export const PLAYER_FLAG_ALIVE = 2;
export const PLAYER_FLAG_INVULNERABLE = 4;

export function encodePlayerFlags(isThrusting: boolean, isAlive: boolean, invulnerable: boolean): number {
  let flags = 0;
  if (isThrusting) flags |= PLAYER_FLAG_THRUSTING;
  if (isAlive) flags |= PLAYER_FLAG_ALIVE;
  if (invulnerable) flags |= PLAYER_FLAG_INVULNERABLE;
  return flags;
}

export function decodePlayerFlags(flags: number): {
  isThrusting: boolean;
  isAlive: boolean;
  invulnerable: boolean;
} {
  return {
    isThrusting: (flags & PLAYER_FLAG_THRUSTING) !== 0,
    isAlive: (flags & PLAYER_FLAG_ALIVE) !== 0,
    invulnerable: (flags & PLAYER_FLAG_INVULNERABLE) !== 0,
  };
}
