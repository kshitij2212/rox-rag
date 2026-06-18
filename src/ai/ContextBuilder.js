import bus, { Events }        from '../core/EventBus.js';
import logger                  from '../utils/logger.js';

const log = logger.child({ module: 'ContextBuilder' });

export function createContextBuilder({ contextMemory, personaMemory, promptBuilder, roomRef, botId }) {
  if (!contextMemory) throw new Error('ContextBuilder: contextMemory is required');
  if (!personaMemory) throw new Error('ContextBuilder: personaMemory is required');
  if (!promptBuilder) throw new Error('ContextBuilder: promptBuilder is required');
  if (!botId)         throw new Error('ContextBuilder: botId is required');

  function interleaveHistory({ transcripts = [], comments = [], botReplies = [] }) {
    const merged = [];

    for (const t of transcripts) {
      if (t) {
        let username = t.speakerId;
        if (roomRef?.room) {
          const participant = roomRef.room.remoteParticipants?.get(t.speakerId) || roomRef.room.localParticipant;
          if (participant?.name) {
            username = participant.name;
          }
        }
        merged.push({ role: 'user', userId: t.speakerId, username, text: t.text, ts: t.ts });
      }
    }

    for (const c of comments) {
      if (c) merged.push({ role: 'user', userId: c.userId, username: c.username, text: c.text, ts: c.ts });
    }

    for (const b of botReplies) {
      if (b) merged.push({ role: 'bot', text: b.text, ts: b.ts });
    }

    merged.sort((a, b) => a.ts - b.ts);
    return merged;
  }

  async function onTrigger(triggerEvent) {
    const { roomId } = triggerEvent;

    const normalisedTrigger = normaliseTrigger(triggerEvent);
    if (!normalisedTrigger) return;

    log.debug(
      { roomId, userId: normalisedTrigger.userId, source: normalisedTrigger.source },
      'Building context'
    );

    let rawContext, persona;
    try {
      [rawContext, persona] = await Promise.all([
        contextMemory.getAll(roomId),
        personaMemory.getPersona(botId),
      ]);
    } catch (err) {
      log.error({ roomId, err }, 'Failed to fetch context or persona — aborting');
      bus.emit(Events.CONTEXT_BUILD_FAILED, { roomId, trigger: normalisedTrigger, err: String(err) });
      return;
    }

    const broadcasterId = rawContext.meta?.broadcasterId;
    let broadcasterFacts = null;
    if (broadcasterId) {
      try {
        broadcasterFacts = await contextMemory.getBroadcasterFacts(broadcasterId);
      } catch (err) {
        log.warn({ err, broadcasterId }, 'Failed to fetch broadcaster facts from Redis');
      }
    }

    const history = interleaveHistory(rawContext);

    const contextPayload = {
      roomId,
      trigger:    normalisedTrigger,
      history,
      persona,
      meta:       rawContext.meta,
      broadcasterFacts,
      greetingCount: rawContext.greetingCount || 0,
      builtAt:    new Date().toISOString(),
    };

    let promptMessages;
    try {
      promptMessages = promptBuilder.build(contextPayload);
    } catch (err) {
      log.error({ roomId, err }, 'PromptBuilder threw — aborting');
      bus.emit(Events.CONTEXT_BUILD_FAILED, { roomId, trigger: normalisedTrigger, err: String(err) });
      return;
    }

    bus.emit(Events.CONTEXT_READY, {
      roomId,
      trigger:        normalisedTrigger,
      promptMessages,
      contextPayload,
    });

    log.debug(
      { roomId, messageCount: promptMessages.length },
      'Context ready — emitted CONTEXT_READY'
    );
  }

  function normaliseTrigger(event) {
    const { trigger, triggerType, username, userId, delayMs } = event;
    if (!trigger?.trim()) {
      log.warn({ event }, 'Trigger has empty text — dropping');
      return null;
    }

    return {
      userId:   userId ?? username ?? 'unknown',
      username: username ?? userId ?? 'unknown',
      text:     trigger.trim(),
      ts:       new Date().toISOString(),
      source:   triggerType,
      delayMs:  delayMs || 0,
    };
  }

  bus.on(Events.BEHAVIOR_APPROVED, onTrigger);

  log.debug('ContextBuilder registered');

  return {

    destroy() {
      bus.off(Events.BEHAVIOR_APPROVED, onTrigger);
      log.debug('ContextBuilder destroyed');
    },
  };
}
