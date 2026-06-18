import './src/utils/patchLiveKit.js';
import { Room, RoomEvent } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import 'dotenv/config';

async function run() {
  console.log('Connecting to URL:', process.env.LIVEKIT_URL);
  console.log('Room:', process.env.LIVEKIT_ROOM);

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'status-bot' });
  at.addGrant({ roomJoin: true, room: process.env.LIVEKIT_ROOM, canSubscribe: true });
  const token = await at.toJwt();

  const room = new Room();

  room.on(RoomEvent.Connected, () => console.log('Event: Connected to room'));
  room.on(RoomEvent.Disconnected, (reason) => console.log('Event: Disconnected. Reason:', reason));
  room.on(RoomEvent.ParticipantConnected, (p) => console.log(`Event: Participant connected: ${p.identity}`));
  room.on(RoomEvent.ParticipantDisconnected, (p) => console.log(`Event: Participant disconnected: ${p.identity}`));

  room.on(RoomEvent.TrackPublished, (pub, p) => {
    console.log(`Event: Track published by ${p.identity} - SID: ${pub.sid}, Kind: ${pub.kind}`);
  });
  room.on(RoomEvent.TrackUnpublished, (pub, p) => {
    console.log(`Event: Track unpublished by ${p.identity} - SID: ${pub.sid}`);
  });
  room.on(RoomEvent.TrackSubscribed, (track, pub, p) => {
    console.log(`Event: Track subscribed successfully! Participant: ${p.identity}, SID: ${pub.sid}, Kind: ${track.kind}`);
  });
  room.on(RoomEvent.TrackSubscriptionFailed, (sid, p, err) => {
    console.log(`Event: Track subscription FAILED! Participant: ${p.identity}, SID: ${sid}, Error:`, err);
  });
  room.on(RoomEvent.TrackMuted, (pub, p) => {
    console.log(`Event: Track muted by ${p.identity} - SID: ${pub.sid}`);
  });
  room.on(RoomEvent.TrackUnmuted, (pub, p) => {
    console.log(`Event: Track unmuted by ${p.identity} - SID: ${pub.sid}`);
  });

  await room.connect(process.env.LIVEKIT_URL, token, { autoSubscribe: true });
  console.log('Connect method resolved.');

  setInterval(() => {
    console.log('\n--- ROOM STATUS ---');
    console.log(`Connection State: ${room.connectionState}`);
    console.log(`Active Remote Participants count: ${room.remoteParticipants.size}`);

    for (const [sid, p] of room.remoteParticipants) {
      console.log(`Participant: ${p.identity}`);
      console.log(`  Publications count: ${p.trackPublications.size}`);
      for (const [trackSid, pub] of p.trackPublications) {
        console.log(`    Track SID: ${trackSid}`);
        console.log(`      Kind: ${pub.kind}`);
        console.log(`      Is Subscribed: ${pub.track !== undefined}`);
        console.log(`      Is Muted: ${pub.isMuted}`);
      }
    }
    console.log('-------------------\n');
  }, 3000);
}

run().catch(console.error);
