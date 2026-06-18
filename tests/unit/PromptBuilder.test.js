import { createPromptBuilder } from '../../src/ai/PromptBuilder.js';

describe('PromptBuilder', () => {
  const persona = {
    displayName: 'Aman Gupta',
    age: 23,
    location: 'Pune',
    language: 'Hinglish',
    backstory: 'A software developer',
    interests: ['cricket'],
    avoid: ['politics'],
    personality: {
      traits: ['friendly'],
      tone: 'casual',
      energy: 'medium',
      humor: 'light',
    },
    replyStyle: {
      maxSentences: 2,
      useEmojis: true,
      emojiFrequency: 'rare',
      usesFillerWords: true,
      exampleReplies: ['hello'],
    },
    otherViewers: ['Shivam'],
  };

  test('buildSystemPrompt includes dynamic roomLabel from roomContext roomName', () => {
    const builder = createPromptBuilder();
    const systemPrompt = builder.buildSystemPrompt(persona, { roomName: 'Fun Gaming Stream', roomId: '123' });
    expect(systemPrompt).toContain('watching "Fun Gaming Stream"');
  });

  test('buildSystemPrompt falls back to default string if roomName matches technical ID pattern', () => {
    const builder = createPromptBuilder();
    const systemPrompt1 = builder.buildSystemPrompt(persona, { roomName: 'room_12461_d', roomId: 'room_12461_d' });
    expect(systemPrompt1).toContain('watching "this live stream"');

    const systemPrompt2 = builder.buildSystemPrompt(persona, { roomName: 'live_d_12641', roomId: 'live_d_12641' });
    expect(systemPrompt2).toContain('watching "this live stream"');
  });

  test('buildSystemPrompt falls back to default string if roomContext is empty or missing', () => {
    const builder = createPromptBuilder();
    const systemPrompt = builder.buildSystemPrompt(persona);
    expect(systemPrompt).toContain('watching "this live stream"');
  });

  test('build formats complete message array with system, history, and current message', () => {
    const builder = createPromptBuilder();
    const payload = {
      persona,
      history: [
        { role: 'user', username: 'Bob', text: 'Hi bot' },
        { role: 'bot', text: 'Hello Bob' },
      ],
      trigger: { text: 'How are you?', username: 'Bob' },
      roomId: 'room-123',
      meta: { roomName: 'Awesome Stream' },
    };

    const messages = builder.build(payload);
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('watching "Awesome Stream"');
    expect(messages[1]).toEqual({ role: 'user', content: 'Bob: Hi bot' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Hello Bob' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Bob: How are you?' });
  });

  test('build tags broadcaster with (Streamer) in history and current message', () => {
    const builder = createPromptBuilder({ broadcasterId: '12641' });
    const payload = {
      persona,
      history: [
        { role: 'user', userId: '12641', username: 'Owner', text: 'Hello Abhishek' },
        { role: 'bot', text: 'Hey there' },
      ],
      trigger: { userId: '12641', username: 'Owner', text: 'How is the stream?' },
      roomId: 'room-123',
      meta: { roomName: 'Awesome Stream' },
    };

    const messages = builder.build(payload);
    expect(messages.length).toBe(4);
    expect(messages[1]).toEqual({ role: 'user', content: 'Owner (Streamer): Hello Abhishek' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Owner (Streamer): How is the stream?' });
    expect(messages[0].content).toContain('Do NOT welcome them to the stream');
  });

  test('buildSystemPrompt maps gender-aware addressing (female -> ma\'am)', () => {
    const builder = createPromptBuilder();
    const femalePersona = {
      ...persona,
      replyStyle: {
        ...persona.replyStyle,
        exampleReplies: ['kaise ho bhaiya', 'sahi hai bhaiya'],
      }
    };
    const systemPrompt = builder.buildSystemPrompt(femalePersona, { broadcasterGender: 'female' });
    expect(systemPrompt).toContain('kaise ho ma\'am');
    expect(systemPrompt).toContain('sahi hai ma\'am');
    expect(systemPrompt).toContain('ma\'am mujhe in sab chizon mein interest nahi hai');
  });

  test('build pre-processes and injects lyricsLine into trigger', () => {
    const builder = createPromptBuilder();
    const payload = {
      persona,
      history: [],
      trigger: { text: 'Gaao na...', username: 'User' },
      roomId: 'room-123',
      meta: { lyricsLine: 'Hoshwalon ko khabar kya...' },
    };

    const messages = builder.build(payload);
    expect(messages[messages.length - 1].content).toContain('(Lyrics context: Hoshwalon ko khabar kya...)');
  });
});
