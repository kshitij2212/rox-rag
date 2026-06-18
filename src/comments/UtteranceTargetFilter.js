import logger from '../utils/logger.js';

const log = logger.child({ module: 'UtteranceTargetFilter' });

const COMMON_NAMES = new Set([
  'शितिज', 'क्षितिज', 'शितिज़', 'क्षितिज़', 'क्षितीज', 'क्षितीज़',
  'आरव', 'अभिषेक', 'आदित्य', 'अदिति', 'अजय', 'आकाश', 'आलोक', 'अमित', 'अनन्या', 'अनिकेत',
  'अनिल', 'अंकित', 'अंकिता', 'अर्जुन', 'आर्यन', 'आशीष', 'अशोक', 'आयुष', 'चेतन', 'दीपक',
  'देव', 'दिव्या', 'दिया', 'एकता', 'गौरव', 'हर्ष', 'हर्षल', 'हरीश', 'इशान', 'इशआन', 'ज्योति',
  'काजल', 'कमल', 'करण', 'कार्तिक', 'काव्या', 'किरण', 'कीर्ति', 'कृति', 'कुणाल', 'मनीष',
  'मनोज', 'मयंक', 'मेघा', 'मीनाक्षी', 'मोहित', 'मोनिका', 'नमन', 'नेहा', 'नीतू', 'निखिल',
  'निशा', 'नितिन', 'पल्लवी', 'पं', 'अभिषेक', 'अभिशेक', 'अभि', 'अभिशेख', 'अब्बी', 'अबीशेंग', 'abhishek',
  'shivam', 'shiva', 'shiv', 'शिवम', 'शवाम', 'शीवम', 'शवंम', 'शेबंबाई', 'शेबं', 'शिबम', 'शिवं', 'севम', 'सेवम', 'शेबम', 'शिवन', 'शिवा',
  'aman', 'अमन', 'आमन', 'अमं', 'अमान', 'हमन',
  'rahul', 'rahul', 'rahul', 'राहुल', 'राउल', 'राऊल', 'राहू', 'राहूल'
]);

const OBJECT_MARKERS = new Set([
  'ko', 'se', 'ne', 'ke', 'ki', 'ka', 'mein', 'pe', 'par',
  'को', 'से', 'ने', 'के', 'की', 'का', 'में', 'पे', 'पर'
]);

const ADDRESSEE_MARKERS = new Set([
  'tu', 'tum', 'tere', 'tera', 'teri', 'tumhara', 'tumhari', 'tumhe', 'tumhein', 'tujhe', 'tujhse', 'aap', 'aapka', 'aapki', 'aapko', 'aapse',
  'तू', 'तुम', 'तेरे', 'तेरा', 'तेरी', 'तुम्हारा', 'तुम्हारी', 'तुम्हें', 'तुझे', 'तुझसे', 'आप', 'आपका', 'आपकी', 'आपको', 'आपसे'
]);

const VOCATIVE_PREFIXES = new Set([
  'hey', 'hi', 'hello', 'arre', 'arey', 'oye', 'oyi', 'yo', 'ae', 'aye', 'अरे', 'ओ', 'हे'
]);

const VOCATIVE_PREFIX_RE = /\b(?:hey|hi|hello|arre|arey|oye|oyi|yo|ae|aye)\s+/gi;

const AT_MENTION_RE = /@(\w+)/g;

const LEADING_NAME_RE = /^([A-Z][a-z]{1,15})\s*[,!]/;

function extractNames(text, botSet = new Set()) {
  const found = new Set();

  for (const match of text.matchAll(AT_MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }

  for (const match of text.matchAll(VOCATIVE_PREFIX_RE)) {
    const afterPrefix = text.slice(match.index + match[0].length);
    const wordMatch = afterPrefix.match(/^([a-zA-Z\u0900-\u097F]+)/);
    if (wordMatch) {
      const candidate = wordMatch[1].toLowerCase();
      if (COMMON_NAMES.has(candidate) || botSet.has(candidate) || /^[A-Z]/.test(wordMatch[1])) {
        found.add(candidate);
      }
    }
  }

  const leadMatch = text.match(LEADING_NAME_RE);
  if (leadMatch) {
    found.add(leadMatch[1].toLowerCase());
  }

  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z\u0900-\u097F]/g, '');
    if (clean.length >= 2 && (COMMON_NAMES.has(clean) || botSet.has(clean))) {
      found.add(clean);
    }
  }

  return found;
}

const SECOND_PERSON_RE = /\b(tu|tum|tere|tera|teri|tumhara|tumhari|tumhe|tumhein|tujhe|tujhse|aap|aapka|aapki|aapko|aapse)\b|तू|तुम|तेरे|तेरा|तेरी|तुम्हारा|तुम्हारी|तुम्हें|तुझे|तुझसे|आप|आपका|आपकी|आपको|आपसे/iu;

const IMPERATIVE_DIRECT_RE = /\b(sun|suno|bol|bolo|bata|batao|dekh|dekho|chal|chalo|arre|arey|oye|oyi)\b|सुन|सुनो|बोल|बोलो|बता|बताओ|देख|देखो|चल|chalo|अरे/iu;

const AUDIENCE_RE = /\b(all|guys|everyone|sab|sabko|sablog|sab\s*log|logo|logon|dosto|doston|friends|chat|people|y'?all|bhai\s*log|bhailog)\b|सब|सबको|सबका|सबलोग|लोग|लोगो|लोगों|दोस्तों|दोस्त|चैट|भाईलोग/iu;

const ROOM_QUESTION_RE = /\b(koi\s+batao|koi\s+bolo|anyone\s+know|koi\s+hai|kisiko\s+pata|koi\s+suno|koi\s+bata)\b|कोई\s+बताओ|कोई\s+bolo|कोई\s+है|किसीको\s+पता|किसी\s+को\s+पता|कोई\s+सुनो|कोई\s+बता/iu;

const OTHER_PERSON_TERMS = /\b(didi|bhaiya|di|sis|sister|bro|brother)\b|(?<=^|[\s,;.!?-])(?:दीदी|भैया|दी|ब्रदर)(?=[\s,;.!?-]|$)/iu;

const MULTI_WORD_REPLACEMENTS = [
  { pattern: /\b(?:ab\s+sheikh|ab\s+shekh|ab\s+sekh|ab\s+shak)\b/gi, replacement: 'abhishek' },
  { pattern: /अब\s+शेख|अब\s+सेख|अबे\s+शेख|अबे\s+सेख/g, replacement: 'अभिषेक' },
  { pattern: /\b(?:shiva\s+m|shiva\s+am|shiv\s+am|shiv\s+om)\b/gi, replacement: 'shivam' },
  { pattern: /शिव\s+एम|शिव\s+अम|शिव\s+ओम/g, replacement: 'शिवम' }
];

function normalizeText(text) {
  let normalized = text;
  for (const item of MULTI_WORD_REPLACEMENTS) {
    normalized = normalized.replace(item.pattern, item.replacement);
  }
  return normalized;
}

export function classifyTarget(text, botNames = []) {
  const botSet = new Set();
  for (const name of botNames) {
    if (!name) continue;
    const lower = name.toLowerCase();
    botSet.add(lower);
    const parts = lower.split(/\s+/);
    for (const part of parts) {
      if (part.length >= 2) botSet.add(part);
    }
  }

  if (botSet.has('aman')) {
    botSet.add('अमन');
    botSet.add('आमन');
    botSet.add('अमं');
    botSet.add('अमान');
    botSet.add('हमन');
  }
  if (botSet.has('shivam')) {
    botSet.add('शिवम');
    botSet.add('शवाम');
    botSet.add('शीवम');
    botSet.add('शवंम');
    botSet.add('शेबंबाई');
    botSet.add('शेबं');
    botSet.add('शिबम');
    botSet.add('शिवं');
    botSet.add('севम');
    botSet.add('सेवम');
    botSet.add('शेबम');
    botSet.add('शिवन');
    botSet.add('शिवा');
  }
  if (botSet.has('abhishek')) {
    botSet.add('अभिषेक');
    botSet.add('अभिशेक');
    botSet.add('अभि');
    botSet.add('अभिशेख');
    botSet.add('अब्बी');
    botSet.add('अबीशेंग');
  }
  if (botSet.has('rahul')) {
    botSet.add('राहुल');
    botSet.add('राउल');
    botSet.add('राऊल');
    botSet.add('राहू');
    botSet.add('राहूल');
  }

  const normalized = normalizeText(text);

  // Build name roles
  const nameRoles = new Map();
  const words = normalized.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const clean = word.replace(/[^a-z\u0900-\u097F]/g, '');
    if (clean.length >= 2 && (COMMON_NAMES.has(clean) || botSet.has(clean))) {
      const prevWord = i > 0 ? words[i - 1].toLowerCase().replace(/[^a-z\u0900-\u097F]/g, '') : '';
      const nextWord = i + 1 < words.length ? words[i + 1].toLowerCase().replace(/[^a-z\u0900-\u097F]/g, '') : '';
      const hasTrailingPunctuation = /[,!?]/.test(word);

      let role = 'neutral';
      if (OBJECT_MARKERS.has(nextWord)) {
        role = 'object';
      } else if (ADDRESSEE_MARKERS.has(nextWord) || VOCATIVE_PREFIXES.has(prevWord) || hasTrailingPunctuation) {
        role = 'addressed';
      }

      if (!nameRoles.has(clean)) {
        nameRoles.set(clean, new Set());
      }
      nameRoles.get(clean).add(role);
    }
  }

  const mentionsBot = [...nameRoles.keys()].some((n) => botSet.has(n));
  const hasOtherPersonTerm = OTHER_PERSON_TERMS.test(text);

  // ── Step 1: Named person or address check ──
  if (nameRoles.size > 0 || hasOtherPersonTerm) {
    if (mentionsBot) {
      const botNamesInText = [...nameRoles.keys()].filter(name => botSet.has(name));
      const ourBotHasAddressed = botNamesInText.some(name => nameRoles.get(name).has('addressed'));
      const ourBotHasObject = botNamesInText.some(name => nameRoles.get(name).has('object'));

      const otherNamesInText = [...nameRoles.keys()].filter(name => !botSet.has(name));
      const otherNamesAddressed = otherNamesInText.some(name => nameRoles.get(name).has('addressed'));

      if (ourBotHasAddressed) {
        log.debug({ text, names: [...nameRoles.keys()] }, 'Target: bot_direct (Our bot explicitly addressed)');
        return { target: 'bot_direct', shouldProcess: true };
      }

      if (ourBotHasObject && !ourBotHasAddressed) {
        log.debug({ text, names: [...nameRoles.keys()] }, 'Target: other_person (Our bot is object/referenced, not addressed)');
        return { target: 'other_person', shouldProcess: false };
      }

      if (otherNamesAddressed && !ourBotHasAddressed) {
        log.debug({ text, names: [...nameRoles.keys()] }, 'Target: other_person (Another name is addressed, our bot is not)');
        return { target: 'other_person', shouldProcess: false };
      }

      log.debug({ text, names: [...nameRoles.keys()] }, 'Target: bot_direct (Bot named/mentioned)');
      return { target: 'bot_direct', shouldProcess: true };
    }

    // Only other people named or addressed, bot not mentioned — hard ignore.
    // BUT if none of the other people are explicitly addressed, and we see second-person pronouns,
    // they are likely talking to the bot about this other person.
    const otherNamesInText = [...nameRoles.keys()].filter(name => !botSet.has(name));
    const otherNamesAddressed = otherNamesInText.some(name => nameRoles.get(name).has('addressed'));
    if (!otherNamesAddressed && SECOND_PERSON_RE.test(text)) {
      log.debug({ text, names: [...nameRoles.keys()] }, 'Target: allowed (talking to bot about another person)');
      return { target: 'allowed', shouldProcess: true };
    }

    log.debug({ text, names: [...nameRoles.keys()], hasOtherPersonTerm }, 'Target: other_person');
    return { target: 'other_person', shouldProcess: false };
  }

  // ── Default: Allow all other comments (no other names are taken) ──
  log.debug({ text }, 'Target: allowed (no other names addressed)');
  return { target: 'allowed', shouldProcess: true };
}
