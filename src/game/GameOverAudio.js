const GAME_OVER_CLIP_DURATION_MS = 8725;

export class GameOverAudio {
  constructor(source = '/audio/guanyin_game_over.mp3', phraseDurationMs = GAME_OVER_CLIP_DURATION_MS) {
    this.source = source;
    this.phraseDurationMs = phraseDurationMs;
    this.audio = null;
    this.stopTimer = null;
    this.played = false;
    this.muted = false;
  }

  playOnce() {
    if (this.muted || this.played || typeof Audio === 'undefined') return false;
    this.played = true;
    this.audio = new Audio(this.source);
    this.audio.preload = 'auto';
    this.audio.loop = false;
    this.audio.currentTime = 0;
    this.audio.play().catch(() => {});
    this.stopTimer = globalThis.setTimeout(() => this.stop(), this.phraseDurationMs);
    return true;
  }

  stop() {
    if (this.stopTimer !== null) {
      globalThis.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) this.stop();
  }

  reset() {
    this.stop();
    this.played = false;
  }
}
