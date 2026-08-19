export class MissTracker {
  constructor(missesBeforeRefill) {
    this.limit = missesBeforeRefill;
    this.reset();
  }

  registerShot(matchCount) {
    if (matchCount >= 3) {
      this.missCount = Math.max(0, this.missCount - 1);
      this.chances = Math.min(this.limit, this.limit - this.missCount);
    } else {
      this.missCount += 1;
      this.chances = Math.max(0, this.limit - this.missCount);
    }

    return this.getState();
  }

  reset() {
    this.missCount = 0;
    this.chances = this.limit;
  }

  getState() {
    return {
      missCount: this.missCount,
      chances: this.chances,
      shouldRefill: this.missCount >= this.limit
    };
  }
}
