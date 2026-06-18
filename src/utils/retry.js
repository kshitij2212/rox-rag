import logger from './logger.js';

const log = logger.child({ module: 'retry' });

export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs  = 15_000,
    jitter      = true,
    shouldRetry = () => true,
    onRetry     = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts) break;

      if (!shouldRetry(err)) {
        log.debug(
          { attempt, errName: err.name },
          'Error is not retryable — giving up immediately'
        );
        break;
      }

      if (onRetry) onRetry(err, attempt);

      let delay = err.retryAfterMs;
      if (typeof delay !== 'number' || isNaN(delay)) {
        const base  = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        delay = jitter
          ? Math.round(base * (0.8 + Math.random() * 0.4))
          : base;
      }

      log.debug(
        { attempt, maxAttempts, delayMs: delay, errName: err.name },
        'Retrying after delay'
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
