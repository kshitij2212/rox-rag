import { createCommentListener } from '../../src/comments/CommentListener.js';
import bus, { Events } from '../../src/core/EventBus.js';

describe('CommentListener', () => {
  test('receives and processes comments', async () => {
    const listener = createCommentListener({ ignoredUserIds: [] });

    bus.emit(Events.COMMENT_RECEIVED, {
      roomId: 'room1',
      userId: 'user1',
      username: 'Alice',
      text: 'Hello',
      source: 'chat_message',
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const stats = listener.getStats();
    expect(stats.received).toBe(1);
    expect(stats.forwarded).toBe(1);

    listener.destroy();
  });
});
