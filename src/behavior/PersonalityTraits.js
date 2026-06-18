export function getTraitAdjustments(persona) {
  const traits  = persona?.personality?.traits ?? [];
  const energy  = persona?.personality?.energy ?? 'medium';

  let probabilityBoost      = 0;
  let typingSpeedMultiplier = 1.0;

  if (traits.includes('curious')) {
    probabilityBoost += 0.10;
  }

  if (traits.includes('supportive')) {
    probabilityBoost += 0.05;
  }

  if (traits.includes('friendly')) {
    probabilityBoost += 0.05;
  }

  if (energy === 'high') {
    typingSpeedMultiplier = 1.4;
  } else if (energy === 'low') {
    typingSpeedMultiplier = 0.7;
  }

  return { probabilityBoost, typingSpeedMultiplier };
}
