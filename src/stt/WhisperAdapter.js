import { encodeWAV }    from '../audio/AudioUtils.js';
import logger           from '../utils/logger.js';
import { writeFileSync } from 'fs';

const log = logger.child({ module: 'WhisperAdapter' });

const MIN_SAMPLES_16KHZ = 160;

const MODEL = 'whisper-large-v3-turbo';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export function createWhisperAdapter(config) {
  let apiKey = config.apiKey?.trim();
  const defaultApiKey = process.env.GROQ_API_KEY?.trim();

  if (apiKey?.startsWith('sk-or-') && defaultApiKey) {
    log.info('WhisperAdapter received OpenRouter key. Falling back to GROQ_API_KEY for audio transcription...');
    apiKey = defaultApiKey;
  }

  log.info({ keyLength: apiKey?.length, keyPrefix: apiKey?.slice(0, 10) }, 'WhisperAdapter API Key check');

  if (!apiKey) {
    throw new Error('WhisperAdapter: missing required config field "apiKey"');
  }

  async function transcribe(samples, sampleRate) {

    const minSamples = Math.round(MIN_SAMPLES_16KHZ * (sampleRate / 16000));
    if (!samples || samples.length < minSamples) {
      log.warn(
        { sampleCount: samples?.length ?? 0, minSamples, sampleRate },
        'Utterance too short — skipping Groq transcription'
      );
      return '';
    }

    const wavBuffer = encodeWAV(samples, sampleRate);
    writeFileSync(`/tmp/utterance_${Date.now()}.wav`, wavBuffer);
    log.info('WAV saved to /tmp');

    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', blob, 'utterance.wav');
    formData.append('model', MODEL);
    formData.append('response_format', 'json');
    formData.append('language', 'hi');
    formData.append('temperature', '0');

    let response;
    let lastError = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      try {
        response = await fetch(GROQ_AUDIO_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        if (response.ok) {
          clearTimeout(timer);
          break;
        }

        let errorBody = '';
        try { errorBody = await response.text(); } catch {  }
        lastError = new Error(`Groq Whisper API error ${response.status}: ${errorBody.slice(0, 200)}`);
        log.warn({ attempt, error: lastError.message }, 'Groq Whisper API error — retrying');

      } catch (err) {
        if (err.name === 'AbortError') {
          lastError = new Error(`Groq Whisper request timed out after 15s`);
        } else {
          lastError = new Error(`Groq Whisper network error: ${err.message}`);
        }
        log.warn({ attempt, error: lastError.message }, 'Groq Whisper fetch failed — retrying');
      } finally {
        clearTimeout(timer);
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('Groq Whisper transcription failed after all attempts');
    }

    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new Error(`Failed to parse Groq Whisper response as JSON: ${err.message}`);
    }

    return json.text ?? '';
  }

  return { transcribe };
}
