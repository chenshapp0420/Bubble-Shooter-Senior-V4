export const COIN_PITCH_VARIATIONS = [988, 1175, 1319, 1568, 1760, 2093];
export const GAME_OVER_COIN_COUNT_MIN = 18;
export const GAME_OVER_COIN_COUNT_MAX = 24;
export const GAME_OVER_MUSIC_GAIN = 1.1;
export const WALL_HIT_AUDIO_SOURCE = '/audio/amitabha_wall.mp3';
export const GAME_OVER_AUDIO_SOURCE = '/audio/guanyin_game_over.mp3';
export const GAME_OVER_NOTE_GAIN_MULTIPLIER = 2.2;
export const GAME_OVER_MUSIC_SEQUENCE = [
  { frequency: 784, delayMs: 0, durationMs: 150, type: 'triangle', volume: 0.1, endFrequency: 820 },
  { frequency: 988, delayMs: 150, durationMs: 150, type: 'triangle', volume: 0.1, endFrequency: 1020 },
  { frequency: 1175, delayMs: 300, durationMs: 180, type: 'sine', volume: 0.095, endFrequency: 1175 },
  { frequency: 988, delayMs: 480, durationMs: 220, type: 'triangle', volume: 0.085, endFrequency: 970 },
  { frequency: 880, delayMs: 900, durationMs: 260, type: 'sine', volume: 0.08, endFrequency: 860 },
  { frequency: 784, delayMs: 1220, durationMs: 300, type: 'triangle', volume: 0.075, endFrequency: 760 },
  { frequency: 659, delayMs: 1700, durationMs: 360, type: 'sine', volume: 0.07, endFrequency: 650 },
  { frequency: 523, delayMs: 2180, durationMs: 470, type: 'triangle', volume: 0.065, endFrequency: 510 },
  { frequency: 392, delayMs: 2780, durationMs: 620, type: 'sine', volume: 0.055, endFrequency: 392 }
];

export const SHOOT_SOUND = {
  transientDurationMs: 24,
  transientVolume: 0.055,
  frequency: 760,
  endFrequency: 1080,
  durationMs: 88,
  oscillatorType: 'triangle',
  volume: 0.13
};

export const CONTACT_SOUND = {
  transientDurationMs: 8,
  transientVolume: 0.045,
  frequency: 390,
  endFrequency: 320,
  durationMs: 68,
  oscillatorType: 'sine',
  volume: 0.1
};

export const POP_VARIATIONS = [
  { frequency: 520, endFrequency: 340, durationMs: 60, oscillatorType: 'sine', volume: 0.2, transientDurationMs: 14, transientVolume: 0.07 },
  { frequency: 600, endFrequency: 390, durationMs: 60, oscillatorType: 'triangle', volume: 0.2, transientDurationMs: 14, transientVolume: 0.07 },
  { frequency: 680, endFrequency: 430, durationMs: 62, oscillatorType: 'sine', volume: 0.2, transientDurationMs: 16, transientVolume: 0.07 },
  { frequency: 760, endFrequency: 480, durationMs: 54, oscillatorType: 'triangle', volume: 0.19, transientDurationMs: 12, transientVolume: 0.07 }
];

export function createCoinCascadePlan(random = Math.random) {
  const count = GAME_OVER_COIN_COUNT_MIN + Math.floor(random() * (GAME_OVER_COIN_COUNT_MAX - GAME_OVER_COIN_COUNT_MIN + 1));
  let delayMs = 0;

  return Array.from({ length: count }, (_, index) => {
    if (index > 0) {
      delayMs += 30 + random() * 70;
    }

    const pitchIndex = index < 4
      ? index
      : Math.floor(random() * COIN_PITCH_VARIATIONS.length);
    const hasBounce = index === count - 1 || random() < 0.36;
    return {
      index,
      delayMs,
      frequency: COIN_PITCH_VARIATIONS[pitchIndex],
      pitchIndex,
      durationMs: index === count - 1 ? 180 : 85 + random() * 95,
      hasBounce,
      bounceDelayMs: index === count - 1 ? 120 : (hasBounce ? 50 + random() * 70 : 0)
    };
  });
}

export class AudioManager {
  constructor(masterVolume = 1.0) {
    this.masterVolume = masterVolume;
    this.muted = false;
    this.audioContext = null;
    this.masterGain = null;
    this.gameOverGain = null;
    this.compressor = null;
    this.popVariation = 0;
    this.gameOverMusicPlayed = false;
    this.gameOverTimers = [];
    this.gameOverCoinTimers = [];
    this.gameOverCoinPlayed = false;
    this.refillTimers = [];
    this.floatingRewardTimers = [];
    this.duckTimer = null;
    this.gameOverAudio = null;
    this.wallBounceAudio = null;
  }

  ensureContext() {
    if (this.audioContext || typeof window === 'undefined') {
      return this.audioContext;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.gameOverGain = this.audioContext.createGain();
      this.gameOverGain.gain.value = GAME_OVER_MUSIC_GAIN;
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;
      this.masterGain.connect(this.compressor);
      this.gameOverGain.connect(this.masterGain);
      this.compressor.connect(this.audioContext.destination);
    }

    return this.audioContext;
  }

  resume() {
    const context = this.ensureContext();
    if (context?.state === 'suspended') {
      context.resume().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.gameOverAudio?.setMuted(this.muted);
    if (this.muted) {
      this.gameOverTimers.forEach((timer) => globalThis.clearTimeout(timer));
      this.gameOverTimers = [];
      this.gameOverCoinTimers.forEach((timer) => globalThis.clearTimeout(timer));
      this.gameOverCoinTimers = [];
    }
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  bindGameOverAudio(gameOverAudio) {
    this.gameOverAudio = gameOverAudio;
  }

  playTone(
    frequency,
    durationMs,
    type = 'sine',
    volume = 0.12,
    endFrequency = frequency,
    destinationGain = this.masterGain
  ) {
    if (this.muted) return false;

    const context = this.ensureContext();
    if (!context || !this.masterGain) return false;

    const startTime = context.currentTime;
    const endTime = startTime + durationMs / 1000;
    const oscillator = context.createOscillator();
    const individualGain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.linearRampToValueAtTime(endFrequency, endTime);
    individualGain.gain.setValueAtTime(0.0001, startTime);
    individualGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startTime + 0.008);
    individualGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    oscillator.connect(individualGain);
    individualGain.connect(destinationGain);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
    return true;
  }

  playNoiseBurst(durationMs, volume = 0.06, destinationGain = this.masterGain) {
    if (this.muted) return false;

    const context = this.ensureContext();
    if (!context || !this.masterGain) return false;

    const frameCount = Math.max(1, Math.ceil(context.sampleRate * durationMs / 1000));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (Math.random() * 2) - 1;
    }

    const source = context.createBufferSource();
    const individualGain = context.createGain();
    const startTime = context.currentTime;
    const endTime = startTime + durationMs / 1000;
    source.buffer = buffer;
    individualGain.gain.setValueAtTime(0.0001, startTime);
    individualGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startTime + Math.min(0.004, durationMs / 2000));
    individualGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    source.connect(individualGain);
    individualGain.connect(destinationGain);
    source.start(startTime);
    source.stop(endTime + 0.005);
    return true;
  }

  playShootMelody() {
    if (this.muted) return false;
    const transient = this.playNoiseBurst(
      SHOOT_SOUND.transientDurationMs,
      SHOOT_SOUND.transientVolume
    );
    const sweep = this.playTone(
      SHOOT_SOUND.frequency,
      SHOOT_SOUND.durationMs,
      SHOOT_SOUND.oscillatorType,
      SHOOT_SOUND.volume,
      SHOOT_SOUND.endFrequency
    );
    return transient || sweep;
  }
  playShoot() { return this.playShootMelody(); }
  playWallBounceSound() {
    if (this.muted) return false;
    if (typeof Audio !== 'undefined') {
      if (!this.wallBounceAudio) {
        this.wallBounceAudio = new Audio(WALL_HIT_AUDIO_SOURCE);
        this.wallBounceAudio.preload = 'auto';
      }
      this.wallBounceAudio.volume = Math.min(1, this.masterVolume * 0.45);
      this.wallBounceAudio.currentTime = 0;
      this.wallBounceAudio.play().catch(() => {});
      return true;
    }
    const first = this.playTone(440, 62, 'triangle', 0.11, 500);
    if (first) {
      globalThis.setTimeout(() => {
        this.playTone(660, 70, 'sine', 0.1, 720);
      }, 52);
    }
    return first;
  }
  playHitBubble() {
    const transient = this.playNoiseBurst(
      CONTACT_SOUND.transientDurationMs,
      CONTACT_SOUND.transientVolume
    );
    const tone = this.playTone(
      CONTACT_SOUND.frequency,
      CONTACT_SOUND.durationMs,
      CONTACT_SOUND.oscillatorType,
      CONTACT_SOUND.volume,
      CONTACT_SOUND.endFrequency
    );
    return transient || tone;
  }

  playPop() {
    const variation = POP_VARIATIONS[this.popVariation % POP_VARIATIONS.length];
    this.popVariation += 1;
    const transient = this.playNoiseBurst(
      variation.transientDurationMs,
      variation.transientVolume
    );
    const tone = this.playTone(
      variation.frequency,
      variation.durationMs,
      variation.oscillatorType,
      variation.volume,
      variation.endFrequency
    );
    return transient || tone;
  }

  playFloatingDrop() { return this.playFloatingRewardMusic(1); }

  playFloatingRewardMusic(count = 1) {
    if (this.muted) return false;
    const notes = [523, 587, 659, 784, 880, 1047];
    const noteCount = Math.max(3, Math.min(6, count + 2));
    notes.slice(0, noteCount).forEach((frequency, index) => {
      const timer = globalThis.setTimeout(() => {
        this.playTone(frequency, 115, 'triangle', 0.17, frequency * 1.04);
      }, index * 120);
      this.floatingRewardTimers.push(timer);
    });
    return true;
  }

  playRefill() {
    return this.playRefillMusic();
  }

  playRefillMusic() {
    if (this.muted) return false;
    const context = this.ensureContext();
    if (!context || !this.masterGain) return false;
    [392, 659, 523, 784, 880, 698].forEach((frequency, index) => {
      const timer = globalThis.setTimeout(() => {
        this.playTone(frequency, 135, index % 2 ? 'sine' : 'triangle', 0.14, frequency * 1.03);
      }, index * 140);
      this.refillTimers.push(timer);
    });
    return true;
  }

  playGameOverMusic() {
    if (this.gameOverMusicPlayed || this.muted) return false;
    this.gameOverMusicPlayed = true;
    if (this.gameOverAudio?.playOnce()) {
      return true;
    }
    GAME_OVER_MUSIC_SEQUENCE.forEach((note) => {
      const timer = globalThis.setTimeout(() => (
        this.playTone(
          note.frequency,
          note.durationMs,
          note.type,
          note.volume * GAME_OVER_NOTE_GAIN_MULTIPLIER,
          note.endFrequency,
          this.gameOverGain ?? this.masterGain
        )
      ), note.delayMs);
      this.gameOverTimers.push(timer);
    });
    return true;
  }

  playGameOverCoinCascade() {
    if (this.gameOverCoinPlayed || this.muted) return false;

    const context = this.ensureContext();
    if (!context || !this.masterGain) return false;

    this.gameOverCoinPlayed = true;
    const plan = createCoinCascadePlan();
    plan.forEach((event) => {
      const timer = globalThis.setTimeout(() => {
        if (this.muted) return;
        this.playTone(event.frequency, event.durationMs, 'triangle', 0.075, event.frequency * 1.04);
        if (event.hasBounce) {
          const bounceTimer = globalThis.setTimeout(() => {
            if (!this.muted) {
              this.playTone(event.frequency * 1.12, 70, 'sine', 0.032, event.frequency * 1.16);
            }
          }, event.bounceDelayMs);
          this.gameOverCoinTimers.push(bounceTimer);
        }
      }, event.delayMs);
      this.gameOverCoinTimers.push(timer);
    });
    return true;
  }

  playBoardClearCheer() {
    if (this.muted) return false;
    [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
      const timer = globalThis.setTimeout(() => {
        this.playTone(frequency, 420, 'triangle', 0.18, frequency * 1.03);
      }, index * 180);
      this.gameOverTimers.push(timer);
    });
    const chordTimer = globalThis.setTimeout(() => {
      [523, 659, 784].forEach((frequency) => {
        this.playTone(frequency, 1500, 'sine', 0.1, frequency);
      });
    }, 950);
    this.gameOverTimers.push(chordTimer);
    return true;
  }

  resetGameOverMusic() {
    this.gameOverAudio?.reset();
    this.gameOverTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.gameOverTimers = [];
    this.gameOverCoinTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.gameOverCoinTimers = [];
    this.gameOverCoinPlayed = false;
    this.refillTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.refillTimers = [];
    this.gameOverMusicPlayed = false;
    this.floatingRewardTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.floatingRewardTimers = [];
    if (this.duckTimer !== null) {
      globalThis.clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
  }

  duckMusic(durationMs = 1100) {
    if (!this.masterGain || this.muted) return;
    this.masterGain.gain.value = this.masterVolume * 0.3;
    if (this.duckTimer !== null) globalThis.clearTimeout(this.duckTimer);
    this.duckTimer = globalThis.setTimeout(() => {
      this.duckTimer = null;
      if (!this.muted && this.masterGain) this.masterGain.gain.value = this.masterVolume;
    }, durationMs);
  }
}
