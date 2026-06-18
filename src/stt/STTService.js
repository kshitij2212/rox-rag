import bus, { Events }           from '../core/EventBus.js';
import { createWhisperAdapter }  from './WhisperAdapter.js';
import { normalizeTranscript }   from './TranscriptNormalizer.js';
import logger                    from '../utils/logger.js';

const log = logger.child({ module: 'STTService' });

function computeRMS(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export function createSTTService(config) {
  const { groqApiKey, sttMinRms = 370 } = config;

  const whisper = createWhisperAdapter({ apiKey: groqApiKey });

  async function onUtteranceReady({ roomId, speakerId, samples, sampleRate, durationMs }) {
    const ts = Date.now();

    log.info({ roomId, speakerId, durationMs: Math.round(durationMs) }, 'STT: onUtteranceReady fired');

    const rms = computeRMS(samples);
    log.info({ roomId, speakerId, rms: Math.round(rms), threshold: sttMinRms }, 'STT: calculated utterance RMS energy');

    if (rms < sttMinRms) {
      log.info({ roomId, speakerId, rms: Math.round(rms), threshold: sttMinRms }, 'STT: utterance discarded due to low energy (likely air noise/silence)');
      bus.emit(Events.STT_FAILED, {
        roomId,
        speakerId,
        reason: 'low_energy',
        ts,
      });
      return;
    }

    log.debug(
      { roomId, speakerId, durationMs: Math.round(durationMs) },
      'STT: received utterance'
    );

    let raw;
    try {
      raw = await whisper.transcribe(samples, sampleRate);
      // log.info({ roomId, speakerId, raw }, '🎙️ RAW WHISPER OUTPUT');
    } catch (err) {
      log.error({ roomId, speakerId, err }, 'STT: Groq API error');
      bus.emit(Events.STT_FAILED, {
        roomId,
        speakerId,
        reason: err?.message ?? 'groq_api_error',
        ts,
      });
      return;
    }

    const text = normalizeTranscript(raw);
    // log.info({ roomId, speakerId, rawInput: raw, normalizedOutput: text }, '🔍 RAW vs NORMALIZED');

    if (!text) {
      log.debug({ roomId, speakerId, raw }, 'STT: transcript empty after normalization');
      bus.emit(Events.STT_FAILED, {
        roomId,
        speakerId,
        reason: 'empty_transcript',
        ts,
      });
      return;
    }

    log.info({ roomId, speakerId, text }, '📝 Transcript ready');
    bus.emit(Events.TRANSCRIPT_READY, {
      roomId,
      speakerId,
      text,
      ts,
    });
  }

  function init() {
    bus.on(Events.UTTERANCE_READY, onUtteranceReady);
    log.info('STTService initialised');
    log.info({ listenerCount: bus.listenerCount(Events.UTTERANCE_READY) }, 'UTTERANCE_READY listeners');
  }

  function destroy() {
    bus.off(Events.UTTERANCE_READY, onUtteranceReady);
    log.debug('STTService destroyed');
  }

  return { init, destroy };
}
