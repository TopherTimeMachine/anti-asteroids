import { GAME_CONFIG } from '../../shared/types.js';

export class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private initialized: boolean = false;
  
  // Background beat state
  private beatIntervalId: any = null;
  private beatToggle: boolean = false;
  private currentTempoMs: number = 1000;
  private isBeatRunning: boolean = false;

  constructor() {
    // Context is initialized on user interaction (join button click)
  }

  public init(): void {
    if (this.initialized) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.12, this.ctx.currentTime); // keep it comfortable
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
      this.startBackgroundBeat();
    } catch (e) {
      console.error('Web Audio API not supported in this browser', e);
    }
  }

  // Helper to create a panner node based on game coordinates
  private createPanner(x: number): StereoPannerNode | null {
    if (!this.ctx || !this.initialized) return null;
    try {
      // Scale game X (0 to FIELD_WIDTH) to pan (-1 to 1)
      const panValue = (x / GAME_CONFIG.FIELD_WIDTH) * 2 - 1;
      // Clamp between -0.8 and 0.8 so it's not totally isolated in one ear
      const clampedPan = Math.max(-0.8, Math.min(0.8, panValue));
      
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clampedPan, this.ctx.currentTime);
      return panner;
    } catch (e) {
      // Fallback for browsers without StereoPannerNode
      return null;
    }
  }

  public playShoot(x: number): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    
    // Create oscillator and gain envelope
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    // Retro laser frequency sweep: 880Hz down to 110Hz in 0.15s
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);
    
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    // Node routing
    osc.connect(gain);
    
    const panner = this.createPanner(x);
    if (panner && this.masterGain) {
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else if (this.masterGain) {
      gain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playAsteroidExplode(size: number, x: number): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    const duration = size === 3 ? 0.45 : size === 2 ? 0.3 : 0.18;
    const baseFreq = size === 3 ? 120 : size === 2 ? 220 : 380;

    // 1. Synthesizing low frequency explosion rumble
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + duration);
    
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    osc.connect(oscGain);

    // 2. Synthesizing noise crackle
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(size === 3 ? 0.45 : size === 2 ? 0.3 : 0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq * 2;
    
    noise.connect(filter);
    filter.connect(noiseGain);

    // Stereo Panning
    const panner = this.createPanner(x);

    if (panner && this.masterGain) {
      oscGain.connect(panner);
      noiseGain.connect(panner);
      panner.connect(this.masterGain);
    } else if (this.masterGain) {
      oscGain.connect(this.masterGain);
      noiseGain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + duration + 0.02);
    
    noise.start(now);
    noise.stop(now + duration + 0.02);
  }

  public playPlayerExplode(x: number): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    const duration = 0.85;

    // Lower rumble
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.linearRampToValueAtTime(10, now + duration);
    oscGain.gain.setValueAtTime(1.0, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.connect(oscGain);

    // High noise blast
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.005, now + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);

    const panner = this.createPanner(x);
    if (panner && this.masterGain) {
      oscGain.connect(panner);
      noiseGain.connect(panner);
      panner.connect(this.masterGain);
    } else if (this.masterGain) {
      oscGain.connect(this.masterGain);
      noiseGain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + duration + 0.05);

    noise.start(now);
    noise.stop(now + duration + 0.05);
  }

  public playBounce(x: number): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    const duration = 0.22;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    // Springy metallic boing: sweep up then settle with pitch modulation
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.1);
    osc.frequency.exponentialRampToValueAtTime(140, now + duration);

    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.connect(gain);

    const panner = this.createPanner(x);
    if (panner && this.masterGain) {
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else if (this.masterGain) {
      gain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playThrustTick(x: number): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    
    // Short periodic low-frequency thumping noise for thrusters
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.linearRampToValueAtTime(45, now + 0.06);
    
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.06);
    
    osc.connect(gain);
    
    const panner = this.createPanner(x);
    if (panner && this.masterGain) {
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else if (this.masterGain) {
      gain.connect(this.masterGain);
    }
    
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Classic background thumping heartbeat
  private startBackgroundBeat(): void {
    if (!this.ctx) return;
    this.isBeatRunning = true;
    
    const scheduleNextBeat = () => {
      if (!this.isBeatRunning) return;
      
      this.playBeatPulse();
      this.beatIntervalId = setTimeout(scheduleNextBeat, this.currentTempoMs);
    };

    scheduleNextBeat();
  }

  private playBeatPulse(): void {
    if (!this.ctx || this.isMuted) return;
    this.resumeContext();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Alternate between pitch values (110Hz and 98Hz)
    const pitch = this.beatToggle ? 110 : 98;
    this.beatToggle = !this.beatToggle;

    osc.frequency.setValueAtTime(pitch, now);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    if (this.masterGain) {
      gain.connect(this.masterGain);
    }

    osc.start(now);
    osc.stop(now + 0.16);
  }

  public updateBeatTempo(asteroidsCount: number): void {
    // Faster tempo with fewer asteroids left
    // Range from 1000ms (many asteroids) down to 250ms (few/no asteroids)
    const clampedCount = Math.max(0, Math.min(20, asteroidsCount));
    const percentage = clampedCount / 20;
    this.currentTempoMs = 250 + percentage * 750;
  }

  public stopBackgroundBeat(): void {
    this.isBeatRunning = false;
    if (this.beatIntervalId) {
      clearTimeout(this.beatIntervalId);
      this.beatIntervalId = null;
    }
  }

  private resumeContext(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
}
export const audioSynthesizer = new AudioSynthesizer();
