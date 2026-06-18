import logger from '../utils/logger.js';
import { retry } from '../utils/retry.js';

const log = logger.child({ module: 'OpenAIAdapter' });

const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createOpenAIAdapter(config) {
  const {
    apiKey,
    model = 'gpt-4o-mini',
    maxTokens   = 256,
    temperature = 0.85,
    timeoutMs   = DEFAULT_TIMEOUT_MS,
    maxRetries  = 3,
    retryBaseMs = 500,
  } = config;

  const trimmedApiKey = apiKey?.trim();

  log.info({ keyLength: trimmedApiKey?.length, keyPrefix: trimmedApiKey?.slice(0, 10), model }, 'Initializing OpenAIAdapter');

  if (!trimmedApiKey) throw new Error('OpenAIAdapter: apiKey is required');

  async function _sendRequest(messages, options = {}) {
    const activeModel = options.currentModel ?? model;

    const bodyObj = {
      model:       activeModel,
      messages,
      max_tokens:  options.maxTokens ?? maxTokens,
      temperature: options.temperature ?? temperature,
      stream:      false,
    };

    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${trimmedApiKey}`,
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(OPENAI_API_ENDPOINT, {
        method:  'POST',
        headers,
        body:    JSON.stringify(bodyObj),
        signal:  controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`OpenAI network error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch { }

      const status  = response.status;
      const message = `OpenAI API error ${status} (${activeModel}): ${errorBody.slice(0, 200)}`;

      if (RETRYABLE_STATUS.has(status)) {
        const retryable = new Error(message);
        retryable.status = status;
        throw retryable;
      }

      const fatal = new Error(message);
      fatal.status = status;
      throw fatal;
    }

    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new Error(`Failed to parse OpenAI response as JSON: ${err.message}`);
    }

    return json;
  }

  async function complete(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('OpenAIAdapter.complete: messages must be a non-empty array');
    }

    let lastError;
    try {
      const completion = await retry(
        () => _sendRequest(messages, options),
        {
          maxAttempts:   maxRetries,
          baseDelayMs:   retryBaseMs,
          shouldRetry:   (err) => RETRYABLE_STATUS.has(err.status),
          onRetry:       (err, attempt) => {
            log.warn(
              { attempt, maxRetries, status: err.status, message: err.message, model },
              `OpenAI request failed — retrying`
            );
          },
        }
      );
      return completion;
    } catch (err) {
      lastError = err;
      log.error({ err: err.message, model }, 'OpenAI API call failed');
    }

    throw lastError;
  }

  function getModel() {
    return model;
  }

  return { complete, getModel };
}
