import { sanitise }                 from './PromptInjectionGuard.js';
import logger                       from '../utils/logger.js';

const log = logger.child({ module: 'ModerationService' });

export class ModerationService {

  constructor() {}

  async check(text) {
    if (!text?.trim()) {
      return { safe: true, reason: null };
    }

    const sanitised = sanitise(text);
    if (!sanitised) {
      log.warn({ text }, 'Reply fully stripped by PromptInjectionGuard — dropping');
      return { safe: false, reason: 'prompt_injection' };
    }

    return { safe: true, reason: null };
  }
}

export function createModerationService(config) {
  return new ModerationService(config);
}