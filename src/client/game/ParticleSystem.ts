interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];

  constructor() {}

  public spawnExplosion(x: number, y: number, color: string, count: number = 20, speedMult: number = 1.0): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 2.5) * speedMult;
      const maxLife = 30 + Math.floor(Math.random() * 30); // 0.5s to 1.0s
      
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 2 + Math.floor(Math.random() * 3), // 2px to 4px
        life: maxLife,
        maxLife,
      });
    }
  }

  public spawnThrustTrail(x: number, y: number, shipAngle: number, shipVx: number, shipVy: number): void {
    // Thrust particles emit opposite of shipAngle
    const oppositeAngle = shipAngle + Math.PI + (Math.random() - 0.5) * 0.5;
    const speed = 1.5 + Math.random() * 2.0;
    
    // Mix ship speed with particle speed
    const vx = Math.cos(oppositeAngle) * speed + shipVx * 0.5;
    const vy = Math.sin(oppositeAngle) * speed + shipVy * 0.5;
    
    // Retro flames colors
    const colors = ['#FF3131', '#FF5E00', '#FFFF00', '#FFFFFF'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    const maxLife = 10 + Math.floor(Math.random() * 15);

    this.particles.push({
      x,
      y,
      vx,
      vy,
      color,
      size: 2 + Math.floor(Math.random() * 2), // 2px to 3px
      life: maxLife,
      maxLife,
    });
  }

  public update(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  public clear(): void {
    this.particles = [];
  }
}
