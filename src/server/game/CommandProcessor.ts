import { GameState } from './GameState.js';

export interface Command {
  name: string;
  description: string;
  execute(
    args: string[],
    playerId: string,
    gameState: GameState,
    sendPrivateFeedback: (text: string) => void,
    broadcastSystemMessage: (text: string) => void
  ): void;
}

export class CommandProcessor {
  private commands: Map<string, Command> = new Map();

  constructor() {
    this.registerCommands();
  }

  private registerCommands(): void {
    const commandList: Command[] = [
      {
        name: 'help',
        description: 'Lists all available commands',
        execute: (_args, _playerId, _gameState, sendPrivate) => {
          const helpLines = Array.from(this.commands.values())
            .map(c => `/${c.name} - ${c.description}`)
            .join('\n');
          sendPrivate(`SYSTEM: AVAILABLE COMMANDS:\n${helpLines}`);
        }
      },
      {
        name: 'shields',
        description: 'Toggles invulnerability on your spaceship',
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
        }
      },
      {
        name: 'speed',
        description: 'Set engine thrust speed multiplier (e.g. /speed 2, /speed 1)',
        execute: (args, playerId, gameState, sendPrivate) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }

          const multiplier = parseFloat(args[0]);
          if (isNaN(multiplier) || multiplier <= 0 || multiplier > 5) {
            sendPrivate('SYSTEM: Invalid speed multiplier. Please specify a number between 0.1 and 5.0 (e.g., /speed 2.5).');
            return;
          }

          const baseThrust = 0.15; // Player's default thrustAcc
          player.thrustAcc = baseThrust * multiplier;
          sendPrivate(`SYSTEM: Thrust speed multiplier set to ${multiplier}x (acc: ${player.thrustAcc.toFixed(3)}).`);
        }
      },
      {
        name: 'score',
        description: 'Sets your score to the given value (e.g. /score 5000)',
        execute: (args, playerId, gameState, sendPrivate, broadcast) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }

          const targetScore = parseInt(args[0], 10);
          if (isNaN(targetScore) || targetScore < 0) {
            sendPrivate('SYSTEM: Invalid score value. Please specify a positive integer.');
            return;
          }

          player.score = targetScore;
          sendPrivate(`SYSTEM: Score updated to ${targetScore}.`);
          broadcast(`SYSTEM: Player ${player.name} updated score to ${targetScore}.`);
        }
      },
      {
        name: 'color',
        description: 'Changes your spaceship color (e.g. /color #ff00ff or /color red)',
        execute: (args, playerId, gameState, sendPrivate, broadcast) => {
          const player = gameState.getPlayersMap().get(playerId);
          if (!player) {
            sendPrivate('SYSTEM: Player entity not found.');
            return;
          }

          const newColor = args[0];
          if (!newColor) {
            sendPrivate('SYSTEM: Please specify a color (e.g., /color cyan, /color #FF00E4).');
            return;
          }

          // Simple color validation (regex or basic length checks)
          // Supporting basic color names or hex codes
          const isValidColor = /^(#[0-9A-F]{6}|[a-z]{3,12})$/i.test(newColor);
          if (!isValidColor) {
            sendPrivate('SYSTEM: Invalid color code. Use standard names or hex values (e.g., #00ffff).');
            return;
          }

          player.color = newColor;
          sendPrivate(`SYSTEM: Spaceship color updated to ${newColor}.`);
          broadcast(`SYSTEM: Player ${player.name} color updated to ${newColor}.`);
        }
      },
      {
        name: 'spawn',
        description: 'Spawns a specified number of large asteroids (e.g. /spawn 3)',
        execute: (args, _playerId, gameState, sendPrivate, broadcast) => {
          const count = parseInt(args[0], 10) || 1;
          if (count < 1 || count > 10) {
            sendPrivate('SYSTEM: Spawn limit is between 1 and 10 large asteroids.');
            return;
          }

          for (let i = 0; i < count; i++) {
            gameState.spawnNewLargeAsteroid();
          }
          broadcast(`SYSTEM: Spawned ${count} new large asteroid(s).`);
        }
      }
    ];

    commandList.forEach(cmd => this.commands.set(cmd.name, cmd));
  }

  public process(
    playerId: string,
    rawText: string,
    gameState: GameState,
    sendPrivateFeedback: (text: string) => void,
    broadcastSystemMessage: (text: string) => void
  ): boolean {
    // Check if it's a slash command
    if (!rawText.startsWith('/')) {
      return false;
    }

    const parts = rawText.slice(1).trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const command = this.commands.get(cmdName);
    if (!command) {
      sendPrivateFeedback(`SYSTEM: Unknown command /${cmdName}. Type /help for assistance.`);
      return true; // We intercepted it as a command, even though it was invalid
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
