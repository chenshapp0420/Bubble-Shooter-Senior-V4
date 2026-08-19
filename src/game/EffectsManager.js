import { gridToWorld } from './GridMath.js';
import { AnimationManager } from './AnimationManager.js';

const POP_DURATION_MS = 220;
export const POP_STAGGER_MS = 75;
const FLOATING_MIN_DURATION_MS = 400;
const FLOATING_MAX_DURATION_MS = 800;

function createRefillTransitionEffect(beforeBubbles, afterBubbles, boardConfig, durationMs, shiftRows) {
  let elapsedMs = 0;
  const beforeByCell = new Map(beforeBubbles.map((bubble) => [`${bubble.col}:${bubble.row}`, bubble]));

  return {
    update(deltaMs) {
      elapsedMs += deltaMs;
      return elapsedMs >= durationMs;
    },
    render(context, bubbleRenderer) {
      const progress = Math.min(1, elapsedMs / durationMs);
      const eased = 1 - ((1 - progress) ** 3);

      afterBubbles.forEach((bubble) => {
        const previous = beforeByCell.get(`${bubble.col}:${bubble.row - shiftRows}`);
        const start = previous ?? gridToWorld(bubble.col, bubble.row - shiftRows, boardConfig);
        const x = start.x + (bubble.x - start.x) * eased;
        const y = start.y + (bubble.y - start.y) * eased;
        bubbleRenderer.drawBubble(x, y, bubble.bubbleType, 1, { source: 'REFILL_EFFECT', row: bubble.row, col: bubble.col, specialLabel: bubble.specialLabel });
      });

      if (progress < 0.42) {
        context.save();
        context.globalAlpha = (1 - progress / 0.42) * 0.22;
        context.fillStyle = '#ff6c6c';
        context.fillRect(boardConfig.x - 32, boardConfig.y - 30, 780, 4);
        context.restore();
      }
    }
  };
}

function createRefillEffect(cell, boardConfig, durationMs) {
  const position = gridToWorld(cell.col, cell.row, boardConfig);
  let elapsedMs = 0;

  return {
    update(deltaMs) {
      elapsedMs += deltaMs;
      return elapsedMs >= durationMs;
    },
    render(context, bubbleRenderer) {
      const progress = Math.min(1, elapsedMs / durationMs);
      const scale = 0.86 + progress * 0.14;

      context.save();
      context.globalAlpha = 0.45 * (1 - progress);
      context.strokeStyle = '#d9f2ff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(position.x, position.y, 28 + progress * 12, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      context.save();
      context.globalAlpha = 0.7 + progress * 0.3;
      bubbleRenderer.drawBubble(position.x, position.y, cell.bubbleType, scale, { source: 'REFILL_EFFECT', row: cell.row, col: cell.col, specialLabel: cell.specialLabel });
      context.restore();
    }
  };
}

function createPopEffect(cell, boardConfig, delayMs, onStart) {
  const position = gridToWorld(cell.col, cell.row, boardConfig);
  let elapsedMs = 0;
  let started = false;

  return {
    update(deltaMs) {
      elapsedMs += deltaMs;
      if (!started && elapsedMs >= delayMs) {
        started = true;
        onStart?.(cell);
      }

      return started && elapsedMs - delayMs >= POP_DURATION_MS;
    },
    render(context, bubbleRenderer) {
      if (!started) {
        return;
      }

      const progress = Math.min(1, (elapsedMs - delayMs) / POP_DURATION_MS);
      const fadeProgress = Math.min(1, progress * 1.15);

      context.save();
      context.globalAlpha = 1 - fadeProgress;
      bubbleRenderer.drawBubble(
        position.x,
        position.y,
        cell.bubbleType,
        1 + Math.min(0.08, progress * 0.08),
        { source: 'POP_EFFECT', row: cell.row, col: cell.col, specialLabel: cell.specialLabel }
      );

      context.globalAlpha = (1 - progress) * 0.65;
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(position.x, position.y, 25 + progress * 20, 0, Math.PI * 2);
      context.fill();

      context.globalAlpha = (1 - progress) * 0.8;
      context.strokeStyle = '#e7f6ff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(position.x, position.y, 24 + progress * 16, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  };
}

function createFloatingEffect(cell, boardConfig, onStart) {
  const position = gridToWorld(cell.col, cell.row, boardConfig);
  const durationMs = FLOATING_MIN_DURATION_MS + (
    ((cell.col * 17 + cell.row * 11) % 17) / 16
  ) * (FLOATING_MAX_DURATION_MS - FLOATING_MIN_DURATION_MS);
  let elapsedMs = 0;
  let started = false;
  let velocityY = 40;
  let currentY = position.y;

  return {
    update(deltaMs) {
      const deltaSeconds = deltaMs / 1000;
      elapsedMs += deltaMs;
      if (!started) {
        started = true;
        onStart?.(cell);
      }
      velocityY += 520 * deltaSeconds;
      currentY += velocityY * deltaSeconds;
      return elapsedMs >= durationMs;
    },
    render(context, bubbleRenderer) {
      const progress = Math.min(1, elapsedMs / durationMs);

      context.save();
      context.globalAlpha = 1 - Math.max(0, progress - 0.75) / 0.25;
      bubbleRenderer.drawBubble(position.x, currentY, cell.bubbleType, 1, { source: 'FLOATING_EFFECT', row: cell.row, col: cell.col, specialLabel: cell.specialLabel });
      context.restore();
    }
  };
}

export class EffectsManager {
  constructor(boardConfig) {
    this.boardConfig = boardConfig;
    this.animationManager = new AnimationManager();
  }

  queuePop(cells, onPop) {
    cells.forEach((cell, index) => {
      this.animationManager.add(createPopEffect(
        cell,
        this.boardConfig,
        index * POP_STAGGER_MS,
        (popCell) => onPop?.(popCell, index)
      ));
    });
  }

  queueFloatingDrop(cells, onDrop) {
    cells.forEach((cell, index) => {
      this.animationManager.add(createFloatingEffect(
        cell,
        this.boardConfig,
        index === 0 ? () => onDrop?.(cells.length) : null
      ));
    });
  }

  queueRefill(beforeBubbles, afterBubbles, durationMs, shiftRows = 1) {
    this.animationManager.add(createRefillTransitionEffect(
      beforeBubbles,
      afterBubbles,
      this.boardConfig,
      durationMs,
      shiftRows
    ));
  }

  update(deltaMs) {
    this.animationManager.update(deltaMs);
  }

  render(context, bubbleRenderer) {
    this.animationManager.render(context, bubbleRenderer);
  }

  getActiveCount() {
    return this.animationManager.getActiveCount();
  }

  clear() {
    this.animationManager.clear();
  }
}
