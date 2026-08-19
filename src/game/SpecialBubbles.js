export const SPECIAL_BUBBLE_LABELS = Object.freeze(['貪', '嗔', '痴', '慢', '疑']);
export const SPECIAL_BUBBLE_BONUS = 100;
export const DEFAULT_SPECIAL_BUBBLE_CHANCE = 0.08;

export function isSpecialBubble(bubble) {
  return Boolean(bubble?.specialLabel);
}

export function chooseSpecialLabel(random = Math.random, chance = DEFAULT_SPECIAL_BUBBLE_CHANCE) {
  if (random() >= chance) {
    return null;
  }
  const labelIndex = Math.floor(random() * SPECIAL_BUBBLE_LABELS.length);
  return SPECIAL_BUBBLE_LABELS[Math.min(labelIndex, SPECIAL_BUBBLE_LABELS.length - 1)];
}

export function getUniqueSpecialBubbles(cells = []) {
  const seen = new Set();
  return cells.filter((cell) => {
    if (!isSpecialBubble(cell)) return false;
    const key = `${cell.col}:${cell.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
