import bus, { Events } from '../../src/core/EventBus.js';
import { jest } from '@jest/globals';
import { createReplyPublisher } from '../../src/realtime/ReplyPublisher.js';

const mockLocalParticipant = {
  sendChatMessage: jest.fn().mockResolvedValue(undefined),
  publishData: jest.fn().mockResolvedValue(undefined),
};
const roomRef = { room: mockLocalParticipant };

describe('ReplyPublisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sends reply via chat API by default', async () => {
    const publisher = createReplyPublisher({
      roomRef,
      botIdentity: 'bot1',
    });
    console.log('listeners after:', bus.listenerCount(Events.REPLY_SEND));
    const payload = {
      roomId: 'room1',
      trigger: { userId: 'user1', username: 'User' },
      text: 'Hello world',
    };
    bus.emit(Events.REPLY_SEND, payload);

    await new Promise(process.nextTick);
    expect(mockLocalParticipant.sendChatMessage).toHaveBeenCalledWith('Hello world');
    expect(publisher.getStats().sent).toBe(1);
    publisher.destroy();
  });

  test('sends via data channel when configured', async () => {
    const publisher = createReplyPublisher({
      roomRef,
      botIdentity: 'bot1',
      sendMode: 'data_channel',
    });
    const payload = {
      roomId: 'room2',
      trigger: { userId: 'user2', username: 'User2' },
      text: 'Data channel message',
    };
    bus.emit(Events.REPLY_SEND, payload);
    await new Promise(process.nextTick);
    expect(mockLocalParticipant.publishData).toHaveBeenCalled();
    expect(publisher.getStats().sent).toBe(1);
    publisher.destroy();
  });
});
