import { createCommentFilter } from '../../src/comments/CommentFilter.js';
import bus, { Events } from '../../src/core/EventBus.js';

describe('CommentFilter', () => {
  let filter;
  const acceptedComments = [];
  const rejectedComments = [];

  beforeEach(() => {
    acceptedComments.length = 0;
    rejectedComments.length = 0;

    bus.on(Events.COMMENT_ACCEPTED, (c) => acceptedComments.push(c));
    bus.on(Events.COMMENT_REJECTED, (c) => rejectedComments.push(c));

    filter = createCommentFilter({
      minLength: 3,
      maxLength: 500,
      otherBotNames: ['Shivam', 'Abhishek'],
      botNames: ['Aman'],
      blocklistPhrases: ['matlab ?'],
    });
  });

  afterEach(() => {
    filter.destroy();
    bus.removeAllListeners(Events.COMMENT_ACCEPTED);
    bus.removeAllListeners(Events.COMMENT_REJECTED);
  });

  test('rejects comments mentioning another bot without asking a question', async () => {
    bus.emit(Events.COMMENT_RECEIVED, {
      roomId: 'room1',
      userId: 'user1',
      username: 'Alice',
      text: 'hello Shivam how are you',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(rejectedComments.length).toBe(1);
    expect(rejectedComments[0].reason).toBe('directed_at_other');
    expect(acceptedComments.length).toBe(0);
  });

  test('allows comments mentioning another bot if it is a question about them', async () => {
    bus.emit(Events.COMMENT_RECEIVED, {
      roomId: 'room1',
      userId: 'user1',
      username: 'Alice',
      text: 'Shivam ko jaante ho?',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(acceptedComments.length).toBe(1);
    expect(rejectedComments.length).toBe(0);
  });

  test('rejects comments containing blocklisted phrases', async () => {
    bus.emit(Events.COMMENT_RECEIVED, {
      roomId: 'room1',
      userId: 'user1',
      username: 'Alice',
      text: 'What does this matlab ?',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(rejectedComments.length).toBe(1);
    expect(rejectedComments[0].reason).toBe('blocklist_phrase');
    expect(acceptedComments.length).toBe(0);
  });
});
