export const LOW_BUBBLE_THRESHOLD = 35;
export const EXTREME_LOW_BUBBLE_THRESHOLD = 20;
export const MINIMUM_DANGER_SAFETY_GAP = 80;

export function getLowBubbleRefillRows(bubbleCount) {
  if (bubbleCount <= 0 || bubbleCount >= LOW_BUBBLE_THRESHOLD) return 0;
  return bubbleCount < EXTREME_LOW_BUBBLE_THRESHOLD ? 2 : 1;
}
