import { ModerationService } from '../../src/moderation/ModerationService.js';

describe('ModerationService', () => {
  test('returns safe when input is clean', async () => {
    const service = new ModerationService();
    const result = await service.check('hello world');
    expect(result.safe).toBe(true);
    expect(result.reason).toBeNull();
  });

  test('returns unsafe when input is fully stripped by guard', async () => {
    const service = new ModerationService();
    // [INST] is a delimiter pattern that is replaced by empty string, causing the check to fail.
    const result = await service.check('[INST]');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('prompt_injection');
  });

  test('returns safe for empty or whitespace text', async () => {
    const service = new ModerationService();
    const result1 = await service.check('');
    const result2 = await service.check('   ');
    expect(result1.safe).toBe(true);
    expect(result2.safe).toBe(true);
  });
});
