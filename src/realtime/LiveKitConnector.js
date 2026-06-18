import {
  Room,
  DisconnectReason,
  ConnectionState,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

import { createRoomEventEmitter } from './RoomEventEmitter.js';
import defaultBus, { Events }     from '../core/EventBus.js';
import logger                     from '../utils/logger.js';
import { sleep }                  from '../utils/sleep.js';

const log = logger.child({ module: 'LiveKitConnector' });

const TERMINAL_REASONS = new Set([
  String(DisconnectReason.CLIENT_INITIATED),
  'CLIENT_INITIATED',
  'intentional',
]);

export function createLiveKitConnector(config) {
  const {
    url,
    apiKey,
    apiSecret,
    tokenApiUrl,
    roomName,
    botIdentity,
    botDisplayName      = botIdentity,
    ownerIdentity       = null,
    eventBus            = defaultBus,
    reconnectAttempts   = 5,
    reconnectBaseMs     = 1500,
    reconnectMaxMs      = 30000,
    connectTimeoutMs    = 10000,
    disconnectTimeoutMs = 5000,
  } = config;

  for (const [key, val] of Object.entries({ url, roomName, botIdentity })) {
    if (!val || typeof val !== 'string' || !val.trim()) {
      throw new Error(`LiveKitConnector: missing required config field "${key}"`);
    }
  }

  if (!tokenApiUrl && (!apiKey || !apiSecret)) {
    throw new Error('LiveKitConnector: must provide either tokenApiUrl or both apiKey and apiSecret');
  }

  const ConnectorState = {
    DISCONNECTED:  'disconnected',
    CONNECTING:    'connecting',
    CONNECTED:     'connected',
    DISCONNECTING: 'disconnecting',
  };

  let state               = ConnectorState.DISCONNECTED;
  let room                = null;
  let emitter             = null;
  let isConnected         = false;
  let isShuttingDown      = false;
  let reconnectCount      = 0;
  let reconnectInProgress = false;
  let connectPromise      = null;

  const roomId = roomName;

  function transitionTo(newState) {
    log.debug({ roomId, from: state, to: newState }, 'Connector state transition');
    state = newState;
    isConnected = (state === ConnectorState.CONNECTED);
  }

  async function generateToken() {
    if (tokenApiUrl) {
      log.debug({ roomName, botIdentity }, 'Fetching token from API');

      const res = await fetch(tokenApiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          'room-name': roomName,
          identity:    botIdentity,
          metadata:    { name: botDisplayName, role: 'bot' },
        }),
      });

      if (!res.ok) {
        throw new Error(`LiveKitConnector: token API error ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      if (!data.token) {
        throw new Error('LiveKitConnector: token API returned no token');
      }

      log.debug({ roomName, botIdentity }, 'Token fetched successfully');
      return data.token;
    } else {
      log.debug({ roomName, botIdentity }, 'Generating token locally');
      const at = new AccessToken(apiKey, apiSecret, {
        identity: botIdentity,
        name: botDisplayName,
        metadata: JSON.stringify({ name: botDisplayName, role: 'bot' }),
      });
      at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
      return await at.toJwt();
    }
  }

  function buildRoomOptions() {
    return {
      autoSubscribe:  true,
      dynacast:       false,
      adaptiveStream: false,
    };
  }

  async function _doConnect() {
    log.info({ roomId, botIdentity, url }, 'Connecting to LiveKit room');

    room    = new Room(buildRoomOptions());
    emitter = createRoomEventEmitter(room, {
      roomId,
      botUserId:     botIdentity,
      ownerIdentity,
    });

    const token = await generateToken();

    const connectResult = await Promise.race([
      room.connect(url, token, { publishVideo: false }).then(() => 'connected'),
      sleep(connectTimeoutMs).then(() => 'timeout'),
    ]);

    if (connectResult === 'timeout') {
      const timedOutRoom = room;
      _resetRoomState();
      transitionTo(ConnectorState.DISCONNECTED);
      _safeDisconnectRoom(timedOutRoom);
      throw new Error(`LiveKitConnector: connect timed out after ${connectTimeoutMs}ms`);
    }

    transitionTo(ConnectorState.CONNECTED);
    reconnectCount = 0;

    log.info({ roomId, botIdentity }, 'Successfully connected to LiveKit room');
    eventBus.emit(Events.ROOM_CONNECTED, { roomId, roomName, room });
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

    if (state === ConnectorState.DISCONNECTING) {
      return Promise.reject(new Error('LiveKitConnector: cannot connect while disconnecting'));
    }

    isShuttingDown = false;
    transitionTo(ConnectorState.CONNECTING);

    connectPromise = _doConnect()
      .catch(async (err) => {
        log.error({ roomId, err }, 'Failed to connect to LiveKit room');
        const oldRoom = room;
        _resetRoomState();
        transitionTo(ConnectorState.DISCONNECTED);
        _safeDisconnectRoom(oldRoom);
        throw err;
      })
      .finally(() => {
        connectPromise = null;
      });

    return connectPromise;
  }

  async function disconnect() {
    if (!room) {
      log.warn({ roomId }, 'disconnect() called but no room instance exists');
      return;
    }

    log.info({ roomId }, 'Disconnecting from LiveKit room');
    isShuttingDown = true;
    transitionTo(ConnectorState.DISCONNECTING);

    const roomRef = room;
    _resetRoomState();

    try {
      const result = await Promise.race([
        roomRef.disconnect().then(() => 'clean'),
        sleep(disconnectTimeoutMs).then(() => 'timeout'),
      ]);

      if (result === 'timeout') {
        log.warn(
          { roomId, timeoutMs: disconnectTimeoutMs },
          'room.disconnect() timed out — forcing cleanup.'
        );
      } else {
        log.info({ roomId }, 'Disconnected from LiveKit room cleanly');
      }
    } catch (err) {
      log.warn({ roomId, err }, 'Error during room disconnect — forcing cleanup anyway');
    } finally {
      transitionTo(ConnectorState.DISCONNECTED);
      eventBus.emit(Events.ROOM_DISCONNECTED, { roomId, reason: 'intentional' });
    }
  }

  async function _handleUnexpectedDisconnect(reason) {
    if (reconnectInProgress) {
      log.debug({ roomId }, 'Reconnect already in progress — ignoring duplicate trigger');
      return;
    }

    reconnectInProgress = true;
    transitionTo(ConnectorState.DISCONNECTED);

    const oldRoom = room;
    _resetRoomState();

    log.warn({ roomId, reason }, 'Unexpected disconnect — starting reconnect loop');

    _safeDisconnectRoom(oldRoom);

    try {
      while (reconnectCount < reconnectAttempts) {
        if (isShuttingDown) {
          log.info({ roomId }, 'Shutdown requested — aborting reconnect loop');
          return;
        }

        reconnectCount++;

        const baseDelay = Math.min(
          reconnectBaseMs * 2 ** (reconnectCount - 1),
          reconnectMaxMs
        );
        const jitter = Math.random() * baseDelay * 0.2;
        const delay  = Math.round(baseDelay + jitter);

        log.info(
          { roomId, attempt: reconnectCount, maxAttempts: reconnectAttempts, delayMs: delay },
          'Reconnect attempt scheduled'
        );

        eventBus.emit(Events.CONNECTOR_RECONNECTING, {
          roomId,
          attempt:     reconnectCount,
          maxAttempts: reconnectAttempts,
          delayMs:     delay,
        });

        await sleep(delay);

        if (isShuttingDown) {
          log.info({ roomId }, 'Shutdown requested during backoff — aborting reconnect loop');
          return;
        }

        try {
          await connect();
          log.info({ roomId, reconnectCount }, 'Reconnected successfully');
          eventBus.emit(Events.CONNECTOR_RECONNECTED, { roomId, attempt: reconnectCount });
          reconnectCount = 0;
          return;
        } catch (err) {
          log.warn({ roomId, attempt: reconnectCount, err }, 'Reconnect attempt failed');
        }
      }

      log.error({ roomId, reconnectAttempts }, 'All reconnect attempts failed — giving up');
      eventBus.emit(Events.CONNECTOR_FAILED, { roomId, attempts: reconnectAttempts });

    } finally {
      reconnectInProgress = false;
    }
  }

  function _resetRoomState() {
    if (emitter) {
      emitter.detach();
      emitter = null;
    }
    room = null;
  }

  function _safeDisconnectRoom(targetRoom) {
    if (!targetRoom) return;

    const handleStateChange = (newState) => {
      if (newState === ConnectionState.CONN_CONNECTED || newState === 1) {
        cleanupAndDisconnect();
      }
    };

    const cleanupAndDisconnect = () => {
      try {
        targetRoom.off('connectionStateChanged', handleStateChange);
        targetRoom.off('disconnected', cleanupAndDisconnect);
      } catch {}
      targetRoom.disconnect().catch((err) => {
        log.warn({ roomId, err }, 'Failed to disconnect room during safe disconnect cleanup');
      });
    };

    if (targetRoom.isConnected) {
      cleanupAndDisconnect();
    } else {
      targetRoom.on('connectionStateChanged', handleStateChange);
      targetRoom.on('disconnected', cleanupAndDisconnect);
      targetRoom.disconnect().catch((err) => {
        log.debug({ roomId, err }, 'Immediate disconnect call on connecting room');
      });
    }
  }

  function _onRoomDisconnected({ roomId: disconnectedRoomId, reason }) {
    if (disconnectedRoomId !== roomId) return;
    if (isShuttingDown) return;
    if (TERMINAL_REASONS.has(String(reason))) {
      log.info({ roomId, reason }, 'Terminal disconnect reason — not reconnecting');
      return;
    }
    _handleUnexpectedDisconnect(reason);
  }

  eventBus.on(Events.ROOM_DISCONNECTED, _onRoomDisconnected);

  return {
    connect,
    disconnect,

    async destroy() {
      await disconnect();
      eventBus.off(Events.ROOM_DISCONNECTED, _onRoomDisconnected);
      log.debug({ roomId }, 'LiveKitConnector destroyed — bus listener removed');
    },

    isConnected:      () => isConnected,
    getConnectionState: () => room?.connectionState ?? null,
    getRoomId:        () => roomId,
    getRoom:          () => room,

    async publishReply(text) {
      if (!room?.localParticipant) {
        throw new Error('LiveKitConnector: cannot publishReply — not connected to a room');
      }

      const lp = room.localParticipant;

      if (typeof lp.sendText === 'function') {
        await lp.sendText(text, { topic: 'lk.chat' });
        log.debug({ roomId, text }, 'Reply published via sendText(lk.chat)');
      }

      if (typeof lp.sendChatMessage === 'function') {
        try {
          await lp.sendChatMessage(text);
        } catch (err) {
          log.debug({ err }, 'Legacy sendChatMessage failed (non-fatal)');
        }
      }
    },
  };
}
