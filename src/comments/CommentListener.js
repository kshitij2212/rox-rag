import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';

const log = logger.child({ module: 'CommentListener' });

export function createCommentListener(config = {}) {
  const ignoredUserIds = new Set(
    (config.ignoredUserIds ?? []).map(id => String(id).toLowerCase())
  );

  const stats = {
    received:   0,
    ignored:    0,
    forwarded:  0,
  };

  function onCommentReceived(comment) {
    stats.received++;

    const { roomId, userId, username, text, source } = comment;

    if (ignoredUserIds.has(String(userId).toLowerCase())) {
      stats.ignored++;
      log.debug({ roomId, userId }, 'Comment from ignored user — dropped');
      return;
    }

    log.debug(
      { roomId, userId, username, textLen: text?.length, source },
      'Comment received'
    );

    stats.forwarded++;

  }

  bus.on(Events.COMMENT_RECEIVED, onCommentReceived);
  log.debug('CommentListener registered');

  return {

    destroy() {
      bus.off(Events.COMMENT_RECEIVED, onCommentReceived);
      log.debug('CommentListener destroyed');
    },

    ignoreUser(userId) {
      ignoredUserIds.add(String(userId).toLowerCase());
      log.info({ userId }, 'User added to CommentListener ignore list');
    },

    unignoreUser(userId) {
      ignoredUserIds.delete(String(userId).toLowerCase());
      log.info({ userId }, 'User removed from CommentListener ignore list');
    },

    getStats() {
      return { ...stats };
    },
  };
}
