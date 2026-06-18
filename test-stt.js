import './src/utils/patchLiveKit.js';
import { createSTTService } from './src/stt/STTService.js';
import bus, { Events } from './src/core/EventBus.js';
import { config } from 'dotenv';
config();

const stt = createSTTService({ groqApiKey: process.env.WHISPER_API_KEY });
stt.init();

console.log("Emitting UTTERANCE_READY...");
bus.emit(Events.UTTERANCE_READY, {
  roomId: 'test',
  speakerId: 'user1',
  samples: new Int16Array(16000),
  sampleRate: 16000,
  durationMs: 1000
});
console.log("Emitted.");
