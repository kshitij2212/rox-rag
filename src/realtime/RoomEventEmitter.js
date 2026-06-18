import { RoomEvent, TrackKind, AudioStream } from '@livekit/rtc-node';
import bus, { Events } from '../core/EventBus.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'RoomEventEmitter' });
const textDecoder = new TextDecoder();

export function createRoomEventEmitter(room, config) {
  const { roomId, botUserId, ownerIdentity = null } = config;

  const audioStreams = new Map();

  async function runAudioFrameLoop(audioStream, trackSid, speakerId, abortSignal) {
    const reader = audioStream.getReader();

    const onAbort = () => {
      try { reader.cancel(); } catch {  }
    };
    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    let frameCount = 0;
    let lastHeapLogTs = Date.now();

    try {
      while (!abortSignal.aborted) {
        let result;
        try {
          result = await reader.read();
        } catch (err) {
          if (abortSignal.aborted) break;
          throw err;
        }

        const { value: frame, done } = result;
        if (done || abortSignal.aborted) break;

        frameCount++;

        const now = Date.now();
        if (now - lastHeapLogTs >= 1000) {
          const mu = process.memoryUsage();

          process.stderr.write(
            `[heap] frames=${frameCount} ` +
            `heap=${Math.round(mu.heapUsed / 1024 / 1024)}/${Math.round(mu.heapTotal / 1024 / 1024)}MB ` +
            `ext=${Math.round(mu.external / 1024 / 1024)}MB ` +
            `arrBuf=${Math.round(mu.arrayBuffers / 1024 / 1024)}MB ` +
            `rss=${Math.round(mu.rss / 1024 / 1024)}MB\n`,
          );
          lastHeapLogTs = now;
          frameCount = 0;
        }

        if (process.env.AUDIO_DROP_FRAMES === '1') {
          continue;
        }

        bus.emit(Events.AUDIO_FRAME, {
          roomId,
          speakerId,
          trackSid,
          data:              new Int16Array(frame.data),
          sampleRate:        frame.sampleRate,
          channels:          frame.channels,
          samplesPerChannel: frame.samplesPerChannel,
          ts:                now,
        });

        await new Promise(r => setTimeout(r, 0));

        if (frameCount % 100 === 0 && global.gc) {
          global.gc();
        }
      }
    } finally {
      abortSignal.removeEventListener?.('abort', onAbort);
      try { reader.releaseLock(); } catch {  }
    }
  }

  function startAudioFrameReader(track, trackSid, speakerId) {
    if (audioStreams.has(trackSid)) {
      log.warn({ trackSid }, 'Audio frame reader already exists for track SID — skipping creation');
      return;
    }

    const audioStream     = new AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 30 });
    const abortController = new AbortController();

    audioStreams.set(trackSid, { controller: abortController, speakerId });

    runAudioFrameLoop(audioStream, trackSid, speakerId, abortController.signal)
      .catch((err) => {
        if (err?.name === 'AbortError') {
          log.debug({ trackSid }, 'Audio frame reader aborted cleanly');
          return;
        }
        log.error({ trackSid, err }, 'Audio frame reader crashed');
        bus.emit(Events.AUDIO_TRACK_REMOVED, { roomId, participantId: speakerId, trackSid });
      });
  }

  function stopAudioFrameReader(trackSid) {
    const entry = audioStreams.get(trackSid);
    if (!entry) return;
    entry.controller.abort();
    audioStreams.delete(trackSid);
  }

  function stopAllAudioReaders() {
    for (const [trackSid, entry] of audioStreams) {
      log.debug({ trackSid }, 'Stopping audio reader');
      entry.controller.abort();
    }
    audioStreams.clear();
  }

  function onConnected() {
    log.info({ roomId }, 'Room connected');
    bus.emit(Events.ROOM_CONNECTED, { roomId, roomName: room.name, room });

    for (const [, participant] of room.remoteParticipants) {
      log.debug({ identity: participant.identity }, 'Wiring pre-existing participant');
      onParticipantConnected(participant);
      for (const [, publication] of participant.trackPublications) {
        if (publication.track) {
          onTrackSubscribed(publication.track, publication, participant);
        }
      }
    }
  }

  function onDisconnected(reason) {
    log.warn({ roomId, reason }, 'Room disconnected');
    stopAllAudioReaders();
    bus.emit(Events.ROOM_DISCONNECTED, { roomId, reason: String(reason ?? 'unknown') });
  }

  function onReconnecting() {
    log.warn({ roomId }, 'Room reconnecting');
    bus.emit(Events.ROOM_RECONNECTING, { roomId });
  }

  function onReconnected() {
    log.info({ roomId }, 'Room reconnected');
    bus.emit(Events.ROOM_RECONNECTED, { roomId });

    stopAllAudioReaders();

    for (const [, participant] of room.remoteParticipants) {
      log.debug({ identity: participant.identity }, 'Re-wiring participant after reconnect');
      onParticipantConnected(participant);
      for (const [, publication] of participant.trackPublications) {
        if (publication.track) {
          onTrackSubscribed(publication.track, publication, participant);
        }
      }
    }
  }

  function onParticipantConnected(participant) {
    log.info({ identity: participant.identity }, 'Participant joined');
    bus.emit(Events.PARTICIPANT_JOINED, {
      roomId,
      participantId: participant.identity,
      identity:      participant.identity,
    });
  }

  function onParticipantDisconnected(participant) {
    log.info({ identity: participant.identity }, 'Participant left');

    for (const [trackSid, entry] of audioStreams) {
      if (entry.speakerId === participant.identity) {
        log.debug({ trackSid, identity: participant.identity }, 'Stopping orphaned audio reader on participant disconnect');
        entry.controller.abort();
        audioStreams.delete(trackSid);
      }
    }

    bus.emit(Events.PARTICIPANT_LEFT, {
      roomId,
      participantId: participant.identity,
      identity:      participant.identity,
    });
  }

  function onTrackSubscribed(track, publication, participant) {
    if (track.kind !== TrackKind.KIND_AUDIO) return;

    log.info({ trackSid: publication.sid, identity: participant.identity }, 'Audio track subscribed');

    bus.emit(Events.AUDIO_TRACK_ADDED, {
      roomId,
      participantId: participant.identity,
      track,
      publication,
    });

    if (process.env.ENABLE_VOICE_STT === 'true') {
      startAudioFrameReader(track, publication.sid, participant.identity);
    } else {
      log.debug({ trackSid: publication.sid }, 'Voice STT disabled (ENABLE_VOICE_STT != true) — audio frames will not be processed');
    }
  }

  function onTrackUnsubscribed(track, publication, participant) {
    if (track.kind !== TrackKind.KIND_AUDIO) return;

    log.info({ trackSid: publication.sid, identity: participant.identity }, 'Audio track unsubscribed');
    stopAudioFrameReader(publication.sid);

    bus.emit(Events.AUDIO_TRACK_REMOVED, {
      roomId,
      participantId: participant.identity,
      trackSid:      publication.sid,
    });
  }

  function onDataReceived(payload, participant, _kind, topic) {
    if (!participant || participant.identity === botUserId) return;

    if (topic != null && topic !== 'chat' && topic !== 'lk.chat') return;

    if (!(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload)) {
      log.warn({ type: typeof payload }, 'Data channel payload is not a BufferSource — dropping');
      return;
    }

    let decoded;
    try {
      decoded = textDecoder.decode(payload);
    } catch (err) {
      log.warn({ err }, 'Failed to decode data channel payload — dropping');
      return;
    }

    if (!decoded.trim()) return;

    bus.emit(Events.COMMENT_RAW, {
      rawPayload:    decoded,
      participantId: participant?.identity ?? 'unknown',
      roomId,
      source:        'data_channel',
    });
  }

  function onChatMessage(message, participant) {
    if (participant?.identity === botUserId) return;
    if (!message?.message?.trim()) return;

    let ts;
    if (message.timestamp != null) {
      const d = new Date(message.timestamp);
      ts = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      ts = new Date().toISOString();
    }

    bus.emit(Events.COMMENT_RECEIVED, {
      roomId,
      userId:   participant?.identity ?? 'unknown',
      username: participant?.name ?? participant?.identity ?? 'unknown',
      text:     message.message.trim(),
      ts,
      source:   'chat_message',
    });
  }

  const CHAT_TOPICS = ['lk.chat', 'chat'];

  async function onChatTextStream(reader, participantInfo) {
    const identity = participantInfo?.identity ?? 'unknown';
    if (identity === botUserId) return;

    let text;
    try {
      text = await reader.readAll();
    } catch (err) {
      log.warn({ err, identity }, 'Failed to read chat text stream — dropping');
      return;
    }

    if (!text || !text.trim()) return;

    const participant = room.remoteParticipants?.get?.(identity);
    const ts = reader.info?.timestamp != null
      ? new Date(Number(reader.info.timestamp)).toISOString()
      : new Date().toISOString();

    log.info(
      { roomId, identity, topic: reader.info?.topic, textLen: text.length },
      'Chat text stream received'
    );

    bus.emit(Events.COMMENT_RECEIVED, {
      roomId,
      userId:   identity,
      username: participant?.name ?? identity,
      text:     text.trim(),
      ts:       Number.isNaN(Date.parse(ts)) ? new Date().toISOString() : ts,
      source:   'chat_message',
    });
  }

  function attach() {
    room.on(RoomEvent.Connected,               onConnected);
    room.on(RoomEvent.Disconnected,            onDisconnected);
    room.on(RoomEvent.Reconnecting,            onReconnecting);
    room.on(RoomEvent.Reconnected,             onReconnected);
    room.on(RoomEvent.ParticipantConnected,    onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed,         onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed,       onTrackUnsubscribed);
    room.on(RoomEvent.DataReceived,            onDataReceived);
    room.on(RoomEvent.ChatMessage,             onChatMessage);

    if (typeof room.registerTextStreamHandler === 'function') {
      for (const topic of CHAT_TOPICS) {
        try {
          room.registerTextStreamHandler(topic, onChatTextStream);
        } catch (err) {
          log.warn({ err, topic }, 'Failed to register text stream handler');
        }
      }
    }

    log.debug({ roomId }, 'RoomEventEmitter attached');
  }

  function detach() {
    stopAllAudioReaders();

    room.off(RoomEvent.Connected,               onConnected);
    room.off(RoomEvent.Disconnected,            onDisconnected);
    room.off(RoomEvent.Reconnecting,            onReconnecting);
    room.off(RoomEvent.Reconnected,             onReconnected);
    room.off(RoomEvent.ParticipantConnected,    onParticipantConnected);
    room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.off(RoomEvent.TrackSubscribed,         onTrackSubscribed);
    room.off(RoomEvent.TrackUnsubscribed,       onTrackUnsubscribed);
    room.off(RoomEvent.DataReceived,            onDataReceived);
    room.off(RoomEvent.ChatMessage,             onChatMessage);

    if (typeof room.unregisterTextStreamHandler === 'function') {
      for (const topic of CHAT_TOPICS) {
        try {
          room.unregisterTextStreamHandler(topic);
        } catch {  }
      }
    }

    log.debug({ roomId }, 'RoomEventEmitter detached');
  }

  attach();

  return { detach };
}
