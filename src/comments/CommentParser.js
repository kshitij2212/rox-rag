import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';

const log = logger.child({ module: 'CommentParser' });

function parsePayload(raw) {
  const trimmed = raw.trim();

  if (!trimmed.startsWith('{')) {

    return { text: trimmed };
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      log.warn({ raw: trimmed }, 'Parsed JSON is not an object — dropping');
      return null;
    }

    return parsed;
  } catch {
    log.warn({ raw: trimmed }, 'Failed to JSON-parse data channel payload — dropping');
    return null;
  }
}

function normaliseTimestamp(raw) {
  if (raw == null) return new Date().toISOString();

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d   = new Date(ms);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  if (typeof raw === 'string') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  return new Date().toISOString();
}

function sanitiseText(text) {
  return text
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function onCommentRaw({ rawPayload, participantId, roomId, source }) {

  const parsed = parsePayload(rawPayload);
  if (!parsed) return;

  const rawText = typeof parsed.text === 'string' ? parsed.text : '';
  const text    = sanitiseText(rawText);

  if (!text) {
    log.debug({ roomId, participantId }, 'Empty text after sanitisation — dropping');
    return;
  }

  const userId   = (typeof parsed.userId   === 'string' && parsed.userId.trim())
    ? parsed.userId.trim()
    : participantId ?? 'unknown';

  const username = (typeof parsed.username === 'string' && parsed.username.trim())
    ? parsed.username.trim()
    : userId;

  const ts = normaliseTimestamp(parsed.ts);

  const event = {
    roomId,
    userId,
    username,
    text,
    ts,
    source: 'data_channel',
  };

  log.debug({ roomId, userId, username, textLen: text.length }, 'Comment parsed');
  bus.emit(Events.COMMENT_RECEIVED, event);
}

bus.on(Events.COMMENT_RAW, onCommentRaw);

log.debug('CommentParser registered');
