import bus, { Events }   from '../core/EventBus.js';
import logger             from '../utils/logger.js';
import { GroqAPIError, GroqTimeoutError, GroqNetworkError } from './GroqAdapter.js';

const log = logger.child({ module: 'LLMService' });

const MAX_CONCURRENT_PER_ROOM = 1;

export function createLLMService({ groqAdapter, responseParser }) {
  if (!groqAdapter)    throw new Error('LLMService: groqAdapter is required');
  if (!responseParser) throw new Error('LLMService: responseParser is required');

  const inFlight = new Map();

  function getInFlight(roomId)      { return inFlight.get(roomId) ?? 0; }
  function incrementInFlight(roomId){ inFlight.set(roomId, getInFlight(roomId) + 1); }
  function decrementInFlight(roomId){
    const next = getInFlight(roomId) - 1;
    if (next <= 0) inFlight.delete(roomId);
    else           inFlight.set(roomId, next);
  }

  async function onContextReady({ roomId, trigger, promptMessages, contextPayload }) {

    if (getInFlight(roomId) >= MAX_CONCURRENT_PER_ROOM) {
      log.debug(
        { roomId, userId: trigger?.userId, inFlight: getInFlight(roomId) },
        'Dropping LLM request — room concurrency limit reached'
      );
      return;
    }

    incrementInFlight(roomId);

    log.debug(
      { roomId, userId: trigger?.userId, model: groqAdapter.getModel(), messageCount: promptMessages?.length },
      'Requesting LLM completion'
    );

    try {
      const completion = await groqAdapter.complete(promptMessages);

      const parsed = responseParser.parse(completion, { roomId, userId: trigger?.userId });

      if (!parsed.shouldReply) {

        log.debug({ roomId, userId: trigger?.userId }, 'LLM signalled silence — no reply emitted');
        return;
      }

      bus.emit(Events.REPLY_READY, {
        roomId,
        trigger,
        text:           parsed.text,
        usage:          parsed.usage,
        contextPayload,
      });

      log.info(
        { roomId, userId: trigger?.userId, replyLen: parsed.text.length },
        'Reply ready'
      );

    } catch (err) {
      _handleError(err, roomId, trigger);
    } finally {
      decrementInFlight(roomId);
    }
  }

  function _handleError(err, roomId, trigger) {
    const meta = { roomId, userId: trigger?.userId, errName: err.name, errMessage: err.message };

    if (err instanceof GroqTimeoutError) {
      log.warn(meta, 'LLM request timed out');
    } else if (err instanceof GroqNetworkError) {
      log.warn(meta, 'LLM request failed — network error');
    } else if (err instanceof GroqAPIError) {

      log.error({ ...meta, status: err.status }, 'LLM request failed — API error');
    } else {
      log.error({ ...meta, err }, 'LLM request failed — unexpected error');
    }

    bus.emit(Events.REPLY_FAILED, {
      roomId,
      trigger,
      errName:    err.name,
      errMessage: err.message,
    });
  }

  bus.on(Events.CONTEXT_READY, onContextReady);
  log.debug('LLMService registered');

  return {

    destroy() {
      bus.off(Events.CONTEXT_READY, onContextReady);
      log.debug('LLMService destroyed');
    },

    getInFlightCount: (roomId) => getInFlight(roomId),
  };
}
