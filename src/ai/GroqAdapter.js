import logger from '../utils/logger.js';
import { retry } from '../utils/retry.js';

const log = logger.child({ module: 'GroqAdapter' });

const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 15_000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const FALLBACK_MODELS = [
  'llama-3.1-8b-instant',
];

export function createGroqAdapter(config) {
  const {
    apiKey,
    model,
    maxTokens   = 256,
    temperature = 0.85,
    timeoutMs   = DEFAULT_TIMEOUT_MS,
    maxRetries  = 3,
    retryBaseMs = 500,
  } = config;

  let trimmedApiKey = apiKey?.trim();
  const defaultApiKey = process.env.GROQ_API_KEY?.trim();

  log.info({ keyLength: trimmedApiKey?.length, keyPrefix: trimmedApiKey?.slice(0, 10), model }, 'Initializing GroqAdapter');

  if (!trimmedApiKey) throw new Error('GroqAdapter: apiKey is required');
  if (!model?.trim())  throw new Error('GroqAdapter: model is required');

  async function _sendRequest(messages, options = {}) {
    const activeModel = options.currentModel ?? model;
    
    const isOpenRouter = trimmedApiKey?.startsWith('sk-or-');
    const endpoint = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : GROQ_API_ENDPOINT;

    // Map common Groq models to OpenRouter equivalents
    let finalModel = activeModel;
    if (isOpenRouter) {
      if (activeModel === 'llama-3.3-70b-versatile') {
        finalModel = 'meta-llama/llama-3.3-70b-instruct';
      } else if (activeModel === 'llama-3.1-70b-versatile') {
        finalModel = 'meta-llama/llama-3.1-70b-instruct';
      } else if (activeModel === 'llama-3.1-8b-instant') {
        finalModel = 'meta-llama/llama-3.1-8b-instruct';
      } else if (activeModel === 'llama3-70b-8192') {
        finalModel = 'meta-llama/llama-3-70b-instruct';
      } else if (activeModel === 'llama3-8b-8192') {
        finalModel = 'meta-llama/llama-3-8b-instruct';
      }
    }

    const bodyObj = {
      model:       finalModel,
      messages,
      max_tokens:  options.maxTokens ?? maxTokens,
      temperature: options.temperature ?? temperature,
      stream:      false,
    };

    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${trimmedApiKey}`,
    };
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://roxstarstudioz.com';
      headers['X-Title'] = 'Roxstar AI Chatbot';
    }

    const body = JSON.stringify(bodyObj);

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(endpoint, {
        method:  'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {

      if (err.name === 'AbortError') {
        throw new GroqTimeoutError(`Groq request timed out after ${timeoutMs}ms`);
      }
      throw new GroqNetworkError(`Groq network error: ${err.message}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401 && defaultApiKey && trimmedApiKey !== defaultApiKey) {
        log.warn('Groq key returned 401. Falling back to default GROQ_API_KEY...');
        trimmedApiKey = defaultApiKey;
        try {
          response = await fetch(GROQ_API_ENDPOINT, {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${defaultApiKey}`,
            },
            body,
            signal: controller.signal,
          });
        } catch (err) {
          throw new GroqNetworkError(`Groq network error on fallback: ${err.message}`, { cause: err });
        }
      }
    }

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch {  }

      const status  = response.status;
      const message = `Groq API error ${status} (${activeModel}): ${errorBody.slice(0, 200)}`;

      if (RETRYABLE_STATUS.has(status)) {
        const retryable = new GroqRetryableError(message);
        retryable.status = status;
        // Respect Groq's retry-after header if present
        const retryAfter = response.headers?.get?.('retry-after');
        if (retryAfter) {
          retryable.retryAfterMs = parseFloat(retryAfter) * 1000;
        }
        throw retryable;
      }

      const fatal = new GroqAPIError(message);
      fatal.status = status;
      throw fatal;
    }

    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new GroqAPIError(`Failed to parse Groq response as JSON: ${err.message}`, { cause: err });
    }

    return json;
  }

  async function complete(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('GroqAdapter.complete: messages must be a non-empty array');
    }

    const modelsToTry = [model];
    for (const m of FALLBACK_MODELS) {
      if (m !== model) {
        modelsToTry.push(m);
      }
    }

    let lastError;
    for (const currentModel of modelsToTry) {
      try {
        log.debug({ model: currentModel, messageCount: messages.length, options }, 'Sending completion request');

        const completion = await retry(
          () => _sendRequest(messages, { ...options, currentModel }),
          {
            maxAttempts:   maxRetries,
            baseDelayMs:   retryBaseMs,

            shouldRetry:   (err) => err instanceof GroqRetryableError,
            onRetry:       (err, attempt) => {
              const delayHint = err.retryAfterMs ? ` (retry-after: ${err.retryAfterMs}ms)` : '';
              log.warn(
                { attempt, maxRetries, status: err.status, message: err.message, model: currentModel },
                `Groq request failed — retrying${delayHint}`
              );
            },
          }
        );

        log.debug(
          {
            model:            currentModel,
            promptTokens:     completion?.usage?.prompt_tokens,
            completionTokens: completion?.usage?.completion_tokens,
            finishReason:     completion?.choices?.[0]?.finish_reason,
          },
          'Completion received'
        );

        return completion;
      } catch (err) {
        lastError = err;
        const isLast = currentModel === modelsToTry[modelsToTry.length - 1];
        if (isLast) {
          log.error({ err: err.message, failedModel: currentModel }, 'All models exhausted — giving up');
        } else {
          log.warn({ failedModel: currentModel }, '⚠️  Model rate-limited/failed — switching to fallback model');
        }
      }
    }

    throw lastError;
  }

  function getModel() {
    return model;
  }

  return { complete, getModel };
}

export class GroqAPIError     extends Error { constructor(m, o) { super(m, o); this.name = 'GroqAPIError';     } }
export class GroqTimeoutError extends Error { constructor(m, o) { super(m, o); this.name = 'GroqTimeoutError'; } }
export class GroqNetworkError extends Error { constructor(m, o) { super(m, o); this.name = 'GroqNetworkError'; } }
export class GroqRetryableError extends Error { constructor(m, o) { super(m, o); this.name = 'GroqRetryableError'; } }
