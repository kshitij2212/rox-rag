import { jest } from '@jest/globals';
import { createMongoConversationService } from '../../src/memory/MongoConversationService.js';

describe('MongoConversationService', () => {
  let mockCollection;
  let mockDb;
  let mockClient;
  let service;
  let collections;

  beforeEach(() => {
    collections = {};
    const getCollection = (name) => {
      if (!collections[name]) {
        if (name === 'bot_definitions') {
          collections[name] = {
            find: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([])
            })
          };
          return collections[name];
        }

        collections[name] = {
          insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
          createIndex: jest.fn().mockResolvedValue('index-created')
        };
      }
      return collections[name];
    };

    mockDb = {
      collection: jest.fn((name) => getCollection(name))
    };
    mockClient = {
      db: jest.fn().mockReturnValue(mockDb)
    };
    service = createMongoConversationService(mockClient);
  });

  test('saves QA documents with correct format', async () => {
    const payload = {
      botId: 'aman-bot',
      roomId: 'room123',
      question: 'How are you?',
      questionUser: 'host123',
      answer: 'I am doing well.'
    };

    const result = await service.saveQA(payload);
    expect(result.insertedId).toBe('mock-id');
  expect(mockDb.collection).toHaveBeenCalledWith('conversationsqueue/aman');
  expect(collections['conversationsqueue/aman'].insertOne).toHaveBeenCalledTimes(1);

  const calledDoc = collections['conversationsqueue/aman'].insertOne.mock.calls[0][0];
    expect(calledDoc.botId).toBe('aman-bot');
    expect(calledDoc.roomId).toBe('room123');
    expect(calledDoc.question).toBe('How are you?');
    expect(calledDoc.questionUser).toBe('host123');
    expect(calledDoc.answer).toBe('I am doing well.');
    expect(calledDoc.timestamp).toBeInstanceOf(Date);
  });

  test('handles missing properties gracefully by using defaults', async () => {
    const payload = {
      botId: 'aman',
      roomId: 'room123'
    };

    await service.saveQA(payload);
    const calledDoc = collections['conversationsqueue/aman'].insertOne.mock.calls[0][0];
    expect(calledDoc.botId).toBe('aman');
    expect(calledDoc.question).toBe('');
    expect(calledDoc.questionUser).toBe('unknown');
    expect(calledDoc.answer).toBe('');
  });

  test('ensures required bot collections on initialization', () => {
    expect(mockDb.collection).toHaveBeenCalledWith('conversationsqueue/aman');
    expect(mockDb.collection).toHaveBeenCalledWith('reject_queue/aman');
    expect(mockDb.collection).toHaveBeenCalledWith('conversationsqueue/divya');
    expect(mockDb.collection).toHaveBeenCalledWith('reject_queue/divya');
  });
});
