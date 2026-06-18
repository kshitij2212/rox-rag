import { jest } from '@jest/globals';
import { Persona } from '../../src/memory/models/Persona.js';
import { BotDefinition } from '../../src/memory/models/BotDefinition.js';
import { createMongoPersonaService } from '../../src/memory/MongoPersonaService.js';

describe('MongoPersonaService', () => {
  let service;

  beforeEach(() => {
    service = createMongoPersonaService();
    jest.clearAllMocks();
  });

  describe('getPersona', () => {
    test('successfully fetches a persona by botId', async () => {
      const mockPersona = { botId: 'aman-bot', name: 'Aman' };
      const findOneSpy = jest.spyOn(Persona, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockPersona)
      });

      const result = await service.getPersona('aman-bot');
      expect(result).toEqual(mockPersona);
      expect(findOneSpy).toHaveBeenCalledWith({ botId: 'aman-bot' });
    });

    test('returns null and logs when an error occurs during findOne', async () => {
      jest.spyOn(Persona, 'findOne').mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      const result = await service.getPersona('aman-bot');
      expect(result).toBeNull();
    });
  });

  describe('savePersona', () => {
    test('successfully upserts a persona', async () => {
      const updateOneSpy = jest.spyOn(Persona, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
      const personaPayload = { botId: 'aman-bot', name: 'Aman' };

      const result = await service.savePersona(personaPayload);
      expect(result).toEqual({ modifiedCount: 1 });
      expect(updateOneSpy).toHaveBeenCalledWith(
        { botId: 'aman-bot' },
        expect.objectContaining({
          $set: expect.objectContaining({
            botId: 'aman-bot',
            name: 'Aman',
            updatedAt: expect.any(Date)
          })
        }),
        { upsert: true }
      );
    });

    test('throws error if persona payload is invalid', async () => {
      await expect(service.savePersona(null)).rejects.toThrow('invalid persona payload');
      await expect(service.savePersona({})).rejects.toThrow('invalid persona payload');
    });

    test('throws error if database save fails', async () => {
      jest.spyOn(Persona, 'updateOne').mockRejectedValue(new Error('Save Error'));
      const personaPayload = { botId: 'aman-bot' };

      await expect(service.savePersona(personaPayload)).rejects.toThrow('Save Error');
    });
  });

  describe('getBotDefinitions', () => {
    test('successfully fetches all bot definitions', async () => {
      const mockDefinitions = [{ key: 'aman' }, { key: 'shivam' }];
      const findSpy = jest.spyOn(BotDefinition, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockDefinitions)
      });

      const result = await service.getBotDefinitions();
      expect(result).toEqual(mockDefinitions);
      expect(findSpy).toHaveBeenCalledWith({});
    });

    test('returns empty array if db find fails', async () => {
      jest.spyOn(BotDefinition, 'find').mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('Find Error'))
      });

      const result = await service.getBotDefinitions();
      expect(result).toEqual([]);
    });
  });

  describe('saveBotDefinition', () => {
    test('successfully upserts a bot definition', async () => {
      const updateOneSpy = jest.spyOn(BotDefinition, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
      const defPayload = { key: 'aman', envId: 'SOCKET_USER_ID_AMAN' };

      const result = await service.saveBotDefinition(defPayload);
      expect(result).toEqual({ modifiedCount: 1 });
      expect(updateOneSpy).toHaveBeenCalledWith(
        { key: 'aman' },
        expect.objectContaining({
          $set: expect.objectContaining({
            key: 'aman',
            envId: 'SOCKET_USER_ID_AMAN',
            updatedAt: expect.any(Date)
          })
        }),
        { upsert: true }
      );
    });

    test('throws error if botDef payload is invalid', async () => {
      await expect(service.saveBotDefinition(null)).rejects.toThrow('invalid botDef payload');
      await expect(service.saveBotDefinition({})).rejects.toThrow('invalid botDef payload');
    });

    test('throws error if database save fails', async () => {
      jest.spyOn(BotDefinition, 'updateOne').mockRejectedValue(new Error('Save Error'));
      const defPayload = { key: 'aman' };

      await expect(service.saveBotDefinition(defPayload)).rejects.toThrow('Save Error');
    });
  });
});
