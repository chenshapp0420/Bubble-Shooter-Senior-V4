import { gridToWorld } from './GridMath.js';
import { createClusteredBoardRows } from './BoardPattern.js';
import { chooseSpecialLabel, DEFAULT_SPECIAL_BUBBLE_CHANCE } from './SpecialBubbles.js';

export class Board {
  constructor(boardConfig, colors, options = {}) {
    this.config = boardConfig;
    this.colors = colors;
    this.random = options.random ?? Math.random;
    this.specialBubbleChance = options.specialBubbleChance ?? DEFAULT_SPECIAL_BUBBLE_CHANCE * 0;
    this.bubbles = [];
    this.createInitialBubbles();
  }

  createInitialBubbles(fillRows = this.config.initialFillRows, patternStage = 1) {
    const rows = createClusteredBoardRows(
      this.colors,
      fillRows,
      this.config.columns,
      patternStage,
      this.random
    );

    rows.forEach((rowBubbleTypes, row) => {
      rowBubbleTypes.forEach((bubbleType, col) => {
        this.addBubble(col, row, bubbleType);
      });
    });

    return this.bubbles;
  }

  reset(fillRows = this.config.initialFillRows, patternStage = 1) {
    this.bubbles = [];
    this.createInitialBubbles(fillRows, patternStage);
    return this.bubbles;
  }

  getBubbles() {
    return this.getOccupiedBubbles();
  }

  isWithinBounds(col, row) {
    return (
      col >= 0 &&
      col < this.config.columns &&
      row >= 0 &&
      row < this.config.rows
    );
  }

  isOccupied(col, row) {
    return this.bubbles.some((bubble) => bubble.col === col && bubble.row === row);
  }

  getBubble(col, row) {
    return this.bubbles.find((bubble) => bubble.col === col && bubble.row === row) ?? null;
  }

  addBubble(col, row, bubbleType, options = {}) {
    if (!this.isWithinBounds(col, row) || this.isOccupied(col, row)) {
      return null;
    }

    const position = gridToWorld(col, row, this.config);
    if (options.rejectAtDanger && options.dangerLineY !== undefined
      && position.y + (options.bubbleRadius ?? 25) >= options.dangerLineY) {
      options.onIllegalInsert?.({
        code: 'ILLEGAL_BOARD_INSERT_BELOW_DANGER',
        col,
        row,
        ...position,
        bubbleBottom: position.y + (options.bubbleRadius ?? 25),
        dangerLineY: options.dangerLineY
      });
      return null;
    }

    const specialLabel = options.specialLabel === undefined
      ? chooseSpecialLabel(this.random, this.specialBubbleChance)
      : options.specialLabel;
    const bubble = {
      col,
      row,
      bubbleType,
      ...position
    };

    if (specialLabel) {
      bubble.specialLabel = specialLabel;
    }

    this.bubbles.push(bubble);
    return bubble;
  }

  addGameplayBubble(col, row, bubbleType, options = {}) {
    const { dangerLineY, bubbleRadius = 25 } = options;
    if (dangerLineY === undefined) {
      return null;
    }
    return this.addBubble(col, row, bubbleType, {
      dangerLineY,
      bubbleRadius,
      rejectAtDanger: true,
      onIllegalInsert: options.onIllegalInsert
    });
  }

  removeBubble(col, row) {
    const previousLength = this.bubbles.length;
    this.bubbles = this.bubbles.filter((bubble) => (
      bubble.col !== col || bubble.row !== row
    ));

    return this.bubbles.length < previousLength;
  }

  removeBubbles(cells) {
    const cellsToRemove = new Set(cells.map(({ col, row }) => `${col}:${row}`));
    const previousLength = this.bubbles.length;
    this.bubbles = this.bubbles.filter((bubble) => (
      !cellsToRemove.has(`${bubble.col}:${bubble.row}`)
    ));

    return previousLength - this.bubbles.length;
  }

  shiftDownAndAddRow(rowBubbleTypes) {
    return this.shiftDownAndAddRows([rowBubbleTypes]);
  }

  shiftDownAndAddRows(rowsBubbleTypes, options = {}) {
    const rowCount = rowsBubbleTypes.length;
    if (rowCount === 0) {
      return null;
    }

    const { dangerLineY, bubbleRadius = 25 } = options;
    if (dangerLineY !== undefined && this.bubbles.some((bubble) => (
      gridToWorld(bubble.col, bubble.row + rowCount, this.config).y + bubbleRadius >= dangerLineY
    ))) {
      return null;
    }

    this.bubbles = this.bubbles.map((bubble) => {
      const row = bubble.row + rowCount;
      return {
        ...bubble,
        row,
        ...gridToWorld(bubble.col, row, this.config)
      };
    });

    const addedBubbles = rowsBubbleTypes.flatMap((rowBubbleTypes, row) => (
      rowBubbleTypes
        .slice(0, this.config.columns)
        .map((bubbleType, col) => (
          dangerLineY === undefined
            ? this.addBubble(col, row, bubbleType)
            : this.addGameplayBubble(col, row, bubbleType, { dangerLineY, bubbleRadius })
        ))
        .filter(Boolean)
    ));

    return addedBubbles;
  }

  getOccupiedBubbles() {
    return this.bubbles.slice();
  }

  restoreBubbles(bubbles) {
    this.bubbles = bubbles.map((bubble) => ({ ...bubble }));
    return this.bubbles;
  }

  isBoardCleared() {
    return this.bubbles.length === 0;
  }
}
