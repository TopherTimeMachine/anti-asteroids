import {
  GAME_CONFIG,
  PlayerInput,
  PlayerData,
  AsteroidData,
  BulletData,
  ServerMessage,
  ChatMessage,
  SnapshotPayload,
  DeltaPayload,
  SpawnPayload,
  CompactPlayerUpdate,
  CompactAsteroidCorrection,
  CompactAsteroidSpawn,
  CompactBulletSpawn,
  CompactPlayerSpawn,
} from '../../shared/types.js';
import {
  decodePlayerFlags,
  wrapSimple,
  wrapAsteroid,
  extrapolateLinear,
  extrapolateAngle,
} from '../../shared/physics.js';
import { ParticleSystem } from './ParticleSystem.js';
import { audioSynthesizer } from './AudioSynthesizer.js';

interface TrackedKinematics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularSpeed: number;
  lastServerTime: number;
}

const ASTEROID_RADIUS: Record<number, number> = { 3: 45, 2: 25, 1: 12 };

export class GameClient {
  private ws: WebSocket | null = null;
  private particles: ParticleSystem;

  public localPlayerId: string | null = null;
  public isConnected: boolean = false;

  private playerMeta: Map<string, Omit<PlayerData, 'x' | 'y' | 'vx' | 'vy' | 'angle'>> = new Map();
  private asteroidMeta: Map<string, Pick<AsteroidData, 'id' | 'size' | 'shapeSeed' | 'vx' | 'vy' | 'angularSpeed'>> = new Map();
  private bulletMeta: Map<string, Pick<BulletData, 'id' | 'ownerId' | 'vx' | 'vy'>> = new Map();

  private playerKinematics: Map<string, TrackedKinematics> = new Map();
  private asteroidKinematics: Map<string, TrackedKinematics> = new Map();
  private bulletKinematics: Map<string, TrackedKinematics> = new Map();

  private keys: { [key: string]: boolean } = {};
  private lastSentInput: PlayerInput = { thrust: false, left: false, right: false, shoot: false };

  public touchLeft: boolean = false;
  public touchRight: boolean = false;
  public touchThrust: boolean = false;
  public touchShoot: boolean = false;

  private onLeaderboardUpdate: (leaderboard: any[]) => void;
  private onConnectionStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
  private onPlayerCountChange: (count: number) => void;
  private onLocalPlayerDeath: (respawnTime: number) => void;
  private onLocalPlayerRespawn: () => void;
  private onPlayerScoreUpdate: (score: number) => void;
  private onChatMessage: (msg: ChatMessage) => void;
  private onChatHistory: (messages: ChatMessage[]) => void;

  constructor(
    particles: ParticleSystem,
    callbacks: {
      onLeaderboardUpdate: (list: any[]) => void;
      onConnectionStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
      onPlayerCountChange: (count: number) => void;
      onLocalPlayerDeath: (respawnTime: number) => void;
      onLocalPlayerRespawn: () => void;
      onPlayerScoreUpdate: (score: number) => void;
      onChatMessage: (msg: ChatMessage) => void;
      onChatHistory: (messages: ChatMessage[]) => void;
    }
  ) {
    this.particles = particles;
    this.onLeaderboardUpdate = callbacks.onLeaderboardUpdate;
    this.onConnectionStatusChange = callbacks.onConnectionStatusChange;
    this.onPlayerCountChange = callbacks.onPlayerCountChange;
    this.onLocalPlayerDeath = callbacks.onLocalPlayerDeath;
    this.onLocalPlayerRespawn = callbacks.onLocalPlayerRespawn;
    this.onPlayerScoreUpdate = callbacks.onPlayerScoreUpdate;
    this.onChatMessage = callbacks.onChatMessage;
    this.onChatHistory = callbacks.onChatHistory;
    this.setupKeyboardListeners();
  }

  public sendChatMessage(text: string): void {
    if (!this.isConnected || !this.ws) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.ws.send(JSON.stringify({ type: 'chat', payload: { text: trimmed } }));
  }

  public connect(): void {
    this.onConnectionStatusChange('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    this.ws = new WebSocket(`${protocol}//${host}`);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onConnectionStatusChange('connected');
    };

    this.ws.onmessage = (event) => this.handleServerMessage(event.data);
    this.ws.onclose = () => {
      this.isConnected = false;
      this.onConnectionStatusChange('disconnected');
      setTimeout(() => this.connect(), 3000);
    };
    this.ws.onerror = (err) => console.error('WebSocket connection error:', err);
  }

  public join(name: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'join', payload: { name } }));
      audioSynthesizer.init();
    }
  }

  private now(): number {
    return performance.now();
  }

  private applyPlayerSpawn(spawn: CompactPlayerSpawn): void {
    const [id, name, color, x, y, vx, vy, angle, flags] = spawn;
    const decoded = decodePlayerFlags(flags);
    this.playerMeta.set(id, {
      id,
      name,
      score: this.playerMeta.get(id)?.score ?? 0,
      isThrusting: decoded.isThrusting,
      isAlive: decoded.isAlive,
      color,
      invulnerable: decoded.invulnerable,
      invulnerableTimer: 0,
      respawnTimer: 0,
    });
    this.playerKinematics.set(id, {
      x,
      y,
      vx,
      vy,
      angle,
      angularSpeed: 0,
      lastServerTime: this.now(),
    });
  }

  private applyPlayerUpdate(update: CompactPlayerUpdate): void {
    const [id, x, y, vx, vy, angle, flags] = update;
    const decoded = decodePlayerFlags(flags);
    let meta = this.playerMeta.get(id);
    if (!meta) {
      meta = {
        id,
        name: id,
        score: 0,
        isThrusting: decoded.isThrusting,
        isAlive: decoded.isAlive,
        color: '#888888',
        invulnerable: decoded.invulnerable,
        invulnerableTimer: 0,
        respawnTimer: 0,
      };
      this.playerMeta.set(id, meta);
    } else {
      meta.isThrusting = decoded.isThrusting;
      meta.isAlive = decoded.isAlive;
      meta.invulnerable = decoded.invulnerable;
    }
    const kin = this.playerKinematics.get(id);
    if (kin) {
      const snapThreshold = 40;
      if (Math.abs(kin.x - x) > snapThreshold || Math.abs(kin.y - y) > snapThreshold) {
        kin.x = x;
        kin.y = y;
      } else {
        kin.x = x;
        kin.y = y;
      }
      kin.vx = vx;
      kin.vy = vy;
      kin.angle = angle;
      kin.lastServerTime = this.now();
    } else {
      this.playerKinematics.set(id, {
        x,
        y,
        vx,
        vy,
        angle,
        angularSpeed: 0,
        lastServerTime: this.now(),
      });
    }
  }

  private applyAsteroidSpawn(spawn: CompactAsteroidSpawn): void {
    const [id, x, y, vx, vy, size, angle, angularSpeed, shapeSeed] = spawn;
    this.asteroidMeta.set(id, { id, size, shapeSeed, vx, vy, angularSpeed });
    this.asteroidKinematics.set(id, {
      x,
      y,
      vx,
      vy,
      angle,
      angularSpeed,
      lastServerTime: this.now(),
    });
  }

  private applyAsteroidCorrection(correction: CompactAsteroidCorrection): void {
    const [id, x, y, angle] = correction;
    const kin = this.asteroidKinematics.get(id);
    if (kin) {
      kin.x = x;
      kin.y = y;
      kin.angle = angle;
      kin.lastServerTime = this.now();
    }
  }

  private applyBulletSpawn(spawn: CompactBulletSpawn): void {
    const [id, x, y, vx, vy, ownerId] = spawn;
    this.bulletMeta.set(id, { id, ownerId, vx, vy });
    this.bulletKinematics.set(id, {
      x,
      y,
      vx,
      vy,
      angle: Math.atan2(vy, vx),
      angularSpeed: 0,
      lastServerTime: this.now(),
    });
  }

  private applyDespawns(ids: string[]): void {
    for (const id of ids) {
      this.playerMeta.delete(id);
      this.playerKinematics.delete(id);
      this.asteroidMeta.delete(id);
      this.asteroidKinematics.delete(id);
      this.bulletMeta.delete(id);
      this.bulletKinematics.delete(id);
    }
  }

  private applySpawns(spawns: SpawnPayload): void {
    spawns.p?.forEach((s) => this.applyPlayerSpawn(s));
    spawns.a?.forEach((s) => this.applyAsteroidSpawn(s));
    spawns.b?.forEach((s) => this.applyBulletSpawn(s));
    if (spawns.p?.length) {
      this.onPlayerCountChange(this.playerMeta.size);
    }
  }

  private handleSnapshot(payload: SnapshotPayload): void {
    const prevLocal = this.localPlayerId
      ? this.playerMeta.get(this.localPlayerId)
      : undefined;

    this.playerMeta.clear();
    this.playerKinematics.clear();
    this.asteroidMeta.clear();
    this.asteroidKinematics.clear();
    this.bulletMeta.clear();
    this.bulletKinematics.clear();

    for (const p of payload.players) {
      this.playerMeta.set(p.id, {
        id: p.id,
        name: p.name,
        score: p.score,
        isThrusting: p.isThrusting,
        isAlive: p.isAlive,
        color: p.color,
        invulnerable: p.invulnerable,
        invulnerableTimer: p.respawnTimer > 0 ? p.respawnTimer : p.invulnerableTimer,
        respawnTimer: p.respawnTimer,
      });
      this.playerKinematics.set(p.id, {
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        angle: p.angle,
        angularSpeed: 0,
        lastServerTime: this.now(),
      });
    }

    for (const a of payload.asteroids) {
      this.asteroidMeta.set(a.id, {
        id: a.id,
        size: a.size,
        shapeSeed: a.shapeSeed,
        vx: a.vx,
        vy: a.vy,
        angularSpeed: a.angularSpeed,
      });
      this.asteroidKinematics.set(a.id, {
        x: a.x,
        y: a.y,
        vx: a.vx,
        vy: a.vy,
        angle: a.angle,
        angularSpeed: a.angularSpeed,
        lastServerTime: this.now(),
      });
    }

    this.onPlayerCountChange(payload.players.length);
    audioSynthesizer.updateBeatTempo(payload.asteroids.length);

    if (this.localPlayerId) {
      const local = this.playerMeta.get(this.localPlayerId);
      if (local) {
        this.onPlayerScoreUpdate(local.score);
        if (prevLocal && prevLocal.isAlive && !local.isAlive) {
          this.onLocalPlayerDeath(local.respawnTimer);
        } else if (prevLocal && !prevLocal.isAlive && local.isAlive) {
          this.onLocalPlayerRespawn();
        } else if (!local.isAlive) {
          this.onLocalPlayerDeath(local.respawnTimer);
        }
      }
    }
  }

  private handleDelta(payload: DeltaPayload): void {
    const prevLocalAlive = this.localPlayerId
      ? this.playerMeta.get(this.localPlayerId)?.isAlive
      : undefined;

    payload.p?.forEach((u) => this.applyPlayerUpdate(u));
    payload.a?.forEach((c) => this.applyAsteroidCorrection(c));
    if (payload['s+']) this.applySpawns(payload['s+']);
    if (payload['s-']) this.applyDespawns(payload['s-']);

    this.onPlayerCountChange(this.playerMeta.size);
    audioSynthesizer.updateBeatTempo(this.asteroidMeta.size);

    if (this.localPlayerId) {
      const local = this.playerMeta.get(this.localPlayerId);
      if (local) {
        this.onPlayerScoreUpdate(local.score);
        if (prevLocalAlive && !local.isAlive) {
          this.onLocalPlayerDeath(GAME_CONFIG.RESPAWN_DELAY_FRAMES);
        } else if (prevLocalAlive === false && local.isAlive) {
          this.onLocalPlayerRespawn();
        } else if (!local.isAlive) {
          this.onLocalPlayerDeath(GAME_CONFIG.RESPAWN_DELAY_FRAMES);
        }
      }
    }
  }

  private handleServerMessage(dataStr: string): void {
    try {
      const msg: ServerMessage = JSON.parse(dataStr);

      switch (msg.type) {
        case 'init':
          this.localPlayerId = msg.payload.playerId;
          break;
        case 'snapshot':
          this.handleSnapshot(msg.payload as SnapshotPayload);
          break;
        case 'delta':
          this.handleDelta(msg.payload as DeltaPayload);
          break;
        case 'spawn':
          this.applySpawns(msg.payload as SpawnPayload);
          break;
        case 'despawn':
          this.applyDespawns((msg.payload as { ids: string[] }).ids);
          break;
        case 'leaderboard':
          this.onLeaderboardUpdate(msg.payload);
          if (this.localPlayerId) {
            const entry = msg.payload.find((e: { id: string }) => e.id === this.localPlayerId);
            if (entry) {
              this.onPlayerScoreUpdate(entry.score);
              const meta = this.playerMeta.get(this.localPlayerId);
              if (meta) meta.score = entry.score;
            }
          }
          break;
        case 'effect':
          this.handleServerEffect(msg.payload.effectType, msg.payload.data);
          break;
        case 'chat':
          this.onChatMessage(msg.payload as ChatMessage);
          break;
        case 'chatHistory':
          this.onChatHistory(msg.payload as ChatMessage[]);
          break;
      }
    } catch (e) {
      console.error('Error parsing server message', e);
    }
  }

  private handleServerEffect(effectType: string, data: any): void {
    switch (effectType) {
      case 'shoot':
        audioSynthesizer.playShoot(data.x);
        break;
      case 'asteroid_explode':
        audioSynthesizer.playAsteroidExplode(data.size, data.x);
        this.particles.spawnExplosion(data.x, data.y, '#ffffff', data.size === 3 ? 35 : data.size === 2 ? 20 : 10, 1.2);
        break;
      case 'player_explode':
        audioSynthesizer.playPlayerExplode(data.x);
        this.particles.spawnExplosion(data.x, data.y, data.color, 50, 2.0);
        break;
      case 'player_join':
        console.log(`📢 ${data.name} entered the grid.`);
        break;
      case 'player_leave':
        console.log(`❌ ${data.name} left the grid.`);
        break;
      case 'bounce': {
        const midX = (data.x1 + data.x2) / 2;
        const midY = (data.y1 + data.y2) / 2;
        audioSynthesizer.playBounce(midX);
        this.particles.spawnExplosion(midX, midY, '#ffff00', 12, 0.8);
        break;
      }
    }
  }

  private setupKeyboardListeners(): void {
    const isTextInputFocused = (): boolean => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    };

    const releaseKeyboardControls = (): void => {
      this.keys = {};
      const neutral: PlayerInput = { thrust: false, left: false, right: false, shoot: false };
      if (
        this.lastSentInput.thrust ||
        this.lastSentInput.left ||
        this.lastSentInput.right ||
        this.lastSentInput.shoot
      ) {
        this.lastSentInput = neutral;
        if (this.isConnected && this.ws) {
          this.ws.send(JSON.stringify({ type: 'input', payload: neutral }));
        }
      }
    };

    document.addEventListener('focusin', (e) => {
      const target = e.target as Element;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as HTMLElement).isContentEditable) {
        releaseKeyboardControls();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTextInputFocused()) return;

      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.checkAndSendInputs();
    });
    window.addEventListener('keyup', (e) => {
      if (isTextInputFocused()) return;

      this.keys[e.code] = false;
      this.checkAndSendInputs();
    });
  }

  private checkAndSendInputs(): void {
    if (!this.isConnected || !this.ws) return;

    const thrust = !!(this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchThrust);
    const left = !!(this.keys['ArrowLeft'] || this.keys['KeyA'] || this.touchLeft);
    const right = !!(this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight);
    const shoot = !!(this.keys['Space'] || this.touchShoot);
    const inputs: PlayerInput = { thrust, left, right, shoot };

    if (
      inputs.thrust !== this.lastSentInput.thrust ||
      inputs.left !== this.lastSentInput.left ||
      inputs.right !== this.lastSentInput.right ||
      inputs.shoot !== this.lastSentInput.shoot
    ) {
      this.ws.send(JSON.stringify({ type: 'input', payload: inputs }));
      this.lastSentInput = inputs;
    }
  }

  public update(): void {
    this.particles.update();

    const localId = this.localPlayerId;
    if (!localId) return;

    const meta = this.playerMeta.get(localId);
    const kin = this.playerKinematics.get(localId);
    if (meta && kin && meta.isAlive && meta.isThrusting && Math.random() < 0.25) {
      audioSynthesizer.playThrustTick(kin.x);
      const flameOffsetDist = -8;
      const flameX = kin.x + Math.cos(kin.angle) * flameOffsetDist;
      const flameY = kin.y + Math.sin(kin.angle) * flameOffsetDist;
      this.particles.spawnThrustTrail(flameX, flameY, kin.angle, kin.vx, kin.vy);
    }

    if (this.touchLeft || this.touchRight || this.touchThrust || this.touchShoot) {
      this.checkAndSendInputs();
    }
  }

  private extrapolateKinematics(kin: TrackedKinematics, useWrap: 'simple' | 'asteroid', radius = 0): TrackedKinematics {
    const dtSec = (this.now() - kin.lastServerTime) / 1000;
    if (dtSec <= 0) return { ...kin };

    const pos = extrapolateLinear(kin.x, kin.y, kin.vx, kin.vy, dtSec);
    let x = pos.x;
    let y = pos.y;
    if (useWrap === 'simple') {
      ({ x, y } = wrapSimple(x, y));
    } else {
      ({ x, y } = wrapAsteroid(x, y, radius));
    }

    return {
      ...kin,
      x,
      y,
      angle: extrapolateAngle(kin.angle, kin.angularSpeed, dtSec),
    };
  }

  public getExtrapolatedState(): {
    players: PlayerData[];
    asteroids: AsteroidData[];
    bullets: BulletData[];
  } {
    const players: PlayerData[] = [];
    this.playerMeta.forEach((meta, id) => {
      const kin = this.playerKinematics.get(id);
      if (!kin) return;
      const ext = this.extrapolateKinematics(kin, 'simple');
      players.push({
        ...meta,
        x: ext.x,
        y: ext.y,
        vx: ext.vx,
        vy: ext.vy,
        angle: ext.angle,
      });
    });

    const asteroids: AsteroidData[] = [];
    this.asteroidMeta.forEach((meta, id) => {
      const kin = this.asteroidKinematics.get(id);
      if (!kin) return;
      const radius = ASTEROID_RADIUS[meta.size] ?? 12;
      const ext = this.extrapolateKinematics(
        { ...kin, vx: meta.vx, vy: meta.vy, angularSpeed: meta.angularSpeed },
        'asteroid',
        radius
      );
      asteroids.push({
        id: meta.id,
        x: ext.x,
        y: ext.y,
        vx: meta.vx,
        vy: meta.vy,
        size: meta.size,
        angle: ext.angle,
        angularSpeed: meta.angularSpeed,
        shapeSeed: meta.shapeSeed,
      });
    });

    const bullets: BulletData[] = [];
    this.bulletMeta.forEach((meta, id) => {
      const kin = this.bulletKinematics.get(id);
      if (!kin) return;
      const ext = this.extrapolateKinematics(
        { ...kin, vx: meta.vx, vy: meta.vy },
        'simple'
      );
      bullets.push({
        id: meta.id,
        x: ext.x,
        y: ext.y,
        vx: meta.vx,
        vy: meta.vy,
        ownerId: meta.ownerId,
      });
    });

    return { players, asteroids, bullets };
  }

  /** @deprecated alias for render loop */
  public getInterpolatedState() {
    return this.getExtrapolatedState();
  }
}
