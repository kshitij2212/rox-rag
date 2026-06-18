import './src/utils/patchLiveKit.js';
import { Room } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import 'dotenv/config';

async function run() {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'test-bot' });
  at.addGrant({ roomJoin: true, room: process.env.LIVEKIT_ROOM_NAME, canSubscribe: true });
  const token = await at.toJwt();

  const room = new Room();
  await room.connect(process.env.LIVEKIT_URL, token, { autoSubscribe: true });

  room.on('trackSubscribed', async (track, pub, participant) => {
    if (track.kind === 'audio') {
      console.log('Subscribed to audio track');
      const { AudioStream } = await import('@livekit/rtc-node');
      const stream = new AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 30 });
      const reader = stream.getReader();
      let frames = 0;
      setInterval(() => {
        const mu = process.memoryUsage();
        console.log(`Frames: ${frames}, Heap: ${Math.round(mu.heapUsed/1024/1024)}MB, Ext: ${Math.round(mu.external/1024/1024)}MB`);
      }, 1000);
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        frames++;
        await new Promise(r => setImmediate(r));
      }
    }
  });
  console.log('Connected. Waiting for audio...');
}
run();
