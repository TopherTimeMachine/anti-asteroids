import { GAME_CONFIG, PlayerData, AsteroidData, BulletData } from '../../shared/types.js';
import { ParticleSystem } from './ParticleSystem.js';

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // Starfield background
  private stars: { x: number; y: number; size: number; alpha: number }[] = [];

  // Transform matrices factors
  public scale: number = 1.0;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Cache for asteroid shapes to avoid recalculating every frame
  private asteroidShapeCache: Map<string, { x: number; y: number }[]> = new Map();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get Canvas 2D context');
    this.ctx = context;

    this.generateStarfield();
  }

  private generateStarfield(): void {
    this.stars = [];
    const numStars = 120;
    for (let i = 0; i < numStars; i++) {
      this.stars.push({
        x: Math.random() * GAME_CONFIG.FIELD_WIDTH,
        y: Math.random() * GAME_CONFIG.FIELD_HEIGHT,
        size: Math.random() < 0.85 ? 1 : 2, // most are 1px, some are 2px
        alpha: 0.2 + Math.random() * 0.8,
      });
    }
  }

  public resize(windowWidth: number, windowHeight: number): void {
    // Canvas dimensions should match actual CSS layout
    this.canvas.width = windowWidth;
    this.canvas.height = windowHeight;

    // Calculate fit-to-screen scaling maintaining ratio
    const scaleX = windowWidth / GAME_CONFIG.FIELD_WIDTH;
    const scaleY = windowHeight / GAME_CONFIG.FIELD_HEIGHT;
    this.scale = Math.min(scaleX, scaleY);

    // Center the field
    this.offsetX = (windowWidth - GAME_CONFIG.FIELD_WIDTH * this.scale) / 2;
    this.offsetY = (windowHeight - GAME_CONFIG.FIELD_HEIGHT * this.scale) / 2;
  }

  public clear(): void {
    this.ctx.fillStyle = '#010204'; // Deep phosphor black
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public render(
    players: PlayerData[],
    asteroids: AsteroidData[],
    bullets: BulletData[],
    particles: ParticleSystem,
    localPlayerId: string | null
  ): void {
    this.clear();

    // 1. Draw out-of-bounds letterbox mask
    this.drawBackgroundLetterbox();

    // Begin scoped rendering of game coordinates
    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 2. Draw Stars Background
    this.drawStars();

    // 3. Draw Game Field Retro Vector Border
    this.drawArenaBorder();

    // 4. Draw Particles
    particles.draw(this.ctx);

    // 5. Draw Bullets
    this.drawBullets(bullets, players);

    // 6. Draw Asteroids
    this.drawAsteroids(asteroids);

    // 7. Draw Players (Ships & Indicators)
    this.drawPlayers(players, localPlayerId);

    this.ctx.restore();
  }

  private drawBackgroundLetterbox(): void {
    // Background glow inside boundaries, pitch black outside
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw game area bounding background fill
    this.ctx.fillStyle = '#030508';
    this.ctx.fillRect(
      this.offsetX,
      this.offsetY,
      GAME_CONFIG.FIELD_WIDTH * this.scale,
      GAME_CONFIG.FIELD_HEIGHT * this.scale
    );
  }

  private drawStars(): void {
    this.ctx.fillStyle = '#ffffff';
    for (const star of this.stars) {
      this.ctx.globalAlpha = star.alpha;
      this.ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    this.ctx.globalAlpha = 1.0;
  }

  private drawArenaBorder(): void {
    this.ctx.save();
    this.ctx.strokeStyle = '#00ffff'; // Retro cyan neon
    this.ctx.lineWidth = 4;
    this.ctx.shadowColor = '#00ffff';
    this.ctx.shadowBlur = 8;
    this.ctx.strokeRect(0, 0, GAME_CONFIG.FIELD_WIDTH, GAME_CONFIG.FIELD_HEIGHT);
    this.ctx.restore();
  }

  private drawBullets(bullets: BulletData[], players: PlayerData[]): void {
    this.ctx.save();
    this.ctx.shadowBlur = 4;
    
    for (const bullet of bullets) {
      // Find shooter to match bullet color
      const shooter = players.find(p => p.id === bullet.ownerId);
      const color = shooter ? shooter.color : '#ffffff';
      
      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      
      const half = GAME_CONFIG.BULLET_VISUAL_SIZE / 2;
      this.ctx.fillRect(
        bullet.x - half,
        bullet.y - half,
        GAME_CONFIG.BULLET_VISUAL_SIZE,
        GAME_CONFIG.BULLET_VISUAL_SIZE
      );
    }
    this.ctx.restore();
  }

  private drawAsteroids(asteroids: AsteroidData[]): void {
    this.ctx.save();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2.5;
    this.ctx.shadowColor = '#ffffff';
    this.ctx.shadowBlur = 3;

    for (const a of asteroids) {
      const vertices = this.getAsteroidVertices(a.id, a.size, a.shapeSeed);

      this.ctx.save();
      this.ctx.translate(a.x, a.y);
      this.ctx.rotate(a.angle);

      this.ctx.beginPath();
      this.ctx.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        this.ctx.lineTo(vertices[i].x, vertices[i].y);
      }
      this.ctx.closePath();
      
      // Retro vector outline fill
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }
    this.ctx.restore();
  }

  // Generate deterministic jagged vertices using custom seed (LCG method)
  private getAsteroidVertices(id: string, size: number, seed: number): { x: number; y: number }[] {
    const cacheKey = `${id}_${size}_${seed}`;
    if (this.asteroidShapeCache.has(cacheKey)) {
      return this.asteroidShapeCache.get(cacheKey)!;
    }

    let state = seed;
    const random = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };

    const numPoints = 8 + Math.floor(random() * 5); // 8 to 12 points
    let baseRadius = 12;
    if (size === 3) baseRadius = 45;
    else if (size === 2) baseRadius = 25;

    const vertices: { x: number; y: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      // Vary radius between 75% and 125% of baseline
      const variance = 0.75 + random() * 0.5;
      const radius = baseRadius * variance;
      vertices.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }

    this.asteroidShapeCache.set(cacheKey, vertices);
    return vertices;
  }

  private drawPlayers(players: PlayerData[], localPlayerId: string | null): void {
    for (const p of players) {
      if (!p.isAlive) continue;

      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.angle);

      // Neon spaceship color
      this.ctx.strokeStyle = p.color;
      this.ctx.lineWidth = 2.5;
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 6;

      this.ctx.scale(GAME_CONFIG.SHIP_VISUAL_SCALE, GAME_CONFIG.SHIP_VISUAL_SCALE);

      // Draw standard retro wedge ship path (base unit coords, scaled above)
      this.ctx.beginPath();
      this.ctx.moveTo(15, 0);       // Nose
      this.ctx.lineTo(-12, -10);    // Back left
      this.ctx.lineTo(-6, 0);       // Back center dent
      this.ctx.lineTo(-12, 10);     // Back right
      this.ctx.closePath();
      
      // Vector outline fill
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.fill();
      this.ctx.stroke();

      // Draw Thruster Flame if thrusting
      if (p.isThrusting && Math.random() < 0.7) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ff5e00'; // Flame orange
        this.ctx.shadowColor = '#ff5e00';
        this.ctx.shadowBlur = 4;
        
        // Random flame flickering height
        const flameLength = 8 + Math.random() * 8;
        this.ctx.moveTo(-7, -4);
        this.ctx.lineTo(-7 - flameLength, 0);
        this.ctx.lineTo(-7, 4);
        this.ctx.stroke();
      }

      // Draw Invulnerability Shield (Flickering dotted circle)
      if (p.invulnerable && Math.floor(p.invulnerableTimer / 4) % 2 === 0) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.shadowColor = '#ffffff';
        this.ctx.shadowBlur = 4;
        this.ctx.arc(0, 0, 22, 0, Math.PI * 2);
        this.ctx.setLineDash([4, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset
      }

      this.ctx.restore();

      // Render Player name tags (Horizontal - no rotation)
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      
      // Label color matches spaceship, bolding local player
      const isLocal = p.id === localPlayerId;
      this.ctx.fillStyle = isLocal ? '#ffffff' : p.color;
      this.ctx.font = '35px "Press Start 2P"';
      this.ctx.textAlign = 'center';
      
      let labelText = p.name;
      if (isLocal) labelText = `▶ ${labelText} ◀`;
      
      this.ctx.fillText(labelText, 0, -22 * GAME_CONFIG.SHIP_VISUAL_SCALE - 28);
      this.ctx.restore();
    }
  }

  // Map viewport canvas space back to logical coordinate space (for touch pads if needed)
  public screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.offsetX) / this.scale,
      y: (clientY - this.offsetY) / this.scale,
    };
  }
}
