console.log('🚀 AudioBuffer (ring‑buffer) version loaded');

import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';

const log = logger.child({ module: 'AudioBuffer' });

const CHUNK_SIZE_MS = 30;

const MAX_BUFFER_MS = 500;

const SAMPLE_RATE = 16_000;

const SAMPLES_PER_CHUNK  = Math.round((SAMPLE_RATE * CHUNK_SIZE_MS) / 1000);
const MAX_BUFFER_SAMPLES = Math.round((SAMPLE_RATE * MAX_BUFFER_MS) / 1000);

function createRingBuffer(capacity) {
  const buf      = new Int16Array(capacity);
  const chunkBuf = new Int16Array(SAMPLES_PER_CHUNK);
  let writePos = 0;
  let count    = 0;

  return {

    write(samples) {
      const len = samples.length;

      if (len >= capacity) {

        buf.set(samples.subarray(len - capacity));
        writePos = 0;
        count    = capacity;
        return;
      }

      const overflow = count + len - capacity;
      if (overflow > 0) {

        count = capacity - len;
      }

      const endPos = writePos + len;
      if (endPos <= capacity) {
        buf.set(samples, writePos);
      } else {

        const firstPart = capacity - writePos;
        buf.set(samples.subarray(0, firstPart), writePos);
        buf.set(samples.subarray(firstPart), 0);
      }
      writePos = endPos % capacity;
      count = Math.min(count + len, capacity);
    },

    get available() { return count; },

    readChunk() {
      if (count < SAMPLES_PER_CHUNK) return null;

      const readPos = (writePos - count + capacity) % capacity;

const endPos = readPos + SAMPLES_PER_CHUNK;
if (endPos <= capacity) {
  chunkBuf.set(buf.subarray(readPos, endPos));
} else {
  const firstPart = capacity - readPos;
  chunkBuf.set(buf.subarray(readPos, capacity), 0);
  chunkBuf.set(buf.subarray(0, SAMPLES_PER_CHUNK - firstPart), firstPart);
}
      count -= SAMPLES_PER_CHUNK;
      return chunkBuf.slice();
    },

    clear() {
      writePos = 0;
      count    = 0;
    },
  };
}

export function createAudioBuffer() {

  const speakers = new Map();

  function getSpeakerKey(roomId, speakerId) {
    return `${roomId}:${speakerId}`;
  }

  let stats = { framesReceived: 0, chunksEmitted: 0, overflows: 0 };
  let statsInterval = null;

  function onFrame(frame) {
    stats.framesReceived++;

    const { roomId, speakerId, data, ts } = frame;
    if (stats.framesReceived === 1) {
      log.info({ sampleRate: frame.sampleRate, channels: frame.channels, dataLen: frame.data?.length }, 'First audio frame received');
    }

    if (!data || data.length === 0) return;

    const key = getSpeakerKey(roomId, speakerId);

    if (!speakers.has(key)) {
      speakers.set(key, {
        ring: createRingBuffer(MAX_BUFFER_SAMPLES),
        speakerId,
        roomId,
      });
      log.debug({ roomId, speakerId }, 'New speaker ring buffer created');
    }

    const state = speakers.get(key);

    const beforeAvail = state.ring.available;
    if (beforeAvail + data.length > MAX_BUFFER_SAMPLES) {
      stats.overflows++;
      log.warn(
        { roomId, speakerId, available: beforeAvail, incoming: data.length },
        'AudioBuffer overflow — oldest samples will be overwritten'
      );
    }

    stats.chunksEmitted++;

    bus.emit(Events.SPEECH_CHUNK, {
      roomId,
      speakerId:   state.speakerId,
      chunk:       data,
      sampleRate:  SAMPLE_RATE,
      chunkSizeMs: CHUNK_SIZE_MS,
      ts,
    });}

  function clearSpeaker(roomId, speakerId) {
    const key = getSpeakerKey(roomId, speakerId);
    const state = speakers.get(key);
    if (!state) return;
    log.debug({ roomId, speakerId, available: state.ring.available }, 'Speaker ring buffer cleared');
    state.ring.clear();
    speakers.delete(key);
  }

  function onTrackRemoved({ roomId, participantId }) {
    clearSpeaker(roomId, participantId);
  }

  function onRoomDisconnected({ roomId }) {
    for (const [key, state] of speakers) {
      if (state.roomId === roomId) {
        log.debug(
          { roomId, speakerId: state.speakerId, available: state.ring.available },
          'Speaker ring buffer cleared on room disconnect'
        );
        state.ring.clear();
        speakers.delete(key);
      }
    }
  }

  function logStats() {
    if (stats.framesReceived === 0) return;
    log.debug(
      {
        framesReceived: stats.framesReceived,
        chunksEmitted:  stats.chunksEmitted,
        overflows:      stats.overflows,
        activeSpeakers: speakers.size,
      },
      'AudioBuffer stats (last 10s)'
    );
    stats = { framesReceived: 0, chunksEmitted: 0, overflows: 0 };
  }

  function init() {
    bus.on(Events.AUDIO_FRAME,         onFrame);
    bus.on(Events.AUDIO_TRACK_REMOVED, onTrackRemoved);
    bus.on(Events.ROOM_DISCONNECTED,   onRoomDisconnected);

    statsInterval = setInterval(logStats, 10_000);

    statsInterval.unref();

    log.info(
      { chunkSizeMs: CHUNK_SIZE_MS, samplesPerChunk: SAMPLES_PER_CHUNK },
      'AudioBuffer initialised'
    );
  }

  function destroy() {
    bus.off(Events.AUDIO_FRAME,         onFrame);
    bus.off(Events.AUDIO_TRACK_REMOVED, onTrackRemoved);
    bus.off(Events.ROOM_DISCONNECTED,   onRoomDisconnected);

    clearInterval(statsInterval);
    statsInterval = null;

    speakers.clear();
    log.debug('AudioBuffer destroyed');
  }

  return { init, destroy };
}
