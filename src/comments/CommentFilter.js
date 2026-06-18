import bus, { Events }         from '../core/EventBus.js';
import logger                   from '../utils/logger.js';
import { classifyTarget }       from './UtteranceTargetFilter.js';

const log = logger.child({ module: 'CommentFilter' });

const DEFAULTS = {

  minLength:            3,
  maxLength:            500,

  rateLimitWindowMs:    10_000,
  rateLimitMaxMessages: 5,

  replyProbability:     1.0,

  blockedUserIds:       [],
  botNames:             [],   // current bot names — used for UtteranceTargetFilter
  otherBotNames:        [],   // other bots' display names to block when addressed directly
  triggerKeywords:      [
    '?',
  ],
  blocklistPhrases:     [],
};

const EMOJI_ONLY_RE = /^[\p{Emoji}\p{P}\s]+$/u;

const BOT_USERNAME_RE = /^\d+$|bot$|_bot$|-bot$/i;

const QUESTION_ABOUT_OTHER_RE = /(?:ko\s+)?(?:jaante|jante|jaanta|janta|kaun|kon|who|know|about)/i;

const rateLimitMap = new Map();

function isRateLimited(userId, windowMs, maxMessages) {
  const now        = Date.now();
  const cutoff     = now - windowMs;
  const timestamps = (rateLimitMap.get(userId) ?? []).filter(t => t > cutoff);

  if (timestamps.length >= maxMessages) {
    rateLimitMap.set(userId, timestamps);
    return true;
  }

  timestamps.push(now);
  rateLimitMap.set(userId, timestamps);
  return false;
}

export function createCommentFilter(config = {}) {
  const cfg = { ...DEFAULTS, ...config };

  const blockedSet = new Set(cfg.blockedUserIds.map(id => String(id).toLowerCase()));

  // Build word-boundary regexes for other bots' names (English)
  const otherBotNameRegexes = (cfg.otherBotNames || []).map(
    name => new RegExp(`\\b${name.replace(/[-/]/g, '[-/]')}\\b`, 'i')
  );
  // Build word-boundary regexes for current bot's names
  const myBotNameRegexes = (cfg.botNames || []).map(
    name => new RegExp(`\\b${name.replace(/[-/]/g, '[-/]')}\\b`, 'i')
  );

  function evaluate(comment) {
    const { userId, username, text } = comment;
    const lowerText = text.toLowerCase();

    if (blockedSet.has(String(userId).toLowerCase()) || blockedSet.has(String(username).toLowerCase())) {
      return 'blocked_user';
    }

    for (const phrase of cfg.blocklistPhrases) {
      if (lowerText.includes(phrase.toLowerCase())) {
        return 'blocklist_phrase';
      }
    }

    // 1. Check if comment explicitly names another bot/person but NOT this bot
    //    This handles cases like "Abhishek, I liked your choice" or "Hello Shivam"
    if (otherBotNameRegexes.length > 0) {
      const mentionsOther = otherBotNameRegexes.some(re => re.test(text));
      if (mentionsOther) {
        const mentionsSelf = myBotNameRegexes.some(re => re.test(text));
        if (!mentionsSelf) {
          if (QUESTION_ABOUT_OTHER_RE.test(text)) {
            log.debug({ text }, 'Comment mentions another bot but is a question — allowing');
          } else {
            log.debug({ text }, 'Comment names another bot — rejecting');
            return 'directed_at_other';
          }
        }
      }
    }

    // 2. UtteranceTargetFilter-based check for Hindi/mixed text
    if (cfg.botNames && cfg.botNames.length > 0) {
      const { target } = classifyTarget(text, cfg.botNames);
      if (target === 'other_person') {
        if (QUESTION_ABOUT_OTHER_RE.test(text)) {
          log.debug({ text }, 'Comment target is other_person but is a question — allowing');
        } else {
          return 'directed_at_other';
        }
      }
    }

    for (const kw of cfg.triggerKeywords) {
      if (text.includes(kw)) return null;
    }

    if (text.length < cfg.minLength) {
      return 'too_short';
    }

    if (text.length > cfg.maxLength) {
      return 'too_long';
    }

    if (EMOJI_ONLY_RE.test(text)) {
      return 'emoji_only';
    }

    if (BOT_USERNAME_RE.test(username)) {
      return 'bot_username';
    }

    if (isRateLimited(userId, cfg.rateLimitWindowMs, cfg.rateLimitMaxMessages)) {
      return 'rate_limited';
    }

    if (cfg.replyProbability < 1.0 && Math.random() > cfg.replyProbability) {
      return 'probability_skip';
    }

    return null;
  }

  function onCommentReceived(comment) {
    const rejectionReason = evaluate(comment);

    if (rejectionReason) {
      log.debug(
        { roomId: comment.roomId, userId: comment.userId, reason: rejectionReason },
        'Comment rejected'
      );

      bus.emit(Events.COMMENT_REJECTED, {
        ...comment,
        reason: rejectionReason,
      });
      return;
    }

    log.debug(
      { roomId: comment.roomId, userId: comment.userId, textLen: comment.text.length },
      'Comment accepted'
    );

    bus.emit(Events.COMMENT_ACCEPTED, comment);
  }

  bus.on(Events.COMMENT_RECEIVED, onCommentReceived);
  log.debug('CommentFilter registered');

  return {

    destroy() {
      bus.off(Events.COMMENT_RECEIVED, onCommentReceived);
      rateLimitMap.clear();
      log.debug('CommentFilter destroyed');
    },

    updateConfig(patch) {
      Object.assign(cfg, patch);
      if (patch.blockedUserIds) {
        blockedSet.clear();
        for (const id of patch.blockedUserIds) blockedSet.add(String(id).toLowerCase());
      }
      log.info({ patch }, 'CommentFilter config updated');
    },
  };
}
