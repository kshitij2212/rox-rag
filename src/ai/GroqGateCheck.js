import logger from '../utils/logger.js';

const log = logger.child({ module: 'GroqGateCheck' });

function getSystemPrompt(botNames = ['Aman']) {
  const primaryBotName = botNames[0] || 'Aman';
  const botLower = primaryBotName.toLowerCase();
  
  const botNamesList = botNames.map(n => `"${n.toLowerCase()}"`).join(', ');

  const otherNames = ['shashi', 'arav', 'didi', 'bhaiya', 'aman', 'shivam', 'abhishek', 'rahul', 'priya', 'simran', 'neha', 'ananya', 'divya']
    .filter(n => !botNames.some(bn => bn.toLowerCase().includes(n.toLowerCase())));

  const otherName = otherNames[0] || 'Aman';

  return `You are a classifier for a Hindi/English livestream.
Given an utterance from a streamer, decide who is being addressed:

- "${botLower}"   — the streamer is directly addressing the bot (using any of these names/aliases: ${botNamesList}), or using second-person pronouns/terms (like "tum", "aap", "tujhe", "you", "yaar", "bro", "apne", "aapka") without naming any other specific participant. (e.g., "${primaryBotName} kaha se ho", "kya bol rha hai", "tum batao", "main samjha nahi tum kya bol rahe ho", "aur batao kaha se ho"). This includes asking follow-up questions referencing details the bot previously mentioned (like their shop/dukaan, job, location, family, etc.), or asking general status/well-being/greeting questions (like "kya haal chal", "aur batao kaise ho", "aur batayein", "apne bare mein batao") without naming anyone else. This also includes questions/utterances where the second-person pronoun (you/tum/aap) is implicit or omitted but the verb conjugation/context clearly refers to a second-person (e.g., "kaha chale gaye the", "kya bol rahe ho", "kaha ho", "sun rahe ho", "kaha chale gaye the abhi beech me").
- "chat"   — the streamer is addressing the general chat/audience, telling a story, or narrating a past event (e.g. "kya chal rha hai", "hello guys", "sab kaise ho").
- "person" — the streamer is directly addressing/talking to another specific participant, moderator, or viewer by name or specific title (e.g., "hello ${otherName}", "${otherNames[1] || 'shashi'} suno", "didi aap batao", "${otherNames[2] || 'arav'} kya bol rha hai"). Do NOT classify as "person" if any of the bot's aliases (${botNamesList}) are mentioned. Do NOT classify as "person" if no specific name is mentioned and they are just addressing "you". Do NOT classify as "person" if the streamer is referring to a third person (like Atif Aslam, Dhoni, Arijit) as a topic of discussion.

## Crucial Rule: Storytelling and Narratives
- If the streamer is telling a story, narrating a past event, or talking about another person in the third person (using words like "maine usse kaha" - I told him, "wo bol raha tha" - he was saying, "usne bola" - he said, "vo", "wo", "usko", "unhe", "unse"), classify as "chat" or "person".
- NEVER classify narrative/storytelling or third-person talk as addressing the bot, even if second-person pronouns or conversational fillers (like "yaar", "bhai", "kaise ho") appear inside the narrative or quotes.

Examples:
1. Input: "हेलो ${primaryBotName} कैसे हो" -> Output: "${botLower}"
2. Input: "hello ${otherName} kaisa hai" -> Output: "person"
3. Input: "aur batao kaha se ho" -> Output: "${botLower}" (no other person named)
4. Input: "main samjha nahi tum kya bol rahe ho" -> Output: "${botLower}" (addressed to "you", no other person named)
5. Input: "aap kis dukaan ki baat kar rahe ho" -> Output: "${botLower}" (asking about bot's shop)
6. Input: "arre hello hello to hota rahega aur batayein kya haal chal" -> Output: "${botLower}" (asking for status/well-being, no other person named)
7. Input: "हेलो गाइस कैसे हो" -> Output: "chat"
8. Input: "kya chal rha hai dosto" -> Output: "chat"
9. Input: "didi aap batao" -> Output: "person" (addresses didi)
10. Input: "yaar to maine usse kaha tha ki kaise ho to bol raha tha to thik hu mai" -> Output: "chat" (narrating a past conversation with another person)
11. Input: "usne mujhe bola ki tum kahan ho" -> Output: "chat" (narrating what someone else said)
12. Input: "कहां चले गए थे अभी बीच में" -> Output: "${botLower}" (implicit second-person question)

Reply with ONLY one word: "${botLower}", "chat", or "person". Nothing else.`;
}

const GATE_TIMEOUT_MS  = 3200;
const GATE_MAX_TOKENS  = 3;
const GATE_TEMPERATURE = 0;

export function createGroqGateCheck({ groqAdapter, botNames = ['Aman'] }) {
  if (!groqAdapter) throw new Error('GroqGateCheck: groqAdapter is required');

  // Ensure we have a string array
  const namesArray = Array.isArray(botNames) ? botNames : [botNames];
  const primaryBotName = namesArray[0] || 'Aman';
  const botLower = primaryBotName.toLowerCase();
  const systemPrompt = getSystemPrompt(namesArray);

  async function check(text) {
    const lowerText = text.toLowerCase();
    const matchesBotName = namesArray.some(name => {
      const cleanName = name.toLowerCase().trim();
      if (!cleanName) return false;
      const re = new RegExp(`\\b${cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      return re.test(lowerText);
    });

    if (matchesBotName) {
      log.info({ text, botName: primaryBotName }, `Local check matched bot name/alias — bypassing Groq gate`);
      return { directed: botLower };
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: text },
    ];

    try {
      const result = await Promise.race([
        groqAdapter.complete(messages, { maxTokens: GATE_MAX_TOKENS, temperature: GATE_TEMPERATURE }),
        timeoutPromise(GATE_TIMEOUT_MS),
      ]);

      if (result === 'TIMEOUT') {
        log.warn({ text }, 'Groq gate timed out — defaulting to "chat"');
        return { directed: 'chat' };
      }

      const raw = result?.choices?.[0]?.message?.content?.trim()?.toLowerCase() ?? '';

      if (namesArray.some(name => raw.includes(name.toLowerCase())) || raw.includes(botLower)) {
        log.info({ text, raw }, `Groq gate → ${botLower}`);
        return { directed: botLower };
      }

      if (raw.includes('person')) {
        log.info({ text, raw }, 'Groq gate → person');
        return { directed: 'person' };
      }

      log.info({ text, raw }, 'Groq gate → chat');
      return { directed: 'chat' };

    } catch (err) {
      log.warn({ err, text }, 'Groq gate error — defaulting to "chat"');
      return { directed: 'chat' };
    }
  }

  return { check };
}

function timeoutPromise(ms) {
  return new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), ms));
}
