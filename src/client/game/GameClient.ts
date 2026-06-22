import { GAME_CONFIG, PlayerInput, PlayerData, AsteroidData, BulletData, ServerMessage, ChatMessage } from '../../shared/types.js';
import { ParticleSystem } from './ParticleSystem.js';
import { audioSynthesizer } from './AudioSynthesizer.js';

export class GameClient {
  private ws: WebSocket | null = null;
  private particles: ParticleSystem;

  public localPlayerId: string | null = null;
  public isConnected: boolean = false;
  
  // Game state representation
  private players: PlayerData[] = [];
  private asteroids: AsteroidData[] = [];
  private bullets: BulletData[] = [];
  
  // Interpolated entities (for silky-smooth 60fps rendering)
  private lerpedPlayers: Map<string, { x: number; y: number; angle: number }> = new Map();
  private lerpedAsteroids: Map<string, { x: number; y: number; angle: number }> = new Map();

  // Keyboard input states
  private keys: { [key: string]: boolean } = {};
  private lastSentInput: PlayerInput = { thrust: false, left: false, right: false, shoot: false };
  private inputHeartbeatTimer: any = null;

  // Mobile/touch states
  public touchLeft: boolean = false;
  public touchRight: boolean = false;
  public touchThrust: boolean = false;
  public touchShoot: boolean = false;

  // UI callbacks
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

    this.ws.send(JSON.stringify({
      type: 'chat',
      payload: { text: trimmed }
    }));
  }

  public connect(): void {
    this.onConnectionStatusChange('connecting');
    
    // Auto-detect secure/insecure WebSocket protocol based on browser address
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    this.ws = new WebSocket(`${protocol}//${host}`);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onConnectionStatusChange('connected');
      this.startInputHeartbeat();
    };

    this.ws.onmessage = (event) => {
      this.handleServerMessage(event.data);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onConnectionStatusChange('disconnected');
      this.stopInputHeartbeat();
      
      // Auto-reconnect after 3 seconds
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket connection error:', err);
    };
  }

  public join(name: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'join',
        payload: { name }
      }));
      audioSynthesizer.init(); // Initialize dynamic Web Audio on interaction
    }
  }

  private handleServerMessage(dataStr: string): void {
    try {
      const msg: ServerMessage = JSON.parse(dataStr);

      switch (msg.type) {
        case 'init':
          this.localPlayerId = msg.payload.playerId;
          console.log(`Successfully connected as: ${this.localPlayerId}`);
          break;

        case 'state':
          this.updateState(msg.payload);
          break;

        case 'leaderboard':
          this.onLeaderboardUpdate(msg.payload);
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

  private updateState(payload: { players: PlayerData[]; asteroids: AsteroidData[]; bullets: BulletData[] }): void {
    const prevPlayers = this.players;
    this.players = payload.players;
    this.asteroids = payload.asteroids;
    this.bullets = payload.bullets;

    this.onPlayerCountChange(this.players.length);

    // Update local player stats
    const local = this.players.find(p => p.id === this.localPlayerId);
    if (local) {
      this.onPlayerScoreUpdate(local.score);

      // Check state changes
      const prevLocal = prevPlayers.find(p => p.id === this.localPlayerId);
      
      if (prevLocal && prevLocal.isAlive && !local.isAlive) {
        // Just died
        this.onLocalPlayerDeath(local.respawnTimer);
      } else if (prevLocal && !prevLocal.isAlive && local.isAlive) {
        // Just respawned
        this.onLocalPlayerRespawn();
      } else if (!local.isAlive) {
        // Still dead - update countdown
        this.onLocalPlayerDeath(local.respawnTimer);
      }
    }

    // Dynamic heartbeat pitch update
    audioSynthesizer.updateBeatTempo(this.asteroids.length);
  }

  private handleServerEffect(effectType: string, data: any): void {
    switch (effectType) {
      case 'shoot':
        audioSynthesizer.playShoot(data.x);
        break;

      case 'asteroid_explode':
        audioSynthesizer.playAsteroidExplode(data.size, data.x);
        // Spawn colorful visual particles (neon green/white dust)
        this.particles.spawnExplosion(data.x, data.y, '#ffffff', data.size === 3 ? 35 : data.size === 2 ? 20 : 10, 1.2);
        break;

      case 'player_explode':
        audioSynthesizer.playPlayerExplode(data.x);
        // Spawn huge explosion particles matching player color
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
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      
      // Prevent browser scrolling with space or arrow keys in arcade screen
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.checkAndSendInputs();
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.checkAndSendInputs();
    });
  }

  private checkAndSendInputs(): void {
    if (!this.isConnected || !this.ws) return;

    // Map keyboard and touch buttons to unified inputs
    const thrust = !!(this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchThrust);
    const left = !!(this.keys['ArrowLeft'] || this.keys['KeyA'] || this.touchLeft);
    const right = !!(this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight);
    const shoot = !!(this.keys['Space'] || this.touchShoot);

    const inputs: PlayerInput = { thrust, left, right, shoot };

    // Send only if inputs changed since last transmission
    if (
      inputs.thrust !== this.lastSentInput.thrust ||
      inputs.left !== this.lastSentInput.left ||
      inputs.right !== this.lastSentInput.right ||
      inputs.shoot !== this.lastSentInput.shoot
    ) {
      this.ws.send(JSON.stringify({
        type: 'input',
        payload: inputs
      }));
      this.lastSentInput = inputs;
    }
  }

  private startInputHeartbeat(): void {
    // Heartbeat ensures server is updated even if no key transitions occurred
    this.inputHeartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws) {
        this.ws.send(JSON.stringify({
          type: 'input',
          payload: this.lastSentInput
        }));
      }
    }, 100); // 10 inputs/sec heartbeat
  }

  private stopInputHeartbeat(): void {
    if (this.inputHeartbeatTimer) {
      clearInterval(this.inputHeartbeatTimer);
      this.inputHeartbeatTimer = null;
    }
  }

  public update(): void {
    // 1. Process client particles
    this.particles.update();

    // 2. Play continuous engine hum sound if local ship is thrusting
    const local = this.players.find(p => p.id === this.localPlayerId);
    if (local && local.isAlive && local.isThrusting && Math.random() < 0.25) {
      audioSynthesizer.playThrustTick(local.x);
      
      // Spawn exhaust particles locally
      // Exhaust is located slightly behind the ship
      const flameOffsetDist = -8;
      const flameX = local.x + Math.cos(local.angle) * flameOffsetDist;
      const flameY = local.y + Math.sin(local.angle) * flameOffsetDist;
      this.particles.spawnThrustTrail(flameX, flameY, local.angle, local.vx, local.vy);
    }

    // 3. Update Inputs from touchpads/joysticks (active polling for touch changes)
    if (this.touchLeft || this.touchRight || this.touchThrust || this.touchShoot) {
      this.checkAndSendInputs();
    }
  }

  public getInterpolatedState(): { players: PlayerData[]; asteroids: AsteroidData[]; bullets: BulletData[] } {
    const lerpFactor = 0.28; // standard LERP interpolation factor for snappy responsive movement
    const fieldW = GAME_CONFIG.FIELD_WIDTH;
    const fieldH = GAME_CONFIG.FIELD_HEIGHT;

    // Helper LERP function with wrap-around screen coordinate snapping
    const lerpCoord = (current: number, target: number, maxRange: number): number => {
      const diff = target - current;
      if (Math.abs(diff) > maxRange / 2) {
        return target; // Snap immediately to prevent slingshotting back across the screen
      }
      return current + diff * lerpFactor;
    };

    // Helper LERP for angles
    const lerpAngle = (current: number, target: number): number => {
      // Find shortest path between rotation angles
      let diff = target - current;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      return current + diff * lerpFactor;
    };

    // Interpolate players
    const interpolatedPlayers = this.players.map(p => {
      let lerped = this.lerpedPlayers.get(p.id);
      
      if (!lerped || !p.isAlive) {
        // Initialize or reset
        lerped = { x: p.x, y: p.y, angle: p.angle };
        this.lerpedPlayers.set(p.id, lerped);
      } else {
        // Interpolate
        lerped.x = lerpCoord(lerped.x, p.x, fieldW);
        lerped.y = lerpCoord(lerped.y, p.y, fieldH);
        lerped.angle = lerpAngle(lerped.angle, p.angle);
      }

      return {
        ...p,
        x: lerped.x,
        y: lerped.y,
        angle: lerped.angle
      };
    });

    // Clean up disconnected players from lerp cache
    const activePlayerIds = new Set(this.players.map(p => p.id));
    this.lerpedPlayers.forEach((_, id) => {
      if (!activePlayerIds.has(id)) this.lerpedPlayers.delete(id);
    });

    // Interpolate Asteroids
    const interpolatedAsteroids = this.asteroids.map(a => {
      let lerped = this.lerpedAsteroids.get(a.id);
      if (!lerped) {
        lerped = { x: a.x, y: a.y, angle: a.angle };
        this.lerpedAsteroids.set(a.id, lerped);
      } else {
        lerped.x = lerpCoord(lerped.x, a.x, fieldW);
        lerped.y = lerpCoord(lerped.y, a.y, fieldH);
        lerped.angle = lerpAngle(lerped.angle, a.angle);
      }

      return {
        ...a,
        x: lerped.x,
        y: lerped.y,
        angle: lerped.angle
      };
    });

    // Clean up destroyed asteroids from lerp cache
    const activeAsteroidIds = new Set(this.asteroids.map(a => a.id));
    this.lerpedAsteroids.forEach((_, id) => {
      if (!activeAsteroidIds.has(id)) this.lerpedAsteroids.delete(id);
    });

    // Bullets are fast and have short lifespans, we can draw them at their raw coordinates
    return {
      players: interpolatedPlayers,
      asteroids: interpolatedAsteroids,
      bullets: this.bullets
    };
  }
}
