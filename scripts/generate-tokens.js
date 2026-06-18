import { AccessToken } from 'livekit-server-sdk';
import 'dotenv/config';

const LIVEKIT_URL    = process.env.LIVEKIT_URL;
const API_KEY        = process.env.LIVEKIT_API_KEY;
const API_SECRET     = process.env.LIVEKIT_API_SECRET;
const ROOM_NAME      = process.argv[2] || process.env.LIVEKIT_ROOM || 'audio-test-room';

if (!API_KEY || !API_SECRET || !LIVEKIT_URL) {
  console.error('Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in .env');
  process.exit(1);
}

async function generateToken(identity, name) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name,
    ttl: '6h',
  });

  at.addGrant({
    room:            ROOM_NAME,
    roomJoin:        true,
    canPublish:      true,
    canSubscribe:    true,
    canPublishData:  true,
  });

  return await at.toJwt();
}

const tokenA = await generateToken('device-a', 'Device A');
const tokenB = await generateToken('device-b', 'Device B');

const wsUrl = LIVEKIT_URL.replace('wss://', '').replace('ws://', '');

console.log('\n═══════════════════════════════════════════════');
console.log('  LiveKit Token Generator');
console.log('═══════════════════════════════════════════════');
console.log(`  Room:       ${ROOM_NAME}`);
console.log(`  Server:     ${LIVEKIT_URL}`);
console.log('═══════════════════════════════════════════════\n');

console.log('📱 DEVICE A:');
console.log(`   Token: ${tokenA}\n`);

console.log('📱 DEVICE B:');
console.log(`   Token: ${tokenB}\n`);

console.log('═══════════════════════════════════════════════');
console.log('  Open these URLs to test:');
console.log('═══════════════════════════════════════════════');
console.log(`  Device A: https://meet.livekit.io/custom?liveKitUrl=${LIVEKIT_URL}&token=${tokenA}\n`);
console.log(`  Device B: https://meet.livekit.io/custom?liveKitUrl=${LIVEKIT_URL}&token=${tokenB}\n`);
console.log('═══════════════════════════════════════════════\n');
