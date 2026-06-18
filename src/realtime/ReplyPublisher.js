import { DataPacketKind } from '@livekit/rtc-node';
import bus, { Events }   from '../core/EventBus.js';
import logger             from '../utils/logger.js';

const log = logger.child({ module: 'ReplyPublisher' });

const SEND_MODES   = new Set(['chat', 'data_channel', 'socket_io']);
const textEncoder  = new TextEncoder();

export function createReplyPublisher(config) {
  const {
    roomRef,
    connectorRef,
    botIdentity,
    botDisplayName = botIdentity,
    sendMode       = 'chat',
    dataTopic      = 'chat',
  } = config;

  if (!botIdentity)  throw new Error('ReplyPublisher: botIdentity is required');
  if (sendMode !== 'socket_io' && !roomRef) {
    throw new Error('ReplyPublisher: roomRef is required');
  }

  if (!SEND_MODES.has(sendMode)) {
    throw new Error(`ReplyPublisher: sendMode must be one of ${[...SEND_MODES].join(', ')}`);
  }

  const stats = {
    sent:   0,
    failed: 0,
  };

  async function sendViaChatAPI(text) {
    const participant = roomRef.room?.localParticipant || roomRef.room;

    if (typeof participant.sendText === 'function') {
      await participant.sendText(text, { topic: 'lk.chat' });
    }

    if (typeof participant.sendChatMessage === 'function') {
      try {
        await participant.sendChatMessage(text);
      } catch (err) {
        log.debug({ err }, 'Legacy sendChatMessage failed (non-fatal)');
      }
    }
  }

  async function sendViaDataChannel(text) {
    const participant = roomRef.room?.localParticipant || roomRef.room;
    const payload = textEncoder.encode(
      JSON.stringify({
        text,
        userId:   botIdentity,
        username: botDisplayName,
        ts:       Date.now(),
      })
    );

    await participant.publishData(payload, {
      reliable: true,
      topic:    dataTopic,
      kind:     DataPacketKind.RELIABLE,
    });
  }

  async function sendViaSocketIO(text) {
    if (!connectorRef || !connectorRef.connector) {
      throw new Error('ReplyPublisher: connectorRef.connector is required for sendMode: socket_io');
    }
    await connectorRef.connector.publishReply(text);
  }

  async function onReplySend({ roomId, trigger, text, usage }) {
    if (sendMode === 'socket_io') {
      if (!connectorRef || !connectorRef.connector || !connectorRef.connector.isConnected()) {
        log.warn({ roomId }, 'Cannot send reply — Socket.io is not connected');
        stats.failed++;
        bus.emit(Events.REPLY_FAILED, {
          roomId,
          trigger,
          errName:    'SocketNotConnected',
          errMessage: 'ReplyPublisher: socket is not connected',
        });
        return;
      }
    } else if (!roomRef || !roomRef.room) {
      log.warn({ roomId }, 'Cannot send reply — no active room instance');
      stats.failed++;
      bus.emit(Events.REPLY_FAILED, {
        roomId,
        trigger,
        errName:    'NoRoomInstance',
        errMessage: 'ReplyPublisher: room is not connected',
      });
      return;
    }

    if (!text?.trim()) {
      log.warn({ roomId }, 'onReplySend called with empty text — skipping');
      return;
    }

    log.debug(
      { roomId, userId: trigger?.userId, replyLen: text.length, sendMode },
      'Publishing reply'
    );

    try {
      if (sendMode === 'chat') {
        await sendViaChatAPI(text.trim());
      } else if (sendMode === 'socket_io') {
        await sendViaSocketIO(text.trim());
      } else {
        await sendViaDataChannel(text.trim());
      }

      stats.sent++;

      log.info(
        {
          roomId,
          triggerUserId:   trigger?.userId,
          triggerUsername: trigger?.username,
          replyLen:        text.length,
          sendMode,
          promptTokens:    usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
        },
        'Reply sent'
      );

      bus.emit(Events.REPLY_SENT, {
        roomId,
        trigger,
        text:  text.trim(),
        usage,
        ts:    new Date().toISOString(),
      });

    } catch (err) {
      stats.failed++;
      log.error({ roomId, err }, 'Failed to publish reply');

      bus.emit(Events.REPLY_FAILED, {
        roomId,
        trigger,
        errName:    err.name,
        errMessage: err.message,
      });
    }
  }

  bus.on(Events.REPLY_SEND, onReplySend);
  log.debug({ sendMode }, 'ReplyPublisher registered');

  return {

    destroy() {
      bus.off(Events.REPLY_SEND, onReplySend);
      log.debug('ReplyPublisher destroyed');
    },

    getStats() {
      return { ...stats };
    },
  };
}
