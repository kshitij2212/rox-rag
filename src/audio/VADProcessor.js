import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';

const log = logger.child({ module: 'VADProcessor' });

const MIN_ENERGY_THRESHOLD   = 100;
const ADAPTIVE_MULTIPLIER    = 2;
const CALIBRATION_FRAMES     = 33;

const MAX_ZCR_FOR_SPEECH     = 0.65;

const SPEECH_CONFIRM_FRAMES  = 3;
const SILENCE_CONFIRM_FRAMES = 40;

function computeRMS(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

function computeZCR(frame) {
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) crossings++;
  }
  return crossings / frame.length;
}

function createSpeakerState(roomId, speakerId) {
  return {
    roomId,
    speakerId,
    calibrationFrames: [],
    isCalibrated:      false,
    energyThreshold:   MIN_ENERGY_THRESHOLD,
    state:             'CALIBRATING',
    speechConfirm:     0,
    silenceConfirm:    0,
  };
}

export function createVADProcessor() {

  const speakers = new Map();

  function getSpeakerKey(roomId, speakerId) {
    return `${roomId}:${speakerId}`;
  }

  function updateStateMachine(state, roomId, speakerId, isSpeechFrame, ts) {
    if (state.state === 'SILENCE') {
      if (isSpeechFrame) {
        state.speechConfirm++;
        state.silenceConfirm = 0;

        if (state.speechConfirm >= SPEECH_CONFIRM_FRAMES) {
          state.state         = 'SPEAKING';
          state.speechConfirm = 0;
          log.debug({ roomId }, '🎙  VAD: speech start');
          bus.emit(Events.VAD_SPEECH_START, { roomId, speakerId, ts });
        }
      } else {
        state.speechConfirm = 0;
      }

    } else if (state.state === 'SPEAKING') {
      if (!isSpeechFrame) {
        state.silenceConfirm++;
        state.speechConfirm = 0;

        if (state.silenceConfirm >= SILENCE_CONFIRM_FRAMES) {
          state.state          = 'SILENCE';
          state.silenceConfirm = 0;
          log.debug({ roomId }, '🔇  VAD: speech end');
          bus.emit(Events.VAD_SPEECH_END, { roomId, speakerId, ts });
        }
      } else {
        state.silenceConfirm = 0;
      }
    }
  }

  function onChunk({ roomId, speakerId, chunk, ts }) {
    if (!chunk || chunk.length === 0) return;

    const key = getSpeakerKey(roomId, speakerId);

    if (!speakers.has(key)) {
      speakers.set(key, createSpeakerState(roomId, speakerId));
      log.debug({ roomId, speakerId }, 'VAD state created for speaker');
    }

    const state = speakers.get(key);

    const rms = computeRMS(chunk);
    const zcr = computeZCR(chunk);

    if (!state.isCalibrated) {
      state.calibrationFrames.push(rms);

      if (state.calibrationFrames.length >= CALIBRATION_FRAMES) {
        const sum    = state.calibrationFrames.reduce((a, b) => a + b, 0);
        const avgRMS = sum / state.calibrationFrames.length;

        state.energyThreshold   = Math.max(MIN_ENERGY_THRESHOLD, Math.round(avgRMS * ADAPTIVE_MULTIPLIER));
        state.isCalibrated      = true;
        state.state             = 'SILENCE';
        state.calibrationFrames = [];

        log.info(
          { roomId, ambientRMS: Math.round(avgRMS), threshold: state.energyThreshold },
          'VAD calibrated'
        );
      }

      return;
    }

    const isSpeechFrame = rms > state.energyThreshold && zcr < MAX_ZCR_FOR_SPEECH;

    log.trace(
      {
        roomId,
        rms:       Math.round(rms),
        zcr:       zcr.toFixed(3),
        threshold: state.energyThreshold,
        isSpeechFrame,
        state:     state.state,
      },
      'VAD frame'
    );

    updateStateMachine(state, roomId, speakerId, isSpeechFrame, ts);
  }

  function onTrackRemoved({ roomId, participantId }) {
    const key = getSpeakerKey(roomId, participantId);
    speakers.delete(key);
    log.debug({ roomId, speakerId: participantId }, 'VAD state cleared on track removed');
  }

  function onRoomDisconnected({ roomId }) {
    for (const [key, state] of speakers) {
      if (state.roomId === roomId) {
        speakers.delete(key);
        log.debug({ roomId, speakerId: state.speakerId }, 'VAD state cleared on room disconnect');
      }
    }
  }

  function init() {
    bus.on(Events.SPEECH_CHUNK,         onChunk);
    bus.on(Events.ROOM_DISCONNECTED,    onRoomDisconnected);
    bus.on(Events.AUDIO_TRACK_REMOVED,  onTrackRemoved);
    log.info('VADProcessor initialised (pure-JS energy+ZCR mode)');
  }

  function destroy() {
    bus.off(Events.SPEECH_CHUNK,         onChunk);
    bus.off(Events.ROOM_DISCONNECTED,    onRoomDisconnected);
    bus.off(Events.AUDIO_TRACK_REMOVED,  onTrackRemoved);
    speakers.clear();
    log.debug('VADProcessor destroyed');
  }

  function getStats() {
    const result = [];
    for (const [key, state] of speakers) {
      result.push({
        roomId:          state.roomId,
        speakerId:       state.speakerId,
        state:           state.state,
        isCalibrated:    state.isCalibrated,
        energyThreshold: state.energyThreshold,
        speechConfirm:   state.speechConfirm,
        silenceConfirm:  state.silenceConfirm,
      });
    }
    return result;
  }

  return { init, destroy, getStats };
}
