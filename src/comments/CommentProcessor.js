import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';

const log = logger.child({ module: 'CommentProcessor' });

export function createCommentProcessor(config) {
  const { context, behavior } = config;

  if (!context)  throw new Error('CommentProcessor: context is required');
  if (!behavior) throw new Error('CommentProcessor: behavior is required');

  async function onCommentAccepted({ roomId, userId, username, text }) {
    if (!text?.trim()) return;
    log.debug({ roomId, username, text }, '💬 Comment accepted');
    try {
      await context.addComment(roomId, userId, username, text);
      const decision = await behavior.evaluate({ roomId, type: 'comment', text });
      if (!decision.shouldReply) return;
      bus.emit(Events.BEHAVIOR_APPROVED, {
        roomId,
        trigger:     text,
        triggerType: 'comment',
        username,
        delayMs:     decision.delayMs,
      });
    } catch (err) {
      log.error({ err, roomId }, 'Error in comment handler');
    }
  }

  function init() {
    bus.on(Events.COMMENT_ACCEPTED, onCommentAccepted);
    log.info('CommentProcessor initialised');
  }

  function destroy() {
    bus.off(Events.COMMENT_ACCEPTED, onCommentAccepted);
    log.debug('CommentProcessor destroyed');
  }

  return { init, destroy };
}
