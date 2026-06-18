import logger from '../utils/logger.js';

const log = logger.child({ module: 'ResponseParser' });

const MAX_REPLY_CHARS = 300;

const STRIP_PREFIXES = [

  /^[A-Za-z0-9_ -]{1,32}:\s+/,

  /^\*[^*]+\*\s*/,

  /^\[[^\]]+\]\s*/,
];

const STRIP_MARKDOWN_RE = /(\*\*|__|\*|_|`{1,3}|~~)/g;

function extractContent(completion) {
  if (!completion || typeof completion !== 'object') return null;

  const choice = completion?.choices?.[0];
  if (!choice) return null;

  if (choice.finish_reason === 'content_filter') {
    log.warn('LLM response blocked by content filter');
    return '';
  }

  const content = choice?.message?.content;
  if (typeof content !== 'string') return null;

  return content;
}

function cleanText(text) {
  let t = text;

  for (const re of STRIP_PREFIXES) {
    t = t.replace(re, '');
  }

  t = t.replace(STRIP_MARKDOWN_RE, '');

  t = t.replace(/\s+/g, ' ').trim();

  if (t.endsWith('.')) {
    t = t.slice(0, -1).trim();
  }

  return t;
}

function enforceMaxLength(text) {
  if (text.length <= MAX_REPLY_CHARS) return text;

  const truncated = text.slice(0, MAX_REPLY_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');

  const result = lastSpace > MAX_REPLY_CHARS * 0.8
    ? truncated.slice(0, lastSpace)
    : truncated;

  log.warn(
    { originalLen: text.length, truncatedLen: result.length },
    'Reply truncated to max length'
  );

  return result;
}

export function createResponseParser(config = {}) {
  const maxReplyChars = config.maxReplyChars ?? MAX_REPLY_CHARS;

  function parse(completion, meta = {}) {
    const rawContent = extractContent(completion);

    if (rawContent === null) {
      log.error({ meta, completion }, 'Failed to extract content from completion');
      return {
        text:        '',
        shouldReply: false,
        usage:       completion?.usage ?? null,
        raw:         completion,
      };
    }

    let text = cleanText(rawContent);

    const SILENT_RE = /^\s*[\(\[\*]?\s*(silent|remains? silent|stays? silent|no reply|ignore)\s*[\)\]\*]?\s*$/i;
    if (SILENT_RE.test(text)) {
      text = '';
    }

    if (text.length > maxReplyChars) {
      const truncated = text.slice(0, maxReplyChars);
      const lastSpace = truncated.lastIndexOf(' ');
      text = lastSpace > maxReplyChars * 0.8
        ? truncated.slice(0, lastSpace)
        : truncated;
      log.warn({ ...meta, originalLen: rawContent.length, truncatedLen: text.length }, 'Reply truncated');
    }

    const shouldReply = text.length > 0;

    if (!shouldReply) {
      log.debug({ meta }, 'LLM returned empty reply — bot will stay silent');
    } else {
      log.debug({ ...meta, replyLen: text.length }, 'Reply parsed successfully');
    }

    return {
      text,
      shouldReply,
      usage: completion?.usage ?? null,
      raw:   completion,
    };
  }

  return { parse };
}
