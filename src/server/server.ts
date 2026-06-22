import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatMessage, GAME_CONFIG, ServerMessage } from '../shared/types.js';
import { ChatDatabase } from './db/ChatDatabase.js';
import { GameState } from './game/GameState.js';
import { commandProcessor } from './game/CommandProcessor.js';

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

  // Initialize client with configuration and their personal ID
  sendToClient(ws, {
    type: 'init',
    payload: {
      playerId,
      config: {
        fieldWidth: GAME_CONFIG.FIELD_WIDTH,
        fieldHeight: GAME_CONFIG.FIELD_HEIGHT,
      },
    },
  });

  // Assign a default player in the state
  gameState.addPlayer(playerId, `Player_${playerId.slice(2)}`);

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
            gameState.removePlayer(playerId); // clean up old name trigger
            gameState.addPlayer(playerId, message.payload.name);
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

setInterval(() => {
  gameState.tick();
  ticks++;

  // BROADCAST LOOP (Runs state updates to clients)
  // We can broadcast state updates at 60 FPS or 30 FPS.
  // 60 FPS broadcast makes coordinates super-crisp, so let's broadcast every state tick
  // to avoid jitter and provide a true high-fidelity competitive web experience.
  broadcast({
    type: 'state',
    payload: gameState.getPayload(),
  });

  // Periodically update leaderboard every 120 ticks (2 seconds) just to stay in sync
  if (ticks % 120 === 0) {
    broadcastLeaderboard();
  }
}, tickInterval);

// Start Server
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🎮 Multi-player Retro Asteroids Server Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
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
