import { SPECIAL_BUBBLE_BONUS } from './SpecialBubbles.js';

const SCORE_PER_MATCHED_BUBBLE = 10;
const SCORE_PER_FLOATING_BUBBLE = 20;
export const BOARD_CLEAR_BONUS = 5000;
export { SPECIAL_BUBBLE_BONUS };

export function getBoardClearBonus(stage) {
  return BOARD_CLEAR_BONUS + Math.max(0, stage - 1) * 2500;
}

function getGroupBonus(count) {
  if (count >= 9) return 100;
  if (count >= 6) return 50;
  if (count >= 4) return 20;
  return 0;
}

export class ScoreManager {
  constructor() {
    this.reset();
  }

  addMatch(count) {
    this.score += count * SCORE_PER_MATCHED_BUBBLE + getGroupBonus(count);
    this.pulseElapsedMs = 0;
    return this.score;
  }

  addFloating(count) {
    this.score += count * SCORE_PER_FLOATING_BUBBLE;
    this.pulseElapsedMs = 0;
    return this.score;
  }

  addSpecialBonus(count) {
    const bonus = Math.max(0, count) * SPECIAL_BUBBLE_BONUS;
    this.score += bonus;
    if (bonus > 0) this.pulseElapsedMs = 0;
    return bonus;
  }

  addBoardClear(stage) {
    const bonus = getBoardClearBonus(stage);
    this.score += bonus;
    this.pulseElapsedMs = 0;
    return bonus;
  }

  update(deltaMs) {
    this.pulseElapsedMs = Math.min(120, this.pulseElapsedMs + deltaMs);
  }

  getPulseScale() {
    if (this.pulseElapsedMs >= 120) return 1;
    const progress = this.pulseElapsedMs / 120;
    return progress < 0.5 ? 1 + progress * 0.16 : 1.08 - (progress - 0.5) * 0.16;
  }

  getScore() {
    return this.score;
  }

  getDisplayScore() {
    return String(this.score);
  }

  reset() {
    this.score = 0;
    this.pulseElapsedMs = 120;
  }
}
