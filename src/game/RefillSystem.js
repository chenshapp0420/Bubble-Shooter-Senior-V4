import { createClusteredRow } from './BoardPattern.js';
import { getBubbleRenderPosition } from './GridMath.js';
import { getBoardVisualRadius } from './config.js';

export function refillBoard(board, options) {
  const {
    colors,
    rowIndex = 0,
    patternStage = 1,
    rowsPerTrigger = 4,
    random = Math.random,
    dangerLineY,
    bubbleRadius
  } = options;
  const rowBubbleTypes = Array.from({ length: rowsPerTrigger }, (_, row) => (
    createClusteredRow(colors, rowIndex + row, board.config.columns, patternStage, random)
  ));
  const addedBubbles = board.shiftDownAndAddRows(rowBubbleTypes, { dangerLineY, bubbleRadius });

  return addedBubbles
    ? { success: true, bubbles: addedBubbles }
    : { success: false, bubbles: [] };
}

export function isDangerLineReached(board, dangerLineY, bubbleRadius) {
  return board.getOccupiedBubbles().some((bubble) => (
    getBubbleWorldPosition(bubble, board.config).y + bubbleRadius >= dangerLineY
  ));
}

export function getBubbleWorldPosition(bubble, boardConfig) {
  return getBubbleRenderPosition(bubble, boardConfig);
}

export function getBoardBubbleDangerGeometry(
  bubble,
  boardConfig,
  dangerLineY,
  visualRadius
) {
  const position = getBubbleRenderPosition(bubble, boardConfig);
  const radius = visualRadius ?? boardConfig.visualBubbleRadius ?? 25;
  const bubbleBottom = position.y + radius;
  return {
    centerY: position.y,
    visualRadius: radius,
    bubbleBottom,
    dangerLineY,
    crossed: bubbleBottom >= dangerLineY
  };
}

export function getDangerLineY(config) {
  return config.dangerLineY;
}

export function isBubbleAtDangerLine(bubble, config) {
  return getBoardBubbleDangerGeometry(
    bubble,
    config.board,
    getDangerLineY(config),
    getBoardVisualRadius(config)
  ).crossed;
}

export function checkGameOver(board, config) {
  return board.getOccupiedBubbles().some((bubble) => isBubbleAtDangerLine(bubble, config));
}

export function getDangerDistance(board, dangerLineY, bubbleRadius) {
  const lowestBubbleBottom = board.getOccupiedBubbles().reduce(
    (lowest, bubble) => Math.max(
      lowest,
      getBubbleWorldPosition(bubble, board.config).y + bubbleRadius
    ),
    Number.NEGATIVE_INFINITY
  );
  return Number.isFinite(lowestBubbleBottom)
    ? dangerLineY - lowestBubbleBottom
    : Number.POSITIVE_INFINITY;
}

export function getRefillRowsForPressure(board, config) {
  const distance = getDangerDistance(
    board,
    config.dangerLineY,
    getBoardVisualRadius(config)
  );
  if (distance <= 0) return 0;
  return Math.min(4, config.refillRowsPerTrigger ?? 4);
}

export class RefillSystem {
  constructor(board, colors, options = {}) {
    this.board = board;
    this.colors = colors;
    this.durationMs = options.durationMs ?? 320;
    this.active = false;
    this.elapsedMs = 0;
    this.rowIndex = 0;
    this.patternStage = 1;
    this.random = options.random ?? Math.random;
    this.rowsPerTrigger = options.rowsPerTrigger ?? 4;
    this.lastStartBlockedByDanger = false;
  }

  start(rowsPerTrigger = this.rowsPerTrigger, options = {}) {
    if (this.active) {
      return null;
    }

    const candidates = [rowsPerTrigger, ...(options.fallbackRows ?? [])]
      .filter((rows, index, all) => rows > 0 && all.indexOf(rows) === index);
    const snapshot = this.board.getOccupiedBubbles();
    this.lastStartBlockedByDanger = false;
    let result = null;
    let selectedRows = 0;
    for (const candidateRows of candidates) {
      const candidateRadius = options.bubbleRadius ?? 25;
      const projectedDanger = options.dangerLineY !== undefined && snapshot.some((bubble) => (
        getBoardBubbleDangerGeometry(
          { ...bubble, row: bubble.row + candidateRows },
          this.board.config,
          options.dangerLineY,
          candidateRadius
        ).crossed
      ));
      if (projectedDanger) {
        this.lastStartBlockedByDanger = true;
      }
      this.board.restoreBubbles(snapshot);
      const candidate = refillBoard(this.board, {
        colors: this.colors,
        rowIndex: this.rowIndex,
        patternStage: this.patternStage,
        rowsPerTrigger: candidateRows,
        random: this.random,
        dangerLineY: options.dangerLineY,
        bubbleRadius: options.bubbleRadius ?? 25
      });
      const safetyGap = options.dangerLineY !== undefined
        ? getDangerDistance(this.board, options.dangerLineY, options.bubbleRadius ?? 25)
        : Number.POSITIVE_INFINITY;
      const unsafe = options.dangerLineY !== undefined && (
        isDangerLineReached(this.board, options.dangerLineY, options.bubbleRadius ?? 25)
        || (options.minimumSafetyGap !== undefined && safetyGap < options.minimumSafetyGap)
      );
      if (candidate.success && !unsafe) {
        result = candidate;
        selectedRows = candidateRows;
        break;
      }
    }

    if (!result) {
      this.board.restoreBubbles(snapshot);
      return null;
    }

    this.rowIndex += selectedRows;
    this.lastRowsAdded = selectedRows;
    this.elapsedMs = 0;
    this.active = true;
    return result.bubbles;
  }

  setRowsPerTrigger(rows) {
    this.rowsPerTrigger = rows;
  }

  update(deltaMs) {
    if (!this.active) {
      return false;
    }

    this.elapsedMs += deltaMs;
    if (this.elapsedMs >= this.durationMs) {
      this.active = false;
    }

    return this.active;
  }

  isActive() {
    return this.active;
  }

  setPatternStage(stage) {
    this.patternStage = stage;
  }

  reset() {
    this.active = false;
    this.elapsedMs = 0;
    this.rowIndex = 0;
    this.patternStage = 1;
    this.lastStartBlockedByDanger = false;
  }
}
