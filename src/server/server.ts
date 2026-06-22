import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatMessage, GAME_CONFIG, ServerMessage } from '../shared/types.js';
import { ChatDatabase } from './db/ChatDatabase.js';
import { GameState } from './game/GameState.js';
import { commandProcessor } from './game/CommandProcessor.js';
import { Player } from './game/Entities.js';

// Resolve directory paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express and HTTP server setup
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;

// Serve static client build files
const clientDistPath = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDistPath));

// Fallback to index.html for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Map to track active WebSocket connections to player IDs
const clients = new Map<string, WebSocket>();

const CHAT_HISTORY_LIMIT = 10;
const chatDb = new ChatDatabase();

// Initialize GameState with effect emitter callback
const gameState = new GameState((effectType, data) => {
  // Broadcast effects to all connected players
  broadcast({
    type: 'effect',
    payload: { effectType, data },
  });
});

// Upgrade HTTP request to WebSocket connection
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

let connectionIdCounter = 0;

wss.on('connection', (ws: WebSocket) => {
  const playerId = `p_${connectionIdCounter++}`;
  clients.set(playerId, ws);

  // Assign a default player in the state (reset before add so spawn isn't cleared)
  gameState.resetBroadcastState();
  gameState.addPlayer(playerId, `Player_${playerId.slice(2)}`);
  const newPlayer = gameState.getPlayersMap().get(playerId);
  if (newPlayer) {
    broadcastPlayerSpawn(newPlayer);
  }

  // Initialize client with configuration and their personal ID
  sendToClient(ws, {
    type: 'init',
    payload: {
      playerId,
      config: {
        fieldWidth: GAME_CONFIG.FIELD_WIDTH,
        fieldHeight: GAME_CONFIG.FIELD_HEIGHT,
        tickRate: GAME_CONFIG.TICK_RATE,
        broadcastRate: GAME_CONFIG.BROADCAST_RATE,
      },
    },
  });

  // Full world snapshot (bullets extrapolated client-side from spawn events)
  sendToClient(ws, {
    type: 'snapshot',
    payload: gameState.getFullSnapshot(),
  });

  // Send initial leaderboard update
  broadcastLeaderboard();

  // Send recent chat history to the newly connected client
  sendChatHistory(ws);

  // Listen for client messages
  ws.on('message', (messageData: string) => {
    try {
      const message = JSON.parse(messageData);

      switch (message.type) {
        case 'join':
          if (message.payload && typeof message.payload.name === 'string') {
            gameState.removePlayer(playerId);
            broadcastEntityDespawn([playerId]);
            gameState.addPlayer(playerId, message.payload.name);
            const joinedPlayer = gameState.getPlayersMap().get(playerId);
            if (joinedPlayer) {
              broadcastPlayerSpawn(joinedPlayer);
            }
            broadcastLeaderboard();
          }
          break;

        case 'input':
          if (message.payload) {
            gameState.updatePlayerInput(playerId, message.payload);
          }
          break;

        case 'chat':
          if (message.payload && typeof message.payload.text === 'string') {
            const rawText = message.payload.text.trim();
            if (rawText.length === 0) return;

            // Intercept and process slash commands
            const isCommand = commandProcessor.process(
              playerId,
              rawText,
              gameState,
              (feedback) => sendSystemMessage(ws, feedback),
              (announcement) => broadcastSystemMessage(announcement)
            );

            if (!isCommand) {
              const player = gameState.getPayload().players.find(p => p.id === playerId);
              if (player) {
                broadcastChatMessage({
                  senderId: playerId,
                  senderName: player.name,
                  senderColor: player.color,
                  text: rawText.slice(0, 150),
                  isSystem: false,
                });
              }
            }
          }
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('Failed to process client message:', err);
    }
  });

  // Handle player disconnects
  ws.on('close', () => {
    clients.delete(playerId);
    gameState.removePlayer(playerId);
    broadcastEntityDespawn([playerId]);
    broadcastLeaderboard();
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for player ${playerId}:`, err);
  });
});

// Send message helper
function sendToClient(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Broadcast message to all clients
function broadcast(msg: ServerMessage) {
  const json = JSON.stringify(msg);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  });
}

function broadcastPlayerSpawn(player: Player): void {
  broadcast({
    type: 'spawn',
    payload: { p: [player.serializeCompactSpawn()] },
  });
}

function broadcastEntityDespawn(ids: string[]): void {
  if (ids.length === 0) return;
  broadcast({ type: 'despawn', payload: { ids } });
}

// Broadcast leaderboards to all clients
function broadcastLeaderboard() {
  broadcast({
    type: 'leaderboard',
    payload: gameState.getLeaderboard(),
  });
}

function createChatMessage(
  fields: Omit<ChatMessage, 'id' | 'timestamp'> & { timestamp?: number }
): ChatMessage {
  const prefix = fields.isSystem ? 'sys' : 'chat';
  return {
    id: `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: fields.timestamp ?? Date.now(),
    senderId: fields.senderId,
    senderName: fields.senderName,
    senderColor: fields.senderColor,
    text: fields.text,
    isSystem: fields.isSystem,
  };
}

function persistAndSendChat(msg: ChatMessage, ws?: WebSocket): void {
  chatDb.saveMessage(msg);
  const payload: ServerMessage = { type: 'chat', payload: msg };
  if (ws) {
    sendToClient(ws, payload);
  } else {
    broadcast(payload);
  }
}

function broadcastChatMessage(
  fields: Omit<ChatMessage, 'id' | 'timestamp'>
): void {
  persistAndSendChat(createChatMessage(fields));
}

function sendChatHistory(ws: WebSocket): void {
  sendToClient(ws, {
    type: 'chatHistory',
    payload: chatDb.getRecentMessages(CHAT_HISTORY_LIMIT),
  });
}

// Send private system message to a specific client
function sendSystemMessage(ws: WebSocket, text: string) {
  persistAndSendChat(createChatMessage({
    senderId: 'system',
    senderName: 'SYSTEM',
    senderColor: '#39ff14',
    text,
    isSystem: true,
  }), ws);
}

// Broadcast system message to all clients
function broadcastSystemMessage(text: string) {
  broadcastChatMessage({
    senderId: 'system',
    senderName: 'SYSTEM',
    senderColor: '#39ff14',
    text,
    isSystem: true,
  });
}

// SERVER GAME LOOP (60 Ticks per second)
let ticks = 0;
const tickInterval = 1000 / GAME_CONFIG.TICK_RATE;
const broadcastEveryNTicks = Math.round(GAME_CONFIG.TICK_RATE / GAME_CONFIG.BROADCAST_RATE);

setInterval(() => {
  gameState.tick();
  ticks++;

  if (ticks % broadcastEveryNTicks === 0) {
    const delta = gameState.collectDelta();
    if (delta) {
      broadcast({ type: 'delta', payload: delta });
    }
  }

  if (ticks % GAME_CONFIG.FULL_RESYNC_INTERVAL_TICKS === 0) {
    gameState.resetBroadcastState();
    broadcast({ type: 'snapshot', payload: gameState.getFullSnapshot() });
  }

  if (ticks % 120 === 0) {
    broadcastLeaderboard();
  }
}, tickInterval);

// Start Server
server.listen(PORT, () => {
  const adminEnabled = Boolean(process.env.ADMIN_PASSWORD);
  console.log(`=============================================`);
  console.log(`🎮 Multi-player Retro Asteroids Server Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(
    adminEnabled
      ? `🔐 Admin: enabled (use /admin <password> in chat)`
      : `🔓 Admin: disabled (set ADMIN_PASSWORD in .env to enable)`
  );
  console.log(`=============================================`);
});

process.on('SIGINT', () => {
  chatDb.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  chatDb.close();
  process.exit(0);
});
