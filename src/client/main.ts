import { GameRenderer } from './game/GameRenderer.js';
import { ParticleSystem } from './game/ParticleSystem.js';
import { GameClient } from './game/GameClient.js';
import { ChatMessage } from '../shared/types.js';
import { audioSynthesizer } from './game/AudioSynthesizer.js';
import { getSavedPlayerName, hasSavedPlayerName, savePlayerName } from './playerNameStorage.js';
import packageJson from '../../package.json' with { type: 'json' };

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
const mobileChatMessages = document.getElementById('mobile-chat-messages') as HTMLElement;
const mobileChatOpenBtn = document.getElementById('mobile-chat-open') as HTMLButtonElement;
const mobileChatModal = document.getElementById('mobile-chat-modal') as HTMLElement;
const mobileChatForm = document.getElementById('mobile-chat-form') as HTMLFormElement;
const mobileChatInput = document.getElementById('mobile-chat-input') as HTMLInputElement;
const mobileChatCancelBtn = document.getElementById('mobile-chat-cancel') as HTMLButtonElement;
const soundToggle = document.getElementById('sound-toggle') as HTMLButtonElement;
const gameVersion = document.getElementById('game-version') as HTMLElement;

const MAX_CHAT_MESSAGES = 50;
const MOBILE_CHAT_VISIBLE = 3;

gameVersion.textContent = `v${packageJson.version}`;

function joinWithName(name: string): void {
  savePlayerName(name);
  client.join(name);
  joinModal.classList.add('hidden');
  handleResize();
}

const savedPlayerName = getSavedPlayerName();
if (savedPlayerName) {
  playerNameInput.value = savedPlayerName;
}

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
      if (!hasSavedPlayerName()) {
        joinModal.classList.remove('hidden');
      }
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
  mobileChatMessages.innerHTML = '';
}

function trimChatContainer(container: HTMLElement, maxMessages: number): void {
  while (container.children.length > maxMessages) {
    container.removeChild(container.firstChild!);
  }
}

function createChatMessageElement(msg: ChatMessage, compact = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = msg.isSystem ? 'chat-msg system-msg' : 'chat-msg';

  if (!compact) {
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-timestamp';
    timeSpan.textContent = `[${formatChatTimestamp(msg.timestamp)}] `;
    div.appendChild(timeSpan);
  }

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

  return div;
}

function appendChatMessage(msg: ChatMessage): void {
  chatMessages.appendChild(createChatMessageElement(msg));
  trimChatContainer(chatMessages, MAX_CHAT_MESSAGES);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  mobileChatMessages.appendChild(createChatMessageElement(msg, true));
  trimChatContainer(mobileChatMessages, MOBILE_CHAT_VISIBLE);
}

function sendChatText(text: string, ...inputs: HTMLInputElement[]): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed.toLowerCase() === '/clear') {
    clearChatMessages();
    inputs.forEach((input) => {
      input.value = '';
    });
    return;
  }

  client.sendChatMessage(trimmed);
  inputs.forEach((input) => {
    input.value = '';
  });
}

function openMobileChatModal(): void {
  mobileChatModal.classList.remove('hidden');
  mobileChatModal.setAttribute('aria-hidden', 'false');
  mobileChatInput.value = '';
  requestAnimationFrame(() => mobileChatInput.focus());
}

function closeMobileChatModal(): void {
  mobileChatModal.classList.add('hidden');
  mobileChatModal.setAttribute('aria-hidden', 'true');
  mobileChatInput.value = '';
}

// Mobile gamepad: hold-to-act via pointer capture so release is detected even if the finger slides off.
function setupMobileButton(button: HTMLButtonElement, actionSetter: (state: boolean) => void) {
  let activePointerId: number | null = null;

  const setActive = (active: boolean) => {
    actionSetter(active);
    client.syncInput();
  };

  button.addEventListener('pointerdown', (e) => {
    if (activePointerId !== null) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    button.setPointerCapture(e.pointerId);
    setActive(true);
  });

  const release = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    e.preventDefault();
    activePointerId = null;
    if (button.hasPointerCapture(e.pointerId)) {
      button.releasePointerCapture(e.pointerId);
    }
    setActive(false);
  };

  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => {
    if (activePointerId === null) return;
    activePointerId = null;
    setActive(false);
  });
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
  sendChatText(chatInput.value, chatInput);
});

mobileChatOpenBtn.addEventListener('click', () => {
  openMobileChatModal();
});

mobileChatCancelBtn.addEventListener('click', () => {
  closeMobileChatModal();
});

mobileChatModal.addEventListener('click', (e) => {
  if (e.target === mobileChatModal) {
    closeMobileChatModal();
  }
});

mobileChatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendChatText(mobileChatInput.value, mobileChatInput, chatInput);
  closeMobileChatModal();
});

// Join button form handler
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  if (name) {
    joinWithName(name);
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

// Start animation loop; WebSocket connects when the join form is submitted
requestAnimationFrame(gameLoop);
