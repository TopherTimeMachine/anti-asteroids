import { GameState } from './GameState.js';

export interface Command {
  name: string;
  description: string;
  adminOnly?: boolean;
  execute(
    args: string[],
    playerId: string,
    gameState: GameState,
    sendPrivateFeedback: (text: string) => void,
    broadcastSystemMessage: (text: string) => void
  ): void;
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

export class CommandProcessor {
  private commands: Map<string, Command> = new Map();

  constructor() {
    this.registerCommands();
  }

  private registerCommands(): void {
    const commandList: Command[] = [
      {
        name: 'help',
        description: 'Lists available commands',
        execute: (_args, playerId, gameState, sendPrivate) => {
          const player = gameState.getPlayersMap().get(playerId);
          const isAdmin = player?.isAdmin ?? false;
          const lines = Array.from(this.commands.values())
            .filter((c) => !c.adminOnly || isAdmin)
            .map((c) => `/${c.name} - ${c.description}`);
          if (!isAdmin && ADMIN_PASSWORD) {
            lines.push('/admin <password> - Unlock admin commands');
          }
          sendPrivate(`SYSTEM: AVAILABLE COMMANDS:\n${lines.join('\n')}`);
        },
      },
      {
        name: 'shields',
        description: 'Toggles invulnerability on your spaceship',
        adminOnly: true,
        execute: (_args, playerId, gameState, sendPrivate, broadcast) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (player) {
            player.invulnerable = !player.invulnerable;
            player.invulnerableTimer = player.invulnerable ? 999999 : 0;
            const status = player.invulnerable ? 'ACTIVATED' : 'DEACTIVATED';
            sendPrivate(`SYSTEM: Shields ${status}.`);
            broadcast(`SYSTEM: Player ${player.name} shields are ${status}.`);
          } else {
            sendPrivate('SYSTEM: Player entity not found.');
          }
        },
      },
      {
        name: 'speed',
        description: 'Set engine thrust speed multiplier (e.g. /speed 2)',
        adminOnly: true,
        execute: (args, playerId, gameState, sendPrivate) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }
          const multiplier = parseFloat(args[0]);
          if (isNaN(multiplier) || multiplier <= 0 || multiplier > 5) {
            sendPrivate('SYSTEM: Invalid speed multiplier. Use 0.1–5.0 (e.g. /speed 2.5).');
            return;
          }
          const baseThrust = 0.15;
          player.thrustAcc = baseThrust * multiplier;
          sendPrivate(`SYSTEM: Thrust speed multiplier set to ${multiplier}x.`);
        },
      },
      {
        name: 'score',
        description: 'Sets your score (e.g. /score 5000)',
        adminOnly: true,
        execute: (args, playerId, gameState, sendPrivate, broadcast) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }
          const targetScore = parseInt(args[0], 10);
          if (isNaN(targetScore) || targetScore < 0) {
            sendPrivate('SYSTEM: Invalid score. Use a positive integer.');
            return;
          }
          player.score = targetScore;
          sendPrivate(`SYSTEM: Score updated to ${targetScore}.`);
          broadcast(`SYSTEM: Player ${player.name} updated score to ${targetScore}.`);
        },
      },
      {
        name: 'color',
        description: 'Changes your spaceship color (e.g. /color cyan)',
        execute: (args, playerId, gameState, sendPrivate, broadcast) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }
          const newColor = args[0];
          if (!newColor) {
            sendPrivate('SYSTEM: Specify a color (e.g. /color cyan, /color #FF00E4).');
            return;
          }
          const isValidColor = /^(#[0-9A-F]{6}|[a-z]{3,12})$/i.test(newColor);
          if (!isValidColor) {
            sendPrivate('SYSTEM: Invalid color. Use names or hex (e.g. #00ffff).');
            return;
          }
          player.color = newColor;
          sendPrivate(`SYSTEM: Spaceship color updated to ${newColor}.`);
          broadcast(`SYSTEM: Player ${player.name} color updated to ${newColor}.`);
        },
      },
      {
        name: 'spawn',
        description: 'Spawns large asteroids (e.g. /spawn 3)',
        adminOnly: true,
        execute: (args, _playerId, gameState, sendPrivate, broadcast) => {
          const count = parseInt(args[0], 10) || 1;
          if (count < 1 || count > 10) {
            sendPrivate('SYSTEM: Spawn limit is 1–10 large asteroids.');
            return;
          }
          for (let i = 0; i < count; i++) {
            gameState.spawnNewLargeAsteroid();
          }
          broadcast(`SYSTEM: Spawned ${count} new large asteroid(s).`);
        },
      },
      {
        name: 'maxasteroids',
        description: 'Set minimum large asteroid count (e.g. /maxasteroids 4)',
        adminOnly: true,
        execute: (args, _playerId, gameState, sendPrivate, broadcast) => {
          const n = parseInt(args[0], 10);
          if (isNaN(n) || n < 0 || n > 50) {
            sendPrivate('SYSTEM: Use an integer from 0 to 50.');
            return;
          }
          gameState.runtimeConfig.asteroidMinCount = n;
          sendPrivate(`SYSTEM: Minimum large asteroids set to ${n}.`);
          broadcast(`SYSTEM: Minimum large asteroids set to ${n}.`);
        },
      },
      {
        name: 'maxtotal',
        description: 'Set max total asteroids (e.g. /maxtotal 30)',
        adminOnly: true,
        execute: (args, _playerId, gameState, sendPrivate, broadcast) => {
          const n = parseInt(args[0], 10);
          if (isNaN(n) || n < 1 || n > 100) {
            sendPrivate('SYSTEM: Use an integer from 1 to 100.');
            return;
          }
          gameState.runtimeConfig.asteroidMaxCount = n;
          sendPrivate(`SYSTEM: Max total asteroids set to ${n}.`);
          broadcast(`SYSTEM: Max total asteroids set to ${n}.`);
        },
      },
      {
        name: 'split',
        description: 'Toggle asteroid splitting (e.g. /split off)',
        adminOnly: true,
        execute: (args, _playerId, gameState, sendPrivate, broadcast) => {
          const arg = (args[0] ?? '').toLowerCase();
          if (arg === 'on' || arg === 'true' || arg === '1') {
            gameState.runtimeConfig.asteroidSplitEnabled = true;
            sendPrivate('SYSTEM: Asteroid splitting enabled.');
            broadcast('SYSTEM: Asteroid splitting enabled.');
          } else if (arg === 'off' || arg === 'false' || arg === '0') {
            gameState.runtimeConfig.asteroidSplitEnabled = false;
            sendPrivate('SYSTEM: Asteroid splitting disabled.');
            broadcast('SYSTEM: Asteroid splitting disabled.');
          } else {
            sendPrivate('SYSTEM: Usage: /split on | /split off');
          }
        },
      },
    ];

    commandList.forEach((cmd) => this.commands.set(cmd.name, cmd));
  }

  private handleAdminCommand(
    args: string[],
    playerId: string,
    gameState: GameState,
    sendPrivateFeedback: (text: string) => void
  ): void {
    if (!ADMIN_PASSWORD) {
      sendPrivateFeedback('SYSTEM: Admin mode is not enabled on this server.');
      return;
    }

    const player = gameState.getPlayersMap().get(playerId);
    if (!player) {
      sendPrivateFeedback('SYSTEM: Player entity not found.');
      return;
    }

    const sub = (args[0] ?? '').toLowerCase();

    if (sub === 'off') {
      if (!player.isAdmin) {
        sendPrivateFeedback('SYSTEM: Admin mode is not active.');
        return;
      }
      player.isAdmin = false;
      sendPrivateFeedback('SYSTEM: Admin mode deactivated.');
      return;
    }

    if (sub === 'status') {
      if (!player.isAdmin) {
        sendPrivateFeedback('SYSTEM: Access denied.');
        return;
      }
      const cfg = gameState.getRuntimeConfig();
      sendPrivateFeedback(
        `SYSTEM: ADMIN STATUS\n` +
          `min large asteroids: ${cfg.asteroidMinCount}\n` +
          `max total asteroids: ${cfg.asteroidMaxCount}\n` +
          `splitting: ${cfg.asteroidSplitEnabled ? 'on' : 'off'}`
      );
      return;
    }

    const password = args.join(' ');
    if (password === ADMIN_PASSWORD) {
      player.isAdmin = true;
      sendPrivateFeedback('SYSTEM: Admin mode activated.');
    } else {
      sendPrivateFeedback('SYSTEM: Access denied.');
    }
  }

  public process(
    playerId: string,
    rawText: string,
    gameState: GameState,
    sendPrivateFeedback: (text: string) => void,
    broadcastSystemMessage: (text: string) => void
  ): boolean {
    if (!rawText.startsWith('/')) {
      return false;
    }

    const parts = rawText.slice(1).trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmdName === 'admin') {
      this.handleAdminCommand(args, playerId, gameState, sendPrivateFeedback);
      return true;
    }

    const command = this.commands.get(cmdName);
    if (!command) {
      sendPrivateFeedback(`SYSTEM: Unknown command /${cmdName}. Type /help for assistance.`);
      return true;
    }

    if (command.adminOnly) {
      const player = gameState.getPlayersMap().get(playerId);
      if (!player?.isAdmin) {
        sendPrivateFeedback('SYSTEM: Admin required. Use /admin <password>.');
        return true;
      }
    }

    try {
      command.execute(args, playerId, gameState, sendPrivateFeedback, broadcastSystemMessage);
    } catch (e: any) {
      sendPrivateFeedback(`SYSTEM: Error running command: ${e.message}`);
    }

    return true;
  }
}

export const commandProcessor = new CommandProcessor();
