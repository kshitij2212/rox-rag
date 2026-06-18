import logger from '../utils/logger.js';

const log = logger.child({ module: 'promptInjectionGuard' });

const PATTERNS = [

  {
    label:       'ignore_instructions',
    re:          /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
    replacement: '[…]',
  },
  {
    label:       'new_instructions',
    re:          /\b(your\s+new\s+instructions?|from\s+now\s+on|henceforth)\b/gi,
    replacement: '[…]',
  },

  {
    label:       'jailbreak_persona',
    re:          /\b(you\s+are\s+now|act\s+as|pretend\s+(you\s+are|to\s+be)|roleplay\s+as|DAN|jailbreak)\b/gi,
    replacement: '[…]',
  },

  {
    label:       'delimiters',
    re:          /(\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|###\s*(SYSTEM|USER|ASSISTANT)|<<SYS>>|<\/SYS>>)/gi,
    replacement: '',
  },

  {
    label:       'control_chars',
    re:          /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    replacement: '',
  },
];

const MAX_INPUT_CHARS = 1_000;

export function sanitise(text, meta = {}) {
  if (!text || typeof text !== 'string') return '';

  try {
    let result = text;

    if (result.length > MAX_INPUT_CHARS) {
      log.warn({ ...meta, originalLen: result.length }, 'Input exceeds max length — truncating');
      result = result.slice(0, MAX_INPUT_CHARS);
    }

    for (const { re, replacement, label } of PATTERNS) {
      const before = result;
      result = result.replace(re, replacement);
      if (result !== before) {
        log.warn({ ...meta, pattern: label }, 'Prompt injection pattern detected and stripped');
      }
    }

    return result.trim();

  } catch (err) {

    log.error({ ...meta, err }, 'promptInjectionGuard threw unexpectedly — returning original');
    return text;
  }
}
