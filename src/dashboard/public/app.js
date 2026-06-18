// State Management
const state = {
  bots: [],
  queue: [],
  blacklist: [],
  logs: [],
  currentBotId: null,
  currentRoomId: null,
  currentRoomIds: [],
  currentTab: 'pending', // pending, held, blacklist, audit
  questionSet: null,
  qsetGender: 'Female',
  qsetCategory: 'General',
  botTimerInterval: null
};

// Connect to Socket.IO Server
const socket = io();

// UI Elements
const statusIndicator = document.querySelector('.status-indicator');
const statusText = document.querySelector('.status-text');

// Connection Event Handlers
socket.on('connect', () => {
  statusIndicator.className = 'status-indicator online';
  statusText.textContent = 'Connected (Live)';
});

socket.on('disconnect', () => {
  statusIndicator.className = 'status-indicator offline';
  statusText.textContent = 'Disconnected';
});

socket.on('connect_error', () => {
  statusIndicator.className = 'status-indicator offline';
  statusText.textContent = 'Connection Error';
});

// Init Event Handlers
socket.on('init:bots', (bots) => {
  state.bots = bots;
  renderBots();
});

socket.on('init:queue', (queue) => {
  state.queue = queue;
  renderQueues();
  updateBadges();
});

socket.on('init:blacklist', (blacklist) => {
  state.blacklist = blacklist;
  renderBlacklist();
});

socket.on('init:logs', (logs) => {
  state.logs = logs;
  renderAuditLogs();
});

socket.on('init:question_set', (questionSet) => {
  state.questionSet = questionSet;
  renderQuestionSet();
});

// Update Event Handlers
socket.on('update:bots', (bots) => {
  state.bots = bots;
  renderBots();
  if (state.currentBotId) {
    updateRoomsView();
  }
});

socket.on('update:blacklist', (blacklist) => {
  state.blacklist = blacklist;
  renderBlacklist();
});

socket.on('update:logs', (logs) => {
  state.logs = logs;
  renderAuditLogs();
});

socket.on('auto_approve:status', (data) => {
  const { botId, autoApprove } = data;
  const bot = state.bots.find(b => b.botId === botId);
  if (bot) {
    bot.autoApprove = autoApprove;
    renderBots();
    if (state.currentBotId === botId) {
      updateAutoApproveBtn();
    }
  }
});

// Real-time Event Handlers
socket.on('moderation:new_item', (item) => {
  // Add item if not already in queue
  if (!state.queue.find(q => q._id === item._id)) {
    state.queue.push(item);
    renderQueues();
    updateBadges();
    playNotificationSound();
  }
});

socket.on('moderation:item_updated', (update) => {
  const { queueId, status } = update;
  // Update local queue item status
  const item = state.queue.find(q => q._id === queueId);
  if (item) {
    item.status = status;
    // Remove if it's no longer pending or held
    if (status !== 'pending' && status !== 'held') {
      state.queue = state.queue.filter(q => q._id !== queueId);
    }
    renderQueues();
    updateBadges();
  }
});

// Audio notification helper
function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    // browser blocked audio
  }
}

// Navigation System
function navigateTo(page) {
  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });

  const navBots = document.getElementById('nav-bots');
  const navTerminal = document.getElementById('nav-terminal');

  if (page !== 'moderation') {
    if (state.botTimerInterval) {
      clearInterval(state.botTimerInterval);
      state.botTimerInterval = null;
    }
    const timerPill = document.getElementById('timer-pill');
    if (timerPill) timerPill.style.display = 'none';
  }

  if (page === 'bots') {
    document.getElementById('page-bots').classList.add('active');
    state.currentBotId = null;
    state.currentRoomId = null;
    if (navBots) navBots.classList.add('active');
    if (navTerminal) navTerminal.classList.remove('active');
  } else if (page === 'rooms') {
    document.getElementById('page-rooms').classList.add('active');
    state.currentRoomId = null;
    if (navBots) navBots.classList.add('active');
    if (navTerminal) navTerminal.classList.remove('active');
  } else if (page === 'moderation') {
    document.getElementById('page-moderation').classList.add('active');
    if (navBots) navBots.classList.add('active');
    if (navTerminal) navTerminal.classList.remove('active');
  } else if (page === 'terminal') {
    document.getElementById('page-terminal').classList.add('active');
    if (navBots) navBots.classList.remove('active');
    if (navTerminal) navTerminal.classList.add('active');
    initTerminal();
  }
}

function selectBot(botId) {
  state.currentBotId = botId;
  const bot = state.bots.find(b => b.botId === botId);
  if (bot && bot.rooms && bot.rooms.length > 0) {
    selectRoom(botId, bot.rooms[0].roomId);
  } else {
    navigateTo('bots');
  }
}

function selectRoom(botId, roomId) {
  state.currentBotId = botId;
  state.currentRoomId = roomId;

  const bot = state.bots.find(b => b.botId === botId);
  const room = bot?.rooms.find(r => r.roomId === roomId);
  state.currentRoomIds = room ? room.allRoomIds : [roomId];

  navigateTo('moderation');
  updateModerationView();
}

function refreshBotsData() {
  socket.emit('refresh:bots');
}

function updateAutoApproveBtn() {
  const btn = document.getElementById('auto-approve-btn');
  if (!btn) return;
  const bot = state.bots.find(b => b.botId === state.currentBotId);
  if (!bot) return;

  if (bot.autoApprove) {
    btn.textContent = '🛑 AutoApprovalStop';
    btn.className = 'btn btn-danger btn-icon';
  } else {
    btn.textContent = '⚡ Auto Approve';
    btn.className = 'btn btn-warning btn-icon';
  }
}

function toggleAutoApprove() {
  const botId = state.currentBotId;
  if (!botId) return;

  const bot = state.bots.find(b => b.botId === botId);
  if (!bot) return;

  const targetState = !bot.autoApprove;
  
  socket.emit('action:toggle_auto_approve', { botId, autoApprove: targetState }, (res) => {
    if (!res.success) {
      alert('Failed to toggle auto-approve: ' + res.error);
    }
  });
}

function updateBroadcasterId(botId, btnElement) {
  const container = btnElement.parentElement;
  const input = container.querySelector('.broadcaster-id-input');
  const broadcasterId = input.value.trim();
  
  if (!broadcasterId) {
    alert('Broadcaster ID cannot be empty');
    return;
  }
  
  btnElement.disabled = true;
  btnElement.textContent = 'Saving...';
  
  socket.emit('action:update_broadcaster_id', { botId, broadcasterId }, (res) => {
    btnElement.disabled = false;
    if (res.success) {
      btnElement.textContent = 'Saved!';
      btnElement.classList.remove('btn-secondary');
      btnElement.classList.add('btn-success');
      setTimeout(() => {
        btnElement.textContent = 'Set';
        btnElement.classList.remove('btn-success');
        btnElement.classList.add('btn-secondary');
      }, 1500);
    } else {
      btnElement.textContent = 'Set';
      alert('Failed to update Broadcaster ID: ' + res.error);
    }
  });
}

function launchBot(botId, btnElement) {
  btnElement.disabled = true;
  btnElement.textContent = 'Launching...';
  
  socket.emit('action:launch_bot', { botId }, (res) => {
    if (res.success) {
      setTimeout(() => {
        socket.emit('refresh:bots');
      }, 3000);
    } else {
      btnElement.disabled = false;
      btnElement.textContent = '🚀 Launch';
      alert('Failed to launch bot: ' + res.error);
    }
  });
}

function endBotProcess() {
  const botId = state.currentBotId;
  if (!botId) return;

  if (confirm(`Are you sure you want to stop bot: ${botId}? This will terminate the bot runner process.`)) {
    socket.emit('action:stop_bot', { botId }, (res) => {
      if (res.success) {
        alert('Bot shutdown command sent successfully.');
        navigateTo('bots');
      } else {
        alert('Failed to stop bot: ' + res.error);
      }
    });
  }
}

function getBotImageUrl(botId) {
  if (!botId) return '';
  const clean = botId.endsWith('-bot') ? botId.substring(0, botId.length - 4) : botId;
  const lower = clean.toLowerCase();
  if (lower === 'simran') {
    return '/images/SimranKaur.jpg';
  }
  // Capitalize first letter
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
  return `/images/${cap}.jpg`;
}

function renderBotCardHtml(bot) {
  const isOnline = bot.status === 'online';
  const imageUrl = getBotImageUrl(bot.botId);
  const persona = bot.persona;
  
  let detailsHtml = '';
  if (persona) {
    const age = persona.age ? `${persona.age} yrs` : '';
    const location = persona.location ? `${escapeHtml(persona.location)}` : '';
    const backstory = persona.backstory ? `<p class="bot-backstory-snippet" title="${escapeHtml(persona.backstory)}">${escapeHtml(persona.backstory)}</p>` : '';
    
    let tagsHtml = '';
    if (Array.isArray(persona.interests) && persona.interests.length > 0) {
      tagsHtml = `
        <div class="bot-tags">
          ${persona.interests.map(interest => `<span class="trait-tag">#${escapeHtml(interest)}</span>`).join('')}
        </div>
      `;
    }
    
    detailsHtml = `
      <div class="bot-details-minimal">
        <div class="bot-meta-row">${location} ${age}</div>
        ${backstory}
        ${tagsHtml}
      </div>
    `;
  } else {
    detailsHtml = `
      <div class="bot-details-minimal">
        <div class="bot-meta-row" style="color: var(--text-muted); font-style: italic;">No persona details synced.</div>
      </div>
    `;
  }
  
  return `
    <div class="bot-card ${isOnline ? 'online' : 'offline'}" data-bot-id="${escapeHtml(bot.botId)}">
      <div class="bot-card-top">
        <img class="bot-avatar" src="${imageUrl}" alt="${escapeHtml(bot.displayName)}" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' viewBox=\'0 0 100 100\'><rect width=\'100%\' height=\'100%\' fill=\'%233a3b3c\'/><text x=\'50%\' y=\'55%\' font-family=\'sans-serif\' font-size=\'32\' fill=\'%23a0a0a0\' text-anchor=\'middle\'>🤖</text></svg>';">
        <div class="bot-header">
          <div class="bot-title-area">
            <h3>${escapeHtml(bot.displayName)}</h3>
            <span class="bot-subtitle">${escapeHtml(bot.botId)}</span>
          </div>
          <div class="bot-status-tag ${isOnline ? 'online' : 'offline'}">
            <span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span> ${isOnline ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </div>
      
      ${detailsHtml}
      
      <div class="bot-rooms-stat">
        <span class="label">Connected Rooms</span>
        <span class="value">${bot.roomsCount}</span>
      </div>

      <div class="bot-broadcaster-id-area">
        <div class="label">Broadcaster ID</div>
        <div class="broadcaster-id-form">
          <input type="text" class="broadcaster-id-input" value="${escapeHtml(String(bot.broadcasterId || ''))}" placeholder="Enter ID..." data-bot-id="${escapeHtml(bot.botId)}">
          <button class="btn btn-sm btn-secondary" onclick="updateBroadcasterId('${escapeHtml(bot.botId)}', this)">Set</button>
        </div>
      </div>

      ${isOnline ? `
        <button class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 1rem;" onclick="selectBot('${escapeHtml(bot.botId)}')">
          Open Console &rarr;
        </button>
      ` : `
        <button class="btn btn-success" style="width: 100%; justify-content: center; margin-top: 1rem;" onclick="launchBot('${escapeHtml(bot.botId)}', this)">
          🚀 Launch
        </button>
      `}
    </div>
  `;
}

// Rendering Functions
function renderBots() {
  const grid = document.getElementById('bots-grid');
  if (state.bots.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🤖</div>
        <h3>No bots detected</h3>
        <p>Ensure your BotRunner configurations are available.</p>
        <button class="btn btn-primary" onclick="refreshBotsData()" style="margin-top: 1rem;">🔄 Retry Scan</button>
      </div>
    `;
    return;
  }

  // If the grid has no cards yet, perform a full initial render
  if (!grid.querySelector('.bot-card')) {
    grid.innerHTML = state.bots.map(bot => renderBotCardHtml(bot)).join('');
    return;
  }

  // Otherwise, update existing cards in-place to preserve inputs, typed values, and active focus!
  state.bots.forEach(bot => {
    const card = grid.querySelector(`.bot-card[data-bot-id="${bot.botId}"]`);
    if (card) {
      const isOnline = bot.status === 'online';
      
      // Update card classes
      card.className = `bot-card ${isOnline ? 'online' : 'offline'}`;
      
      // Update status tag
      const statusTag = card.querySelector('.bot-status-tag');
      if (statusTag) {
        statusTag.className = `bot-status-tag ${isOnline ? 'online' : 'offline'}`;
        statusTag.innerHTML = `<span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span> ${isOnline ? 'ONLINE' : 'OFFLINE'}`;
      }
      
      // Update rooms count value
      const roomsVal = card.querySelector('.bot-rooms-stat .value');
      if (roomsVal) {
        roomsVal.textContent = bot.roomsCount;
      }
      
      // Update Broadcaster ID input value only if the user is not currently focusing it
      const input = card.querySelector('.broadcaster-id-input');
      if (input && document.activeElement !== input) {
        input.value = bot.broadcasterId || '';
      }
      
      // Update action button (Manage Rooms / Launch) depending on status
      const primaryBtn = card.querySelector('.btn-primary');
      const successBtn = card.querySelector('.btn-success:not([onclick*="updateBroadcasterId"])');
      
      if (isOnline && successBtn) {
        successBtn.outerHTML = `
          <button class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 1rem;" onclick="selectBot('${escapeHtml(bot.botId)}')">
            Open Console &rarr;
          </button>
        `;
      } else if (!isOnline && primaryBtn) {
        primaryBtn.outerHTML = `
          <button class="btn btn-success" style="width: 100%; justify-content: center; margin-top: 1rem;" onclick="launchBot('${escapeHtml(bot.botId)}', this)">
            🚀 Launch
          </button>
        `;
      }
    } else {
      // Fallback: If a card is missing, rebuild the grid
      grid.innerHTML = state.bots.map(bot => renderBotCardHtml(bot)).join('');
    }
  });
}

function updateRoomsView() {
  const bot = state.bots.find(b => b.botId === state.currentBotId);
  const breadcrumb = document.getElementById('current-bot-breadcrumb');
  
  if (!bot) {
    breadcrumb.textContent = state.currentBotId;
    document.getElementById('rooms-list').innerHTML = `
      <div class="empty-state">
        <h3>Bot connection details not found</h3>
        <p>This bot might have disconnected.</p>
      </div>
    `;
    return;
  }

  breadcrumb.textContent = bot.displayName;

  const roomsList = document.getElementById('rooms-list');
  if (bot.rooms.length === 0) {
    roomsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📹</div>
        <h3>No active livestream rooms</h3>
        <p>This chatbot is online but not connected to any active LiveKit/Socket.IO room sessions.</p>
      </div>
    `;
    return;
  }

  roomsList.innerHTML = bot.rooms.map(room => `
    <div class="room-card">
      <div class="room-details">
        <div class="room-id-area">
          <span class="room-id">${escapeHtml(room.roomName || room.roomId)}</span>
          <span class="room-name">Room ID: ${escapeHtml(room.roomId)}</span>
        </div>
        <div class="room-meta-item">
          <span class="lbl">Broadcaster ID</span>
          <span class="val">${escapeHtml(String(room.broadcasterId))}</span>
        </div>
        <div class="room-meta-item">
          <span class="lbl">Joined At</span>
          <span class="val">${new Date(room.joinedAt).toLocaleTimeString()}</span>
        </div>
      </div>
      <button class="btn btn-secondary" onclick="selectRoom('${escapeHtml(bot.botId)}', '${escapeHtml(room.roomId)}')">
        Open Moderation Console &rarr;
      </button>
    </div>
  `).join('');
}

function getCurrentRoomData() {
  const bot = state.bots.find(b => b.botId === state.currentBotId);
  if (!bot || !Array.isArray(bot.rooms)) return null;
  return bot.rooms.find(room => room.roomId === state.currentRoomId) || null;
}

function extractBroadcasterProfile(room) {
  const owner = room?.owner;
  if (!owner || typeof owner !== 'object') {
    return { name: 'Unknown', gender: 'Unknown' };
  }

  const rawName = owner.username || owner.name || owner.displayName || owner.fullName || owner.nickName || owner.nick || owner.userName || '';
  const rawGender = owner.gender || owner.sex || owner.userGender || '';

  const name = String(rawName || '').trim() || 'Unknown';
  const gender = String(rawGender || '').trim() || 'Unknown';

  return { name, gender };
}

function updateBroadcasterMeta() {
  const nameEl = document.getElementById('broadcaster-name');
  const genderEl = document.getElementById('broadcaster-gender');
  if (!nameEl || !genderEl) return;

  const room = getCurrentRoomData();
  const profile = extractBroadcasterProfile(room);

  nameEl.textContent = profile.name;
  genderEl.textContent = profile.gender;

  const botId = state.currentBotId || '';
  const femaleBotNames = ['priya', 'simran', 'neha', 'ananya', 'divya'];
  const isFemaleBot = femaleBotNames.some(name => botId.toLowerCase().includes(name));
  state.qsetGender = isFemaleBot ? 'Female' : 'Male';

  updateQSetFilterButtons();
  renderQuestionSet();
  startBotUptimeTimer(room?.joinedAt);
}

function startBotUptimeTimer(joinedAt) {
  // Clear any existing timer
  if (state.botTimerInterval) {
    clearInterval(state.botTimerInterval);
    state.botTimerInterval = null;
  }

  const timerPill = document.getElementById('timer-pill');
  const timerVal = document.getElementById('bot-timer');
  if (!timerPill || !timerVal) return;

  if (!joinedAt) {
    timerPill.style.display = 'none';
    return;
  }

  timerPill.style.display = 'inline-flex';

  const startTime = new Date(joinedAt).getTime();

  function updateTimer() {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs < 0) {
      timerVal.textContent = '00:00';
      return;
    }

    const totalSecs = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    let displayStr = '';
    if (hours > 0) {
      displayStr += String(hours).padStart(2, '0') + ':';
    }
    displayStr += String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    timerVal.textContent = displayStr;
  }

  updateTimer(); // run once immediately
  state.botTimerInterval = setInterval(updateTimer, 1000);
}

function syncCustomReplyHeight() {
  const customReplyCard = document.querySelector('.custom-reply-card');
  const leftPanel = document.querySelector('.console-left-panel');
  if (!customReplyCard) return;

  if (!leftPanel || window.innerWidth <= 1024) {
    customReplyCard.style.height = 'auto';
    customReplyCard.style.marginTop = '0';
    return;
  }

  const activeContent = document.querySelector('.tab-content.active');
  const alignTarget = activeContent?.querySelector('.queue-card, .empty-state, .blacklist-manager, .audit-log-container');

  if (!alignTarget) {
    customReplyCard.style.height = 'auto';
    customReplyCard.style.marginTop = '0';
    return;
  }

  const leftPanelRect = leftPanel.getBoundingClientRect();
  const targetRect = alignTarget.getBoundingClientRect();
  const offsetTop = Math.max(0, targetRect.top - leftPanelRect.top);

  customReplyCard.style.marginTop = `${offsetTop}px`;
  customReplyCard.style.height = `${alignTarget.offsetHeight}px`;
}

function scheduleCustomReplyHeightSync() {
  requestAnimationFrame(syncCustomReplyHeight);
}

function updateModerationView() {
  const bot = state.bots.find(b => b.botId === state.currentBotId);
  const breadcrumbBot = document.getElementById('bot-breadcrumb-link');
  const breadcrumbRoom = document.getElementById('room-breadcrumb');
  
  breadcrumbBot.textContent = bot ? bot.displayName : state.currentBotId;
  breadcrumbBot.onclick = () => selectBot(state.currentBotId);
  breadcrumbRoom.textContent = state.currentRoomId;
  updateBroadcasterMeta();
  updateAutoApproveBtn();

  // Render console content

  renderQueues();
  renderAuditLogs();
  scheduleCustomReplyHeightSync();
}

function updateBadges() {
  const filtered = state.queue.filter(q => q.botId === state.currentBotId && state.currentRoomIds.includes(q.roomId));
  const pendingCount = filtered.filter(q => q.status === 'pending').length;
  const heldCount = filtered.filter(q => q.status === 'held').length;

  document.getElementById('badge-pending').textContent = pendingCount;
  document.getElementById('badge-held').textContent = heldCount;
}

function switchTab(tab) {
  state.currentTab = tab;
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`tab-${tab}`).classList.add('active');

  // Update tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`content-${tab}`).classList.add('active');

  scheduleCustomReplyHeightSync();
}

function renderQueues() {
  const filtered = state.queue.filter(q => q.botId === state.currentBotId && state.currentRoomIds.includes(q.roomId));
  
  // Render Pending
  const pendingList = document.getElementById('pending-queue-list');
  const pendingItems = filtered.filter(q => q.status === 'pending');
  
  if (pendingItems.length === 0) {
    pendingList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☕</div>
        <h3>Queue is empty</h3>
        <p>Awaiting new messages. Responses generated by the AI bot will appear here in real-time.</p>
      </div>
    `;
  } else {
    pendingList.innerHTML = pendingItems.map(item => renderQueueCard(item)).join('');
  }

  // Render Held
  const heldList = document.getElementById('held-queue-list');
  const heldItems = filtered.filter(q => q.status === 'held');

  if (heldItems.length === 0) {
    heldList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>No held messages</h3>
        <p>Items placed on HOLD will stay here for later review.</p>
      </div>
    `;
  } else {
    heldList.innerHTML = heldItems.map(item => renderQueueCard(item)).join('');
  }

  updateBadges();
  scheduleCustomReplyHeightSync();
}

function renderQueueCard(item) {
  const isHeld = item.status === 'held';
  const answerHtml = `<div class="qa-bubble answer editable" onclick="startEditingAnswer(this, '${item._id}')" data-item-id="${item._id}">${escapeHtml(item.answer)}</div>`;
  
  return `
    <div class="queue-card" id="card-${item._id}">
      <div class="queue-card-header">
        <div class="queue-card-meta">
          <span class="path-badge">${escapeHtml(item.botId)}</span>
          <span class="path-arrow">&rarr;</span>
          <span class="path-badge">${escapeHtml(item.roomId)}</span>
          ${isHeld ? '<span class="held-indicator">HOLD</span>' : ''}
        </div>
        <span class="time-stamp">${new Date(item.timestamp).toLocaleTimeString()}</span>
      </div>

      <div class="qa-layout">
        ${item.question ? `
        <div class="qa-row">
          <span class="qa-label">Question:</span>
          <div class="qa-bubble question">"${escapeHtml(item.question)}"</div>
        </div>
        ` : ''}
        <div class="qa-row">
          <span class="qa-label">Answer:</span>
          ${answerHtml}
        </div>
      </div>

      <div class="queue-card-actions">
        <button class="btn btn-secondary btn-icon" onclick="moderationAction('${item._id}', 'hold')" ${isHeld ? 'disabled' : ''}>
          ⏳ Hold
        </button>
        <button class="btn btn-dark btn-icon" onclick="moderationAction('${item._id}', 'blacklist')">
          🚫 Blacklist Reply
        </button>
        <button class="btn btn-danger btn-icon" onclick="moderationAction('${item._id}', 'reject')">
          ❌ Reject
        </button>
        <button class="btn btn-success btn-icon" onclick="moderationAction('${item._id}', 'approve')">
          ✅ Approve & Send
        </button>
      </div>
    </div>
  `;
}

function renderBlacklist() {
  const container = document.getElementById('blacklist-items');
  if (state.blacklist.length === 0) {
    container.innerHTML = `<p style="color: var(--text-dark); text-align: center; padding: 2rem 0;">No phrases blacklisted yet.</p>`;
    return;
  }

  container.innerHTML = state.blacklist.map(item => `
    <div class="blacklist-item">
      <span class="blacklist-phrase">"${escapeHtml(item.phrase)}"</span>
      <button class="btn-trash" onclick="removeBlacklist('${item._id}')" title="Remove phrase">
        🗑️
      </button>
    </div>
  `).join('');

  scheduleCustomReplyHeightSync();
}

function renderAuditLogs() {
  const container = document.getElementById('audit-log-items');
  
  // Filter logs related to current bot/room or global manual blacklists
  const filteredLogs = state.logs.filter(log => {
    if (!state.currentBotId) return true;
    return (!log.botId || log.botId === state.currentBotId) && (!log.roomId || state.currentRoomIds.includes(log.roomId));
  });

  if (filteredLogs.length === 0) {
    container.innerHTML = `<p style="color: var(--text-dark); text-align: center; padding: 2rem 0;">No logs recorded yet.</p>`;
    return;
  }

  container.innerHTML = filteredLogs.map(log => `
    <div class="audit-item ${log.action}">
      <span class="audit-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
      <span class="audit-desc">${escapeHtml(log.details)}</span>
    </div>
  `).join('');

  scheduleCustomReplyHeightSync();
}

// Socket Emit Handlers
function moderationAction(queueId, action) {
  const item = state.queue.find(q => q._id === queueId);
  const botId = item ? item.botId : null;

  const card = document.getElementById(`card-${queueId}`);
  let newAnswer = undefined;
  if (card) {
    const textarea = card.querySelector('.edit-answer-input');
    if (textarea) {
      newAnswer = textarea.value.trim();
    }
  }

  let blacklistPhrase = undefined;
  if (action === 'blacklist') {
    const defaultPhrase = newAnswer || (item ? item.answer : '');
    const phrase = prompt("Enter word or phrase to blacklist (any generated response containing this will be blocked):", defaultPhrase);
    if (phrase === null) {
      return; // cancelled
    }
    blacklistPhrase = phrase.trim() || defaultPhrase;
  }

  if (card) card.style.opacity = '0.5';

  socket.emit('action:moderation', { queueId, botId, action, newAnswer, blacklistPhrase }, (res) => {
    if (!res.success) {
      alert('Failed to execute action: ' + res.error);
      if (card) card.style.opacity = '1';
    }
  });
}

function removeBlacklist(phraseId) {
  if (confirm('Are you sure you want to remove this phrase from the blacklist?')) {
    socket.emit('blacklist:remove', phraseId, (res) => {
      if (!res.success) {
        alert('Failed to remove from blacklist: ' + res.error);
      }
    });
  }
}

// Edit Modal Functions
let currentEditingItemId = null;

function startEditingAnswer(answerElement, queueId) {
  // Prevent if already editing
  if (answerElement.classList.contains('editing')) {
    return;
  }

  const item = state.queue.find(q => q._id === queueId);
  if (!item) return;

  currentEditingItemId = queueId;
  const currentAnswer = item.answer;

  // Create edit container
  const editContainer = document.createElement('div');
  editContainer.className = 'edit-textarea-container';
  editContainer.innerHTML = `
    <textarea class="edit-answer-input">${escapeHtml(currentAnswer)}</textarea>
    <div class="edit-action-buttons">
      <button class="btn btn-success btn-sm" onclick="performActionWithEdit('${queueId}', 'approve')">✈️ Send</button>
      <button class="btn btn-danger btn-sm" onclick="performActionWithEdit('${queueId}', 'reject')">❌ Reject</button>
      <button class="btn btn-secondary btn-sm" onclick="performActionWithEdit('${queueId}', 'hold')">⏳ Hold</button>
      <button class="btn btn-dark btn-sm" onclick="cancelEditingAnswer('${queueId}')">Cancel</button>
    </div>
  `;

  // Replace answer content with edit container
  answerElement.classList.add('editing');
  answerElement.innerHTML = '';
  answerElement.appendChild(editContainer);
  
  // Focus textarea
  const textarea = editContainer.querySelector('.edit-answer-input');
  textarea.focus();
  textarea.select();
}

function cancelEditingAnswer(queueId) {
  const item = state.queue.find(q => q._id === queueId);
  if (!item) return;

  const card = document.getElementById(`card-${queueId}`);
  if (card) {
    renderQueues();
  }
  currentEditingItemId = null;
}

function performActionWithEdit(queueId, action) {
  const item = state.queue.find(q => q._id === queueId);
  if (!item) return;

  const card = document.getElementById(`card-${queueId}`);
  const textarea = card.querySelector('.edit-answer-input');
  const newAnswer = textarea.value.trim();

  if (!newAnswer) {
    alert('Answer cannot be empty');
    return;
  }

  // Send single request to edit and perform action immediately
  socket.emit('action:moderation', { queueId, botId: item.botId, action, newAnswer }, (res) => {
    if (!res.success) {
      alert('Failed to perform action: ' + res.error);
      renderQueues();
    }
  });
}

// Add Blacklist Manually
document.getElementById('add-blacklist-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('blacklist-input');
  const phrase = input.value;
  
  socket.emit('blacklist:add', phrase, (res) => {
    if (res.success) {
      input.value = '';
    } else {
      alert('Failed to add phrase: ' + res.error);
    }
  });
});

// Send Custom Reply
const customReplyForm = document.getElementById('custom-reply-form');
const customReplyInput = document.getElementById('custom-reply-input');

customReplyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = customReplyInput.value;
  
  if (!state.currentBotId || !state.currentRoomId) {
    alert('Please select an active bot and room first.');
    return;
  }

  socket.emit('action:custom_reply', {
    botId: state.currentBotId,
    roomId: state.currentRoomId,
    text: text
  }, (res) => {
    if (res.success) {
      customReplyInput.value = '';
    } else {
      alert('Failed to send custom reply: ' + res.error);
    }
  });
});

customReplyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    customReplyForm.requestSubmit();
  }
});

window.addEventListener('resize', scheduleCustomReplyHeightSync);

// HTML escaping helper
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Question Set Interactive Actions
function setQSetGender(gender) {
  state.qsetGender = gender;
  updateQSetFilterButtons();
  renderQuestionSet();
}

function setQSetCategory(category) {
  state.qsetCategory = category;
  updateQSetFilterButtons();
  renderQuestionSet();
}

function updateQSetFilterButtons() {
  ['Female', 'Male', 'All'].forEach(g => {
    const btn = document.getElementById(`qbtn-gender-${g.toLowerCase()}`);
    if (btn) {
      if (state.qsetGender === g) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  ['General', 'Conversational', 'Singing Off'].forEach(c => {
    const btnId = `qbtn-cat-${c.toLowerCase().replace(' ', '')}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      if (state.qsetCategory === c) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
}

function renderQuestionSet() {
  const container = document.getElementById('qset-list');
  if (!container) return;

  if (!state.questionSet) {
    container.innerHTML = `<div class="empty-state-mini">Loading questions...</div>`;
    return;
  }

  let questions = [];
  const genders = state.qsetGender === 'All' ? ['Female', 'Male'] : [state.qsetGender];
  const category = state.qsetCategory;

  genders.forEach(g => {
    if (state.questionSet[g] && state.questionSet[g][category]) {
      questions.push(...state.questionSet[g][category]);
    }
  });

  questions = [...new Set(questions)];

  if (questions.length === 0) {
    container.innerHTML = `<div class="empty-state-mini">No questions found in this category.</div>`;
    return;
  }

  container.innerHTML = questions.map(q => {
    const escapedText = escapeHtml(q);
    return `
      <div class="qset-question-item">
        <span class="qset-question-text" onclick="insertQuestionText('${escapedText.replace(/'/g, "\\'")}')" title="Insert into custom reply text area">${escapedText}</span>
        <div class="qset-question-actions">
          <button class="btn-qsend" onclick="directSendQuestion('${escapedText.replace(/'/g, "\\'")}', this)" title="Direct Send to Chat">✈️ Send</button>
        </div>
      </div>
    `;
  }).join('');
}

function insertQuestionText(text) {
  const input = document.getElementById('custom-reply-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}

function directSendQuestion(text, btnElement) {
  if (!state.currentBotId || !state.currentRoomId) {
    alert('Please select an active bot and room first.');
    return;
  }

  const originalText = btnElement.textContent;
  btnElement.disabled = true;
  btnElement.textContent = 'Sending...';

  socket.emit('action:custom_reply', {
    botId: state.currentBotId,
    roomId: state.currentRoomId,
    text: text
  }, (res) => {
    btnElement.disabled = false;
    if (res.success) {
      btnElement.textContent = 'Sent!';
      btnElement.style.backgroundColor = 'var(--success)';
      btnElement.style.color = '#fff';
      setTimeout(() => {
        btnElement.textContent = originalText;
        btnElement.style.backgroundColor = '';
        btnElement.style.color = '';
      }, 1500);
    } else {
      btnElement.textContent = 'Error';
      alert('Failed to send question: ' + res.error);
      setTimeout(() => {
        btnElement.textContent = originalText;
      }, 1500);
    }
  });
}

// Web Terminal Integration
let term = null;
let fitAddon = null;

function initTerminal() {
  const container = document.getElementById('terminal-container');
  if (!container) return;

  // If already initialized, just fit and focus
  if (term) {
    setTimeout(() => {
      try {
        fitAddon.fit();
        term.focus();
      } catch (e) {}
    }, 100);
    return;
  }

  // Create terminal instance
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#000000',
      foreground: '#f3f4f6',
      cursor: '#6366f1',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
      black: '#000000',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#f3f4f6'
    },
    fontSize: 14,
    fontFamily: 'monospace'
  });

  fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  // Focus terminal
  setTimeout(() => {
    try {
      fitAddon.fit();
      term.focus();
    } catch (e) {}
  }, 100);

  // Send terminal data to server
  term.onData((data) => {
    socket.emit('terminal:input', data);
  });

  // Handle window resizing
  window.addEventListener('resize', () => {
    try {
      if (fitAddon && term) {
        fitAddon.fit();
        socket.emit('terminal:resize', {
          cols: term.cols,
          rows: term.rows
        });
      }
    } catch (e) {}
  });

  // Resize when terminal dimensions are determined
  setTimeout(() => {
    try {
      socket.emit('terminal:resize', {
        cols: term.cols,
        rows: term.rows
      });
    } catch (e) {}
  }, 200);
}

// Receive terminal data from server
socket.on('terminal:data', (data) => {
  if (term) {
    term.write(data);
  }
});

function clearTerminal() {
  if (term) {
    term.clear();
    term.focus();
  }
}

function reconnectTerminal() {
  if (term) {
    term.dispose();
    term = null;
  }
  const container = document.getElementById('terminal-container');
  if (container) container.innerHTML = '';
  
  // Reload terminal connection
  initTerminal();
}

// Trigger initial scan of active bots
setTimeout(refreshBotsData, 1000);
