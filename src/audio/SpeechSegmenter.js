import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';
import { concatInt16Arrays } from './AudioUtils.js';

const log = logger.child({ module: 'SpeechSegmenter' });

const SAMPLE_RATE  = 16_000;
const FRAME_SIZE_MS = 30;

const MAX_UTTERANCE_MS     = 15_000;
const MAX_UTTERANCE_FRAMES = MAX_UTTERANCE_MS / FRAME_SIZE_MS;

const MIN_UTTERANCE_MS     = 200;
const MIN_UTTERANCE_FRAMES = MIN_UTTERANCE_MS / FRAME_SIZE_MS;

const SILENCE_PAD_FRAMES = 5;

function createSpeakerState(roomId, speakerId) {
  return {
    roomId,
    speakerId,
    isCapturing:    false,
    frames:         [],
    frameCount:     0,
    silencePadding: 0,
    startTs:        null,
  };
}

function createRoomState() {
  return {
    isCapturing:    false,
    frames:         [],
    frameCount:     0,
    silencePadding: 0,
    startTs:        null,
    speakerId:      null,
  };
}

export function createSpeechSegmenter() {

  const speakers = new Map();

  function getSpeakerKey(roomId, speakerId) {
    return `${roomId}:${speakerId}`;
  }

  function flush(roomId, speakerId, ts) {

    log.debug({ roomId, speakerId, ts }, '🗣️ flush() entered');

    const key = getSpeakerKey(roomId, speakerId);
    const state = speakers.get(key);
    if (!state || state.frames.length === 0) return;

    const frames    = state.frames;
    const startTs   = state.startTs;

    state.frames         = [];
    state.frameCount     = 0;
    state.silencePadding = 0;
    state.isCapturing    = false;
    state.startTs        = null;

    if (frames.length < MIN_UTTERANCE_FRAMES) {
      log.warn(
        { roomId, frames: frames.length, minFrames: MIN_UTTERANCE_FRAMES },
        'Utterance too short — discarded'
      );
      return;
    }

    const samples   = concatInt16Arrays(frames);
    const durMs     = (samples.length / SAMPLE_RATE) * 1000;

    log.info(
      { roomId, speakerId, durationMs: Math.round(durMs), samples: samples.length },
      `📢 Utterance ready (${(durMs / 1000).toFixed(1)}s)`
    );

    bus.emit(Events.UTTERANCE_READY, {
      roomId,
      speakerId,
      samples,
      sampleRate: SAMPLE_RATE,
      durationMs: durMs,
      startTs,
      endTs:      ts,
    });
    log.debug({ roomId, speakerId }, '🟢 UTTERANCE_READY emitted');
  }

  function onSpeechStart({ roomId, speakerId, ts }) {
    const key = getSpeakerKey(roomId, speakerId);
    if (!speakers.has(key)) {
      speakers.set(key, createSpeakerState(roomId, speakerId));
    }
    const state = speakers.get(key);

    if (state.isCapturing && state.frameCount > 0) {
      log.debug({ roomId, speakerId }, 'Speech start while already capturing — flushing previous utterance');
      flush(roomId, speakerId, ts);
    }

    state.isCapturing    = true;
    state.frames         = [];
    state.frameCount     = 0;
    state.silencePadding = 0;
    state.startTs        = ts;

    log.debug({ roomId, speakerId }, 'Started capturing utterance');
  }

  function onSpeechEnd({ roomId, speakerId, ts }) {
    const key = getSpeakerKey(roomId, speakerId);
    const state = speakers.get(key);
    if (!state || !state.isCapturing) return;

    state.isCapturing    = false;
    state.silencePadding = 0;

    log.debug({ roomId, frameCount: state.frameCount }, 'Speech end — collecting silence padding');
  }

  function onChunk({ roomId, speakerId, chunk, ts }) {
    const key = getSpeakerKey(roomId, speakerId);
    const state = speakers.get(key);
    if (!state) return;

    if (state.isCapturing) {
      state.frames.push(chunk);
      state.frameCount++;

      if (state.frameCount >= MAX_UTTERANCE_FRAMES) {
        log.warn(
          { roomId, speakerId, frames: state.frameCount, maxMs: MAX_UTTERANCE_MS },
          'Max utterance length reached — force-flushing'
        );

        const startTs = state.startTs;
        flush(roomId, speakerId, ts);
        state.isCapturing = true;
        state.startTs     = startTs;
      }

    } else if (state.frames.length > 0) {

      state.frames.push(chunk);
      state.silencePadding++;

      if (state.silencePadding >= SILENCE_PAD_FRAMES) {
        flush(roomId, speakerId, ts);
      }
    }

  }

  function onTrackRemoved({ roomId, participantId }) {
    const key = getSpeakerKey(roomId, participantId);
    const state = speakers.get(key);
    if (!state) return;
    const frames = state.frameCount;
    speakers.delete(key);
    if (frames > 0) {
      log.debug({ roomId, speakerId: participantId, frames, reason: 'track removed' }, 'In-progress utterance discarded');
    }
  }

  function onRoomDisconnected({ roomId }) {
    for (const [key, state] of speakers) {
      if (state.roomId === roomId) {
        const frames = state.frameCount;
        speakers.delete(key);
        if (frames > 0) {
          log.debug({ roomId, speakerId: state.speakerId, frames, reason: 'room disconnected' }, 'In-progress utterance discarded');
        }
      }
    }
  }

  function init() {
    bus.on(Events.SPEECH_CHUNK,         onChunk);
    bus.on(Events.VAD_SPEECH_START,     onSpeechStart);
    bus.on(Events.VAD_SPEECH_END,       onSpeechEnd);
    bus.on(Events.ROOM_DISCONNECTED,    onRoomDisconnected);
    bus.on(Events.AUDIO_TRACK_REMOVED,  onTrackRemoved);

    log.info(
      {
        maxUtteranceMs:   MAX_UTTERANCE_MS,
        minUtteranceMs:   MIN_UTTERANCE_MS,
        silencePadFrames: SILENCE_PAD_FRAMES,
      },
      'SpeechSegmenter initialised'
    );
  }

  function destroy() {
    bus.off(Events.SPEECH_CHUNK,         onChunk);
    bus.off(Events.VAD_SPEECH_START,     onSpeechStart);
    bus.off(Events.VAD_SPEECH_END,       onSpeechEnd);
    bus.off(Events.ROOM_DISCONNECTED,    onRoomDisconnected);
    bus.off(Events.AUDIO_TRACK_REMOVED,  onTrackRemoved);
    speakers.clear();
    log.debug('SpeechSegmenter destroyed');
  }

  function getStats() {
    const result = [];
    for (const [key, state] of speakers) {
      result.push({
        roomId:      state.roomId,
        speakerId:   state.speakerId,
        isCapturing: state.isCapturing,
        frameCount:  state.frameCount,
        durationMs:  Math.round(state.frameCount * FRAME_SIZE_MS),
        silencePad:  state.silencePadding,
      });
    }
    return result;
  }

  return { init, destroy, getStats };
}
