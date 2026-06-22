import { GameRenderer } from './game/GameRenderer.js';
import { ParticleSystem } from './game/ParticleSystem.js';
import { GameClient } from './game/GameClient.js';
import { ChatMessage } from '../shared/types.js';
import { audioSynthesizer } from './game/AudioSynthesizer.js';

// DOM Element references
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const joinModal = document.getElementById('join-modal') as HTMLElement;
const joinForm = document.getElementById('join-form') as HTMLFormElement;
const playerNameInput = document.getElementById('player-name') as HTMLInputElement;
const leaderboardList = document.getElementById('leaderboard-list') as HTMLElement;
const scoreValue = document.getElementById('player-score') as HTMLElement;
const statusValue = document.getElementById('player-status') as HTMLElement;
const playerCountBadge = document.getElementById('player-count') as HTMLElement;
const connectionIndicator = document.getElementById('connection-indicator') as HTMLElement;
const deathOverlay = document.getElementById('death-overlay') as HTMLElement;
const respawnCountdown = document.getElementById('respawn-countdown') as HTMLElement;

// Mobile controls references
const btnLeft = document.getElementById('btn-left') as HTMLButtonElement;
const btnRight = document.getElementById('btn-right') as HTMLButtonElement;
const btnThrust = document.getElementById('btn-thrust') as HTMLButtonElement;
const btnShoot = document.getElementById('btn-shoot') as HTMLButtonElement;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const chatMessages = document.getElementById('chat-messages') as HTMLElement;
const soundToggle = document.getElementById('sound-toggle') as HTMLButtonElement;
const gameVersion = document.getElementById('game-version') as HTMLElement;

const MAX_CHAT_MESSAGES = 50;

gameVersion.textContent = `v${__APP_VERSION__}`;

// Initialize components
const particles = new ParticleSystem();
const renderer = new GameRenderer(canvas);

// Initialize GameClient
const client = new GameClient(particles, {
  onLeaderboardUpdate: (list) => {
    leaderboardList.innerHTML = '';
    
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-leaderboard';
      li.textContent = 'Awaiting players...';
      leaderboardList.appendChild(li);
      return;
    }

    list.forEach((entry, idx) => {
      const li = document.createElement('li');
      
      // Highlight the local player in white vector, others in their colors
      const isLocal = entry.id === client.localPlayerId;
      if (isLocal) {
        li.style.color = '#ffffff';
        li.style.fontWeight = 'bold';
        li.style.textShadow = '0 0 5px rgba(255, 255, 255, 0.8)';
      } else {
        li.style.color = entry.color;
        li.style.textShadow = `0 0 4px ${entry.color}80`;
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name-tag';
      nameSpan.textContent = `${idx + 1}. ${isLocal ? '▶ ' : ''}${entry.name}`;

      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = entry.score.toString().padStart(6, '0');

      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      leaderboardList.appendChild(li);
    });
  },

  onConnectionStatusChange: (status) => {
    connectionIndicator.className = `connection-indicator ${status}`;
    if (status === 'connecting') {
      connectionIndicator.textContent = 'CONNECTING...';
    } else if (status === 'connected') {
      connectionIndicator.textContent = 'ONLINE';
    } else {
      connectionIndicator.textContent = 'OFFLINE';
      particles.clear();
      // Show join modal on disconnect
      joinModal.classList.remove('hidden');
    }
  },

  onPlayerCountChange: (count) => {
    playerCountBadge.textContent = `PLAYERS: ${count}`;
  },

  onPlayerScoreUpdate: (score) => {
    scoreValue.textContent = score.toString().padStart(6, '0');
  },

  onLocalPlayerDeath: (respawnTimer) => {
    statusValue.textContent = 'DESTROYED';
    statusValue.className = 'hud-value status-dead';
    deathOverlay.classList.remove('hidden');
    
    const secondsLeft = Math.ceil(respawnTimer / 60);
    respawnCountdown.textContent = `RESPAWNING IN ${secondsLeft}...`;
  },

  onLocalPlayerRespawn: () => {
    statusValue.textContent = 'ALIVE';
    statusValue.className = 'hud-value status-alive';
    deathOverlay.classList.add('hidden');
  },

  onChatMessage: (msg) => {
    appendChatMessage(msg);
  },

  onChatHistory: (messages) => {
    clearChatMessages();
    if (messages.length === 0) {
      appendChatMessage(createWelcomeMessage());
    } else {
      messages.forEach(appendChatMessage);
    }
  }
});

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    senderId: 'system',
    senderName: 'SYSTEM',
    senderColor: '#39ff14',
    text: 'Welcome to the grid. Type /help for slash commands.',
    isSystem: true,
    timestamp: Date.now(),
  };
}

function formatChatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return time;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function clearChatMessages(): void {
  chatMessages.innerHTML = '';
}

function appendChatMessage(msg: ChatMessage): void {
  const div = document.createElement('div');
  div.className = msg.isSystem ? 'chat-msg system-msg' : 'chat-msg';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-timestamp';
  timeSpan.textContent = `[${formatChatTimestamp(msg.timestamp)}] `;
  div.appendChild(timeSpan);

  if (msg.isSystem) {
    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.textContent = msg.text;
    div.appendChild(textSpan);
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'sender-name';
    nameSpan.style.color = msg.senderColor;
    nameSpan.textContent = `${msg.senderName}:`;

    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.textContent = ` ${msg.text}`;

    div.appendChild(nameSpan);
    div.appendChild(textSpan);
  }

  chatMessages.appendChild(div);

  while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
    chatMessages.removeChild(chatMessages.firstChild!);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Capture Touch & Mouse Events for Mobile Gamepad buttons
// We support both to allow testing using mouse clicks inside the browser dev simulator
function setupMobileButton(button: HTMLButtonElement, actionSetter: (state: boolean) => void) {
  const press = (e: Event) => {
    e.preventDefault();
    actionSetter(true);
  };
  const release = (e: Event) => {
    e.preventDefault();
    actionSetter(false);
  };

  button.addEventListener('touchstart', press, { passive: false });
  button.addEventListener('touchend', release, { passive: false });
  button.addEventListener('touchcancel', release, { passive: false });
  
  button.addEventListener('mousedown', press);
  button.addEventListener('mouseup', release);
  button.addEventListener('mouseleave', release);
}

setupMobileButton(btnLeft, (state) => { client.touchLeft = state; });
setupMobileButton(btnRight, (state) => { client.touchRight = state; });
setupMobileButton(btnThrust, (state) => { client.touchThrust = state; });
setupMobileButton(btnShoot, (state) => { client.touchShoot = state; });

function updateSoundToggle(muted: boolean): void {
  soundToggle.textContent = muted ? '🔇' : '🔊';
  soundToggle.classList.toggle('muted', muted);
  soundToggle.setAttribute('aria-pressed', String(muted));
  soundToggle.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  soundToggle.title = muted ? 'Enable sound' : 'Disable sound';
}

soundToggle.addEventListener('click', () => {
  audioSynthesizer.init();
  updateSoundToggle(audioSynthesizer.toggleMute());
});

// Resize handler
function handleResize() {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleResize);
handleResize(); // Initial call

// Chat form handler
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  if (text.toLowerCase() === '/clear') {
    clearChatMessages();
    chatInput.value = '';
    return;
  }

  client.sendChatMessage(text);
  chatInput.value = '';
});

// Join button form handler
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  if (name) {
    client.join(name);
    joinModal.classList.add('hidden');
    handleResize(); // Re-trigger canvas alignment after layout changes
  }
});

// ANIMATION RENDER LOOP (Synchronized to Screen Refresh Rate)
function gameLoop() {
  if (client.isConnected) {
    client.update();
  }

  // Draw screen using client interpolated coordinates
  const state = client.getExtrapolatedState();
  renderer.render(
    state.players,
    state.asteroids,
    state.bullets,
    particles,
    client.localPlayerId
  );

  requestAnimationFrame(gameLoop);
}

// Start Client connection and animation loop
client.connect();
requestAnimationFrame(gameLoop);
