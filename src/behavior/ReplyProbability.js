const QUESTION_WORD_RE = /\b(what|how|why|when|where|who|kya|kaisa|kaisi|kaise|bata|batao|samjha|samjhao|kyun|kab|kaun)\b/i;

export function computeReplyProbability(baseProb, { type, text }) {
  let prob = baseProb;

  if (text.includes('?')) {
    prob = Math.min(1.0, prob + 0.4);
  }

  if (QUESTION_WORD_RE.test(text)) {
    prob = Math.min(1.0, prob + 0.2);
  }

  return Math.max(0, Math.min(1, prob));
}
