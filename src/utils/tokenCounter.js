const CHARS_PER_TOKEN = 4;

export function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function countMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, msg) => {

    return total + countTokens(msg?.content ?? '') + 4;
  }, 0);
}

export function fitsInBudget(messages, budget) {
  return countMessagesTokens(messages) <= budget;
}
