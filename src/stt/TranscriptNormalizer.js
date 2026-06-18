const HALLUCINATIONS = [
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'like and subscribe',
  'see you next time',
  'see you in the next video',
  'bye bye',
  'you',
  'the',
  'i',
];

const HALLUCINATION_RE = new RegExp(
  `^(${HALLUCINATIONS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[.!?,]*$`,
  'i'
);

const FILLERS = ['umm', 'um', 'uh', 'uhh', 'hmm', 'hm', 'mhm', 'erm', 'err'];

const FILLER_COLLAPSE_RE = new RegExp(
  `\\b(${FILLERS.join('|')})(\\s+\\1)+\\b`,
  'gi'
);

const MIN_LENGTH = 2;

export function normalizeTranscript(raw) {
  if (typeof raw !== 'string') return null;

  let text = raw.trim();
  if (!text) return null;

  text = text.replace(/\s{2,}/g, ' ');

  if (HALLUCINATION_RE.test(text)) return null;

  text = text.replace(FILLER_COLLAPSE_RE, '$1');

  text = text.trim();

  if (text.length < MIN_LENGTH) return null;

  return text;
}
