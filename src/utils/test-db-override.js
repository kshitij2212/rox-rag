import db from './database.js';

async function main() {
  const broadcasterId = 12641;
  const mockLiveId = 99999;
  const mockChannelName = "live_d_12641_test_override";
  try {
    console.log("Inserting mock live row...");
    // Let's insert a row into userlive
    await db.query(
      `INSERT INTO userlive (id, userId, channelName, status, created, hostType, position, categoryId, stage_name, token, rtmToken) 
       VALUES (?, ?, ?, 'live', NOW(), 1, 11, 7, 'TestBot', 'token', 'rtmToken')`,
      [mockLiveId, broadcasterId, mockChannelName]
    );
    console.log("Mock row inserted. Run BotRunner now!");
  } catch (err) {
    console.error("Error inserting mock row:", err);
  } finally {
    process.exit(0);
  }
}

main();
