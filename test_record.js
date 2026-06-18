import './src/utils/patchLiveKit.js';
import { Room, TrackKind } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { writeFileSync } from 'fs';
import { encodeWAV } from './src/audio/AudioUtils.js';
import 'dotenv/config';

async function run() {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'record-bot' });
  at.addGrant({ roomJoin: true, room: process.env.LIVEKIT_ROOM, canSubscribe: true });
  const token = await at.toJwt();

  const room = new Room();
  await room.connect(process.env.LIVEKIT_URL, token, { autoSubscribe: true });

  console.log('Connected to LiveKit room:', process.env.LIVEKIT_ROOM);
  console.log('Checking for audio tracks...');

  async function handleAudioTrack(track, participant) {
    console.log(`Recording audio track from participant: ${participant.identity}`);
    const { AudioStream } = await import('@livekit/rtc-node');
    const stream = new AudioStream(track, { sampleRate: 16000, numChannels: 1, frameSizeMs: 30 });
    const reader = stream.getReader();

    const chunks = [];
    let totalSamples = 0;
    console.log('Recording 3 seconds of audio (100 frames)... Speak now!');

    for (let i = 0; i < 100; i++) {
      const { value: frame, done } = await reader.read();
      if (done) break;

      chunks.push(new Int16Array(frame.data));
      totalSamples += frame.data.length;
    }

    console.log(`Finished recording. Total samples: ${totalSamples}`);

    const samples = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWAV(samples, 16000);
    const filename = `/tmp/test_direct_record_${Date.now()}.wav`;
    writeFileSync(filename, wavBuffer);
    console.log(`Saved direct recording to: ${filename}`);
    console.log('Please listen to this file and let me know if it is clear.');

    await room.disconnect();
    process.exit(0);
  }

  room.on('trackSubscribed', async (track, pub, participant) => {
    if (track.kind === TrackKind.KIND_AUDIO) {
      await handleAudioTrack(track, participant);
    }
  });

  for (const [, participant] of room.remoteParticipants) {
    for (const [, publication] of participant.trackPublications) {
      if (publication.track && publication.track.kind === TrackKind.KIND_AUDIO) {
        console.log(`Found pre-existing audio track from: ${participant.identity}`);
        await handleAudioTrack(publication.track, participant);
        return;
      }
    }
  }

  console.log('Waiting for someone to speak/publish a track...');
}

run().catch(console.error);
