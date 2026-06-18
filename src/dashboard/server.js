import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import pty from 'node-pty';

import config from '../../config/default.js';
import { getRejectQueueModel } from '../memory/models/ModerationQueue.js';
import { Blacklist } from '../memory/models/Blacklist.js';
import { AuditLog } from '../memory/models/AuditLog.js';
import { BotDefinition } from '../memory/models/BotDefinition.js';
import { Persona } from '../memory/models/Persona.js';
import { updateEnvValue } from '../utils/envHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(process.cwd(), 'images')));

// Map to track running child processes for bots
const runningBots = new Map();

// Connect to MongoDB
mongoose.connect(config.mongo.url)
  .then(() => console.log('✓ Dashboard MongoDB connected'))
  .catch((err) => console.error('✗ Dashboard MongoDB connection error:', err));

// Connect to Redis
const redisPub = new Redis(config.redis.url);
const redisSub = new Redis(config.redis.url);

redisPub.on('error', (err) => console.error('Redis Pub Client Error', err));
redisSub.on('error', (err) => console.error('Redis Sub Client Error', err));

// Subscribe to Redis moderation channel for new generated replies
redisSub.subscribe('moderation:channel', (err) => {
  if (err) {
    console.error('Failed to subscribe to Redis channel:', err);
  } else {
    console.log('✓ Subscribed to Redis moderation:channel');
  }
});

redisSub.on('message', (channel, message) => {
  if (channel === 'moderation:channel') {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'new_item') {
        console.log(`[Realtime] New queue item from bot: ${parsed.data.botId} in room: ${parsed.data.roomId}`);
        io.emit('moderation:new_item', parsed.data);
      }
    } catch (err) {
      console.error('Failed to process sub channel message:', err);
    }
  }
});

async function getActiveBots() {
  try {
    const keys = await redisPub.keys('bot:*:rooms');
    
    // Also get all persona display names from MongoDB to enrich details
    const personas = await Persona.find({}).lean();
    const personasMap = new Map(personas.map(p => [p.botId, p]));

    // Get all bot definitions (static + dynamic from DB)
    const STATIC_BOT_DEFS = [
      { key: 'aman', defaultName: 'Aman' },
      { key: 'shivam', defaultName: 'Shivam' },
      { key: 'abhishek', defaultName: 'Abhishek' },
      { key: 'rahul', defaultName: 'Rahul' },
      { key: 'priya', defaultName: 'Priya' },
      { key: 'simran', defaultName: 'Simran' },
      { key: 'neha', defaultName: 'Neha' },
      { key: 'ananya', defaultName: 'Ananya' },
      { key: 'divya', defaultName: 'Divya' }
    ];
    let dbDefs = [];
    try {
      dbDefs = await BotDefinition.find({}).lean();
    } catch (e) {
      console.error('Error fetching BotDefinitions:', e);
    }
    
    const botDefs = [...STATIC_BOT_DEFS];
    for (const dbDef of dbDefs) {
      if (!botDefs.some(def => def.key === dbDef.key)) {
        botDefs.push(dbDef);
      }
    }

    // Map all botDefs to their botId (e.g. key + '-bot')
    const allBotsMap = new Map();
    for (const def of botDefs) {
      const botId = def.defaultIdentity || `${def.key}-bot`;
      const displayName = def.defaultName || def.key.charAt(0).toUpperCase() + def.key.slice(1);
      const broadcasterEnvKey = `SOCKET_BROADCASTER_ID_${def.key.toUpperCase()}`;
      const broadcasterId = process.env[broadcasterEnvKey] || process.env.SOCKET_BROADCASTER_ID || '';
      
      let autoApprove = false;
      if (redisPub) {
        try {
          const val = await redisPub.get(`bot:${botId}:auto_approve`);
          autoApprove = (val === '1');
        } catch (e) {}
      }

      allBotsMap.set(botId, {
        botId,
        displayName,
        broadcasterId,
        broadcasterEnvKey,
        roomsCount: 0,
        rooms: [],
        status: 'offline',
        persona: personasMap.get(botId) || null,
        autoApprove
      });
    }

    // Enrich with Redis active data
    for (const key of keys) {
      const botId = key.split(':')[1];
      const roomsData = await redisPub.hgetall(key);
      const broadcasterGroups = {};

      for (const [roomId, val] of Object.entries(roomsData)) {
        try {
          const room = JSON.parse(val);
          // Check if heartbeat exists in Redis
          const isAlive = await redisPub.exists(`bot:${botId}:room:${roomId}:heartbeat`);
          if (isAlive === 1) {
            const bId = room.broadcasterId;
            if (!broadcasterGroups[bId]) {
              broadcasterGroups[bId] = {
                broadcasterId: bId,
                roomName: room.roomName || roomId,
                roomId: roomId,
                joinedAt: room.joinedAt,
                owner: room.owner,
                allRoomIds: [roomId]
              };
            } else {
              broadcasterGroups[bId].allRoomIds.push(roomId);
              if (roomId.startsWith('live_')) {
                broadcasterGroups[bId].roomName = room.roomName || roomId;
                broadcasterGroups[bId].roomId = roomId;
              }
            }
          } else {
            // Prune dead room from Redis hash
            await redisPub.hdel(key, roomId);
          }
        } catch (err) {
          // ignore parsing/redis error
        }
      }

      const activeRooms = Object.values(broadcasterGroups);
      
      if (allBotsMap.has(botId)) {
        const botData = allBotsMap.get(botId);
        botData.roomsCount = activeRooms.length;
        botData.rooms = activeRooms;
        botData.status = activeRooms.length > 0 ? 'online' : 'offline';
      } else {
        const personaInfo = personasMap.get(botId);
        const keyName = botId.endsWith('-bot') ? botId.substring(0, botId.length - 4) : botId;
        const broadcasterEnvKey = `SOCKET_BROADCASTER_ID_${keyName.toUpperCase()}`;
        const broadcasterId = process.env[broadcasterEnvKey] || process.env.SOCKET_BROADCASTER_ID || '';
        
        let autoApprove = false;
        if (redisPub) {
          try {
            const val = await redisPub.get(`bot:${botId}:auto_approve`);
            autoApprove = (val === '1');
          } catch (e) {}
        }

        allBotsMap.set(botId, {
          botId,
          displayName: personaInfo?.displayName || botId.replace('-bot', ''),
          broadcasterId,
          broadcasterEnvKey,
          roomsCount: activeRooms.length,
          rooms: activeRooms,
          status: activeRooms.length > 0 ? 'online' : 'offline',
          persona: personaInfo || null,
          autoApprove
        });
      }
    }

    return Array.from(allBotsMap.values());
  } catch (err) {
    console.error('Error fetching active bots:', err);
    return [];
  }
}

// Helper: Get pending and held items across all bot reject queues
async function getPendingQueues() {
  const pendingQueue = [];
  try {
    const db = mongoose.connection.db;
    if (db) {
      const dbCollections = await db.listCollections().toArray();
      const rejectQueueCols = dbCollections.filter(c => c.name.startsWith('reject_queue/'));

      for (const col of rejectQueueCols) {
        const botName = col.name.replace('reject_queue/', '');
        const RejectQueue = getRejectQueueModel(botName);
        const items = await RejectQueue.find({ status: { $in: ['pending', 'held'] } }).sort({ timestamp: 1 }).lean();
        pendingQueue.push(...items);
      }
    }
  } catch (err) {
    console.error('Error fetching pending queues:', err);
  }
  return pendingQueue;
}

async function parseQuestionSet() {
  try {
    const filePath = path.join(process.cwd(), 'roxstar-user-question-set.md');
    const content = await fs.promises.readFile(filePath, 'utf-8');
    
    const lines = content.split('\n');
    let currentGender = '';
    let currentCategory = '';
    const questionSet = {
      Female: {},
      Male: {}
    };

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('## ')) {
        const gender = line.substring(3).trim();
        if (gender === 'Female' || gender === 'Male') {
          currentGender = gender;
        }
      } else if (line.startsWith('### ')) {
        currentCategory = line.substring(4).trim();
        if (currentGender) {
          if (!questionSet[currentGender][currentCategory]) {
            questionSet[currentGender][currentCategory] = [];
          }
        }
      } else if (currentGender && currentCategory) {
        // e.g. "1. aap kis city se ho?"
        const match = line.match(/^\d+\.\s*(.*)$/);
        if (match) {
          questionSet[currentGender][currentCategory].push(match[1].trim());
        }
      }
    }
    return questionSet;
  } catch (error) {
    console.error('Error parsing roxstar-user-question-set.md:', error);
    return null;
  }
}

// Socket.IO Connection Handler
io.on('connection', async (socket) => {
  console.log('Admin client connected:', socket.id);

  // Spawn pseudo-terminal (PTY) for the socket connection
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env
  });

  ptyProcess.onData((data) => {
    socket.emit('terminal:data', data);
  });

  socket.on('terminal:input', (data) => {
    try {
      if (ptyProcess) ptyProcess.write(data);
    } catch (e) {
      console.error('Error writing to terminal:', e);
    }
  });

  socket.on('terminal:resize', ({ cols, rows }) => {
    try {
      if (ptyProcess) ptyProcess.resize(cols, rows);
    } catch (e) {
      console.error('Error resizing terminal:', e);
    }
  });

  // Send initial data
  try {
    const activeBots = await getActiveBots();
    socket.emit('init:bots', activeBots);

    const pendingQueue = await getPendingQueues();
    socket.emit('init:queue', pendingQueue);

    const blacklist = await Blacklist.find({}).sort({ addedAt: -1 }).lean();
    socket.emit('init:blacklist', blacklist);

    const logs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
    socket.emit('init:logs', logs);

    const questionSet = await parseQuestionSet();
    if (questionSet) {
      socket.emit('init:question_set', questionSet);
    }
  } catch (err) {
    console.error('Error sending initial data to client:', err);
  }

  // Handle Refresh Action
  socket.on('refresh:bots', async () => {
    const activeBots = await getActiveBots();
    socket.emit('update:bots', activeBots);
  });

  // Handle Moderation Action (Approve, Reject, Hold, Blacklist)
  socket.on('action:moderation', async (payload, callback) => {
    const { queueId, botId, action, newAnswer, blacklistPhrase } = payload;
    try {
      if (!botId) {
        return callback({ success: false, error: 'botId is required' });
      }
      const RejectQueue = getRejectQueueModel(botId);
      const item = await RejectQueue.findById(queueId);
      if (!item) {
        return callback({ success: false, error: 'Queue item not found' });
      }

      // If newAnswer is provided, update the item first (handles inline edit + action combined)
      if (newAnswer && newAnswer.trim() && action !== 'edit') {
        item.answer = newAnswer.trim();
        await item.save();

        // Save Audit Log for edit
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'edit',
          details: `Edited reply from: "${item.question}" to: "${item.answer}"`,
        });
      }

      if (action === 'edit') {
        if (!newAnswer || !newAnswer.trim()) {
          return callback({ success: false, error: 'Answer cannot be empty' });
        }
        item.answer = newAnswer.trim();
        await item.save();

        // Save Audit Log
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'edit',
          details: `Edited reply from: "${item.question}" to: "${item.answer}"`,
        });

      } else if (action === 'approve') {
        item.status = 'approved';
        item.actionedAt = new Date();
        await item.save();

        // Save Audit Log
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'approve',
          details: `Approved reply: "${item.answer}" for question: "${item.question}"`,
        });

        // Publish approval to Redis pub/sub
        await redisPub.publish('moderation:channel', JSON.stringify({
          type: 'approved',
          botId: item.botId,
          roomId: item.roomId,
          queueId: item._id,
          text: item.answer,
          trigger: item.trigger,
          usage: item.usage,
        }));

      } else if (action === 'reject') {
        item.status = 'rejected';
        item.actionedAt = new Date();
        await item.save();

        // Save Audit Log
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'reject',
          details: `Rejected reply: "${item.answer}"`,
        });

      } else if (action === 'hold') {
        item.status = 'held';
        item.actionedAt = new Date();
        await item.save();

        // Save Audit Log
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'hold',
          details: `Held reply: "${item.answer}"`,
        });

      } else if (action === 'blacklist') {
        item.status = 'blacklisted';
        item.actionedAt = new Date();
        await item.save();

        const phraseToBlacklist = (blacklistPhrase && blacklistPhrase.trim()) || item.answer;

        // Add to Blacklist DB
        await Blacklist.updateOne(
          { phrase: phraseToBlacklist },
          { $set: { phrase: phraseToBlacklist, addedAt: new Date() } },
          { upsert: true }
        );

        // Save Audit Log
        await AuditLog.create({
          botId: item.botId,
          roomId: item.roomId,
          action: 'blacklist',
          details: `Blacklisted sentence and blocked reply: "${phraseToBlacklist}"`,
        });

        // Notify client about blacklist update
        const updatedBlacklist = await Blacklist.find({}).sort({ addedAt: -1 }).lean();
        io.emit('update:blacklist', updatedBlacklist);
      }

      // Notify all clients about status update (except for edit action which doesn't change status)
      if (action !== 'edit') {
        io.emit('moderation:item_updated', { queueId: item._id, status: item.status, actionedAt: item.actionedAt });
      }

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      callback({ success: true });
    } catch (err) {
      console.error('Error handling moderation action:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Custom Reply from Admin
  socket.on('action:custom_reply', async (payload, callback) => {
    const { botId, roomId, text } = payload;
    try {
      if (!botId || !roomId || !text?.trim()) {
        return callback({ success: false, error: 'botId, roomId, and text are required' });
      }

      const RejectQueue = getRejectQueueModel(botId);
      const queueItem = await RejectQueue.create({
        botId,
        roomId,
        question: '', // Empty question for custom message
        answer: text.trim(),
        status: 'pending',
        trigger: { text: null, username: 'admin', userId: 'admin' },
        usage: { prompt_tokens: 0, completion_tokens: 0 }
      });

      // Save Audit Log
      await AuditLog.create({
        botId,
        roomId,
        action: 'edit',
        details: `Created custom reply in queue: "${text.trim()}"`,
      });

      // Notify all clients about the new queue item
      io.emit('moderation:new_item', {
        _id: queueItem._id,
        botId,
        roomId,
        question: queueItem.question,
        answer: queueItem.answer,
        status: queueItem.status,
        timestamp: queueItem.timestamp,
      });

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      callback({ success: true });
    } catch (err) {
      console.error('Error sending custom reply:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Toggle Auto-Approve
  socket.on('action:toggle_auto_approve', async (payload, callback) => {
    const { botId, autoApprove } = payload;
    try {
      if (!botId) {
        return callback({ success: false, error: 'botId is required' });
      }
      const key = `bot:${botId}:auto_approve`;
      if (autoApprove) {
        await redisPub.set(key, '1');
      } else {
        await redisPub.del(key);
      }

      // Save Audit Log
      await AuditLog.create({
        botId,
        action: autoApprove ? 'approve' : 'reject',
        details: `${autoApprove ? 'Enabled' : 'Disabled'} auto-approve for bot "${botId}"`,
      });

      // Broadcast update to all clients
      io.emit('auto_approve:status', { botId, autoApprove });

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      callback({ success: true });
    } catch (err) {
      console.error('Error toggling auto-approve:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Add Blacklist Phrase Manually
  socket.on('blacklist:add', async (phrase, callback) => {
    try {
      if (!phrase?.trim()) {
        return callback({ success: false, error: 'Phrase cannot be empty' });
      }

      await Blacklist.updateOne(
        { phrase: phrase.trim() },
        { $set: { phrase: phrase.trim(), addedAt: new Date() } },
        { upsert: true }
      );

      await AuditLog.create({
        action: 'blacklist',
        details: `Manually blacklisted phrase: "${phrase.trim()}"`,
      });

      const updatedBlacklist = await Blacklist.find({}).sort({ addedAt: -1 }).lean();
      io.emit('update:blacklist', updatedBlacklist);

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      callback({ success: true });
    } catch (err) {
      console.error('Error adding manual blacklist phrase:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Remove Blacklist Phrase Manually
  socket.on('blacklist:remove', async (phraseId, callback) => {
    try {
      const item = await Blacklist.findById(phraseId);
      if (!item) {
        return callback({ success: false, error: 'Phrase not found' });
      }

      await Blacklist.findByIdAndDelete(phraseId);

      await AuditLog.create({
        action: 'reject', // or general log
        details: `Removed phrase from blacklist: "${item.phrase}"`,
      });

      const updatedBlacklist = await Blacklist.find({}).sort({ addedAt: -1 }).lean();
      io.emit('update:blacklist', updatedBlacklist);

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      callback({ success: true });
    } catch (err) {
      console.error('Error removing blacklist phrase:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Update Broadcaster ID
  socket.on('action:update_broadcaster_id', async (payload, callback) => {
    const { botId, broadcasterId } = payload;
    try {
      if (!botId) {
        return callback({ success: false, error: 'botId is required' });
      }
      
      const keyName = botId.endsWith('-bot') ? botId.substring(0, botId.length - 4) : botId;
      const envKey = `SOCKET_BROADCASTER_ID_${keyName.toUpperCase()}`;
      const cleanVal = String(broadcasterId).trim();
      
      if (!cleanVal) {
        return callback({ success: false, error: 'Broadcaster ID cannot be empty' });
      }
      
      updateEnvValue(envKey, cleanVal);
      process.env[envKey] = cleanVal;
      
      await AuditLog.create({
        botId,
        action: 'edit',
        details: `Updated ${envKey} to "${cleanVal}"`,
      });
      
      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);
      
      const activeBots = await getActiveBots();
      io.emit('update:bots', activeBots);
      
      callback({ success: true });
    } catch (err) {
      console.error('Error updating broadcaster ID:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Launch Bot Process
  socket.on('action:launch_bot', async (payload, callback) => {
    const { botId } = payload;
    try {
      if (!botId) {
        return callback({ success: false, error: 'botId is required' });
      }
      
      const keyName = botId.endsWith('-bot') ? botId.substring(0, botId.length - 4) : botId;
      
      if (runningBots.has(botId)) {
        return callback({ success: false, error: 'Bot is already running or launching' });
      }
      
      let child;
      if (process.platform === 'darwin') {
        console.log(`[Launch] Starting bot: ${keyName} in new macOS Terminal window`);
        const commandToRun = `cd ${process.cwd()} && npm run dev ${keyName}`;
        const appleScript = `tell application "Terminal"
          do script "${commandToRun}"
          activate
        end tell`;
        child = spawn('osascript', ['-e', appleScript], {
          detached: true,
          stdio: 'ignore'
        });
      } else {
        console.log(`[Launch] Starting bot: ${keyName} as a background process`);
        child = spawn('node', [
          '--max-old-space-size=4096',
          '--expose-gc',
          'src/core/BotRunner.js',
          keyName
        ], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env }
        });
      }
      
      child.unref();
      runningBots.set(botId, child);
      
      child.on('close', () => {
        runningBots.delete(botId);
      });
      
      child.on('error', () => {
        runningBots.delete(botId);
      });
      
      // Save Audit Log
      await AuditLog.create({
        botId,
        action: 'edit',
        details: `Launched bot: "${botId}" via command "npm run dev ${keyName}"`,
      });
      
      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);
      
      callback({ success: true });
    } catch (err) {
      console.error('Error launching bot:', err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Stop Bot Process
  socket.on('action:stop_bot', async (payload, callback) => {
    const { botId } = payload;
    try {
      if (!botId) {
        return callback({ success: false, error: 'botId is required' });
      }

      console.log(`[Stop] Sending shutdown command to bot: ${botId}`);
      
      // Publish shutdown message to Redis moderation:channel
      await redisPub.publish('moderation:channel', JSON.stringify({
        type: 'shutdown',
        botId: botId
      }));

      // If there's an associated process in runningBots, kill it
      if (runningBots.has(botId)) {
        const proc = runningBots.get(botId);
        try {
          proc.kill('SIGINT');
        } catch (e) {}
        runningBots.delete(botId);
      }

      // Save Audit Log
      await AuditLog.create({
        botId,
        action: 'reject',
        details: `Stopped bot: "${botId}" via dashboard command`,
      });

      const updatedLogs = await AuditLog.find({}).sort({ timestamp: -1 }).limit(100).lean();
      io.emit('update:logs', updatedLogs);

      const activeBots = await getActiveBots();
      io.emit('update:bots', activeBots);

      callback({ success: true });
    } catch (err) {
      console.error('Error stopping bot:', err);
      callback({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Admin client disconnected:', socket.id);
    try {
      if (ptyProcess) ptyProcess.kill();
    } catch (e) {
      console.error('Error killing ptyProcess:', e);
    }
  });
});

// Periodically broadcast active bots state to all connected clients
setInterval(async () => {
  try {
    const activeBots = await getActiveBots();
    io.emit('update:bots', activeBots);
  } catch (err) {
    console.error('Error in active bots broadcast interval:', err);
  }
}, 5000);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  Dashboard server running on port ${PORT}`);
  console.log(`  Access dashboard at http://localhost:${PORT}`);
  console.log(`=========================================`);
});
