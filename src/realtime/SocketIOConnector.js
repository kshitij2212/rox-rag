import { io } from 'socket.io-client';
import defaultBus, { Events } from '../core/EventBus.js';
import logger from '../utils/logger.js';
import { resolveUser } from '../utils/database.js';

const log = logger.child({ module: 'SocketIOConnector' });

export function createSocketIOConnector(config) {
  const {
    url,
    path = '/v1/live/socket',
    reconnectionAttempts = 3,
    timeout = 2000,
    liveId,
    userId,
    broadcasterId,
    redis,
    eventBus = defaultBus,
  } = config;

  if (!url) {
    throw new Error('SocketIOConnector: url is required');
  }
  if (
    liveId === undefined || liveId === null || liveId === '' ||
    userId === undefined || userId === null || userId === '' ||
    broadcasterId === undefined || broadcasterId === null || broadcasterId === ''
  ) {
    throw new Error('SocketIOConnector: liveId, userId, and broadcasterId are required in auth parameters');
  }

  const ConnectorState = {
    DISCONNECTED:  'disconnected',
    CONNECTING:    'connecting',
    CONNECTED:     'connected',
    DISCONNECTING: 'disconnecting',
  };

  let state = ConnectorState.DISCONNECTED;
  let socket = null;
  let isConnected = false;
  let reconnectCount = 0;
  let reconnectInProgress = false;
  let connectPromise = null;

  const roomId = String(liveId);

  function transitionTo(newState) {
    log.debug({ roomId, from: state, to: newState }, 'Connector state transition');
    state = newState;
    isConnected = (state === ConnectorState.CONNECTED);
  }

  function connect() {
    if (state === ConnectorState.CONNECTED) {
      log.warn({ roomId }, 'connect() called but already connected — ignoring');
      return Promise.resolve();
    }

    if (state === ConnectorState.CONNECTING || connectPromise) {
      log.debug({ roomId }, 'connect() called while connection in progress — reusing promise');
      return connectPromise;
    }

    transitionTo(ConnectorState.CONNECTING);

    connectPromise = new Promise((resolve, reject) => {
      log.info({ url, path, liveId, userId }, 'Connecting to Socket.io server');

      socket = io(url, {
        path,
        forceNew: true,
        reconnectionAttempts,
        timeout,
        auth: {
          liveId,
          userId,
          broadcasterId,
        },
        transports: ['websocket'],
      });

      const onConnect = () => {
        const isReconnect = reconnectInProgress;
        transitionTo(ConnectorState.CONNECTED);
        reconnectCount = 0;
        reconnectInProgress = false;

        log.info({ roomId, isReconnect }, 'Socket.io connected successfully');

        // Register the bot as a regular user in the live room on connection
        socket.emit('message', JSON.stringify({
          module: 'LIVE',
          action: 'JOIN_LIVE',
          user_id: userId,
          live_id: liveId,
          broadcaster_id: broadcasterId,
        }));

        if (isReconnect) {
          eventBus.emit(Events.CONNECTOR_RECONNECTED, { roomId, attempt: reconnectCount });
        } else {
          eventBus.emit(Events.ROOM_CONNECTED, { roomId, roomName: roomId });
        }

        cleanupStartupListeners();
        resolve();
      };

      const onConnectError = (err) => {
        log.error({ roomId, err: err?.message || err }, 'Socket.io connection error');
        if (state === ConnectorState.CONNECTING) {
          transitionTo(ConnectorState.DISCONNECTED);
          cleanupStartupListeners();
          reject(err);
        }
      };

      const cleanupStartupListeners = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
      };

      socket.on('connect', onConnect);
      socket.on('connect_error', onConnectError);

      // Register general event listeners
      socket.on('disconnect', (reason) => {
        log.warn({ roomId, reason }, 'Socket.io disconnected');
        isConnected = false;

        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          transitionTo(ConnectorState.DISCONNECTED);
          eventBus.emit(Events.ROOM_DISCONNECTED, { roomId, reason });
        } else {
          reconnectInProgress = true;
          transitionTo(ConnectorState.DISCONNECTED);
          eventBus.emit(Events.ROOM_DISCONNECTED, { roomId, reason });
        }
      });

      socket.on('reconnect_attempt', (attempt) => {
        reconnectCount = attempt;
        log.warn({ roomId, attempt }, 'Socket.io reconnecting...');
        eventBus.emit(Events.CONNECTOR_RECONNECTING, {
          roomId,
          attempt,
          maxAttempts: reconnectionAttempts,
          delayMs: timeout,
        });
      });

      socket.on('reconnect_failed', () => {
        log.error({ roomId }, 'Socket.io reconnection failed');
        eventBus.emit(Events.CONNECTOR_FAILED, { roomId, attempts: reconnectCount });
      });

      socket.on('message', (messageData) => {
        let payload;
        try {
          payload = typeof messageData === 'string' ? JSON.parse(messageData) : messageData;
        } catch (err) {
          log.warn({ err, messageData }, 'Failed to parse incoming message JSON');
          return;
        }

        if (!payload) return;

        if (payload.type === 'BROADCASTER_DETAILS') {
          const details = payload.broadcaster_details;
          if (details && details.userId && details.username && redis) {
            resolveUser(details.userId, details.username)
              .then(resolved => {
                log.info({ broadcasterId: details.userId, username: resolved.username, gender: resolved.gender }, 'Caching broadcaster details in Redis');
                redis.set(`user:${details.userId}`, JSON.stringify(resolved), 'EX', 3600)
                  .catch(err => log.warn({ err }, 'Failed to cache broadcaster details in Redis'));
              });
          }
          return;
        }

        if (payload.type !== 'CHAT_MESSAGE') {
          return;
        }

        // Avoid self-replies / infinite loops
        const senderId = payload.user_details?.user_id;
        if (String(senderId) === String(userId)) {
          log.debug('Skipping comment sent by bot itself');
          return;
        }

        if (senderId && redis) {
          const senderName = payload.user_details?.username || payload.user_details?.name;
          if (senderName) {
            resolveUser(senderId, senderName)
              .then(resolved => {
                redis.set(`user:${senderId}`, JSON.stringify(resolved), 'EX', 3600)
                  .catch(err => log.warn({ err }, 'Failed to cache sender details in Redis'));
              });
          }
        }

        log.info(
          { roomId, senderId, text: payload.message },
          'Received chat message from Socket.io'
        );

        eventBus.emit(Events.COMMENT_RECEIVED, {
          roomId,
          userId: String(senderId),
          username: payload.user_details?.username || payload.user_details?.name || 'unknown',
          text: (payload.message || '').trim(),
          ts: new Date().toISOString(),
          source: 'socket_io',
        });
      });
    }).finally(() => {
      connectPromise = null;
    });

    return connectPromise;
  }

  async function disconnect() {
    if (!socket) {
      log.warn({ roomId }, 'disconnect() called but no socket instance exists');
      return;
    }

    log.info({ roomId }, 'Disconnecting from Socket.io server');
    transitionTo(ConnectorState.DISCONNECTING);

    socket.disconnect();
    socket = null;
    transitionTo(ConnectorState.DISCONNECTED);
    eventBus.emit(Events.ROOM_DISCONNECTED, { roomId, reason: 'intentional' });
  }

  async function publishReply(text) {
    if (!socket || !socket.connected) {
      throw new Error('SocketIOConnector: cannot publishReply — socket is not connected');
    }

    log.info({ roomId, textLen: text?.length }, 'Sending reply via Socket.io');

    socket.emit('message', JSON.stringify({
      action: 'SEND_LIVE_CHAT_MESSAGE',
      user_id: userId,
      live_id: liveId,
      message: text,
      mention_id: 0,
      isFlyingMessage: 0,
      isVip: 0,
      module: 'LIVE',
    }));
  }

  return {
    connect,
    disconnect,
    destroy: async () => {
      await disconnect();
    },
    isConnected: () => isConnected,
    getSocket: () => socket,
    publishReply,
  };
}
