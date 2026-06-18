import { jest } from '@jest/globals';
import { createOpenAIAdapter } from '../../src/ai/OpenAIAdapter.js';

describe('OpenAIAdapter', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('successfully maps messages and sends requests to OpenAI completions endpoint', async () => {
    const adapter = createOpenAIAdapter({
      apiKey: 'sk-proj-testkey',
      model: 'gpt-4o-mini',
    });

    const expectedResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello from OpenAI!'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      }
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => expectedResponse
    });

    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' }
    ];

    const result = await adapter.complete(messages);

    expect(result.choices[0].message.content).toBe('Hello from OpenAI!');
    expect(result.usage.total_tokens).toBe(25);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual(messages);
    expect(options.headers['Authorization']).toBe('Bearer sk-proj-testkey');
  });

  test('throws error if API key is missing', () => {
    expect(() => createOpenAIAdapter({ model: 'gpt-4o-mini' })).toThrow('OpenAIAdapter: apiKey is required');
  });
});
