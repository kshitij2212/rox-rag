import bus, { Events } from '../core/EventBus.js';
import logger          from '../utils/logger.js';
import { classifyTarget } from './UtteranceTargetFilter.js';

const log = logger.child({ module: 'TranscriptProcessor' });

export function createTranscriptProcessor(config) {
  const { context, behavior, gateCheck, roomRef, botIdentity, botDisplayName, blockedUserIds } = config;

  if (!context)      throw new Error('TranscriptProcessor: context is required');
  if (!behavior)     throw new Error('TranscriptProcessor: behavior is required');
  if (!botIdentity)  throw new Error('TranscriptProcessor: botIdentity is required');

  async function onTranscriptReady({ roomId, text, speakerId }) {
    if (!text?.trim()) return;

    if (blockedUserIds && (blockedUserIds.includes(String(speakerId).toLowerCase()) || blockedUserIds.includes(speakerId))) {
      log.debug({ speakerId, text }, 'Transcript from blocked bot ignored');
      return;
    }

    const cleanText = text.trim();
    const normalizedText = cleanText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?…\s।]+$/, '').trim();

    const blacklist = /^(thank\s*you|bye|yeah|yes|ok|okay|yep|yup|nope|uh|um|uhh|umm|hmm|hm|mhm|erm|err|aa|ah|ahh|oh|ohh|eh|ee|oo|ooh|आँ|आं|हाँ|हां|हम्म|अह|ओ|ए|हे|अरे|अर्रे|जो|जाँ|प्रेवाँ|ह|हम|प्रफ़|प्रफ|झाल|याल|प्ष्ट|प्रुट|प्लीज|थैंक्यू|बाय|हम्म|मम|अं|अँ)$/i;

    const noiseWords = new Set([
      'झाल', 'याल', 'प्ष्ट', 'प्रुट', 'प्रफ़', 'प्रफ', 'प्रेवाँ', 'जाँ', 'ज़ाल',
      'मं', 'अं', 'अँ', 'हम्म', 'हं', 'ू', '्', 'थैंक', 'थैंक्यू', 'थैंक्स', 'प्शट'
    ]);

    const wordsList = cleanText.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z\u0900-\u097F]/g, '')).filter(Boolean);
    const isAllNoise = wordsList.length > 0 && wordsList.every(w => {
      return noiseWords.has(w) || blacklist.test(w) || w.length <= 2;
    });

    const isZhaal = /^[झाल\s,;.!?-]+$/.test(cleanText) || cleanText.includes("कि अग्षिएट") || cleanText.includes("कि अगषिएट");

    const words = cleanText.toLowerCase().split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words);
    const isRepeatingNoise = uniqueWords.size === 1 && words.length > 1;

    if (isAllNoise || isZhaal || isRepeatingNoise || normalizedText.length <= 2) {
      log.debug({ roomId, text: cleanText, normalizedText }, 'Ignored short/filler/blacklisted transcript (likely noise/mumble)');
      return;
    }

    log.debug({ roomId, speakerId, text }, '📝 Transcript received and storing in context');
    
    // Store in database context regardless of whether we reply
    try {
      await context.addTranscript(roomId, text, speakerId);
    } catch (err) {
      log.error({ err, roomId }, 'Error saving transcript to context');
    }

    // Filter out if not addressed to the bot
    const targetResult = classifyTarget(text, [botIdentity, botDisplayName]);
    if (targetResult.shouldProcess === false) {
      log.info({ text, target: targetResult.target }, 'Transcript filtered out — addressing someone else / ambient');
      return;
    }

    const botName = botIdentity.split('-')[0].toLowerCase();
    if (gateCheck) {
      const gateResult = await gateCheck.check(text);
      if (gateResult.directed !== botName && 
          gateResult.directed !== 'chat' && 
          !gateResult.directed.includes(botName) && 
          !botName.includes(gateResult.directed)) {
        log.info({ text, directed: gateResult.directed, botName }, 'Transcript ignored — not directed to the bot');
        return;
      }
    }

    try {
      let resolvedUsername = speakerId;
      if (roomRef?.room) {
        const participant = roomRef.room.remoteParticipants?.get(speakerId) || roomRef.room.localParticipant;
        if (participant?.name) {
          resolvedUsername = participant.name;
        }
      }

      const decision = await behavior.evaluate({ roomId, type: 'transcript', text });
      if (!decision.shouldReply) return;
      bus.emit(Events.BEHAVIOR_APPROVED, {
        roomId,
        trigger:     text,
        triggerType: 'transcript',
        username:    resolvedUsername,
        userId:      speakerId,
        delayMs:     decision.delayMs,
      });
    } catch (err) {
      log.error({ err, roomId }, 'Error in transcript handler');
    }
  }

  function init() {
    bus.on(Events.TRANSCRIPT_READY, onTranscriptReady);
    log.info('TranscriptProcessor initialised');
  }

  function destroy() {
    bus.off(Events.TRANSCRIPT_READY, onTranscriptReady);
    log.debug('TranscriptProcessor destroyed');
  }

  return { init, destroy };
}
