import { getBubbleRenderPosition, getNeighbors } from './GridMath.js';
import { getBoardVisualRadius } from './config.js';

const EPSILON = 0.001;

function isNeighborCell(targetCell, originBubble, boardConfig) {
  return getNeighbors(originBubble.col, originBubble.row, boardConfig)
    .some(([col, row]) => col === targetCell.col && row === targetCell.row);
}

function isExactGridPosition(targetCell, expectedPosition) {
  return Math.abs((targetCell.x ?? expectedPosition.x) - expectedPosition.x) <= EPSILON
    && Math.abs((targetCell.y ?? expectedPosition.y) - expectedPosition.y) <= EPSILON;
}

export function commitLanding(
  activeShot,
  targetCell,
  board,
  gameConfig,
  { hitBubble = null, topLanding = false } = {}
) {
  if (!targetCell) {
    return { status: 'blocked', reason: 'NO_TARGET_CELL', bubble: null };
  }

  const { col, row } = targetCell;
  const boardConfig = gameConfig.board;
  if (!Number.isInteger(col) || !Number.isInteger(row)
    || !board.isWithinBounds(col, row) || board.isOccupied(col, row)) {
    return { status: 'rejected', reason: 'INVALID_OR_OCCUPIED_CELL', bubble: null };
  }

  const expectedPosition = getBubbleRenderPosition({ col, row }, boardConfig);
  if (!isExactGridPosition(targetCell, expectedPosition)) {
    return { status: 'rejected', reason: 'NOT_GRID_CENTER', bubble: null };
  }

  if (hitBubble && !isNeighborCell(targetCell, hitBubble, boardConfig)) {
    return { status: 'rejected', reason: 'NOT_LOCAL_LANDING_CANDIDATE', bubble: null };
  }

  if (topLanding && row !== 0) {
    return { status: 'rejected', reason: 'NOT_TOP_ROW', bubble: null };
  }

  const bubbleRadius = getBoardVisualRadius(gameConfig);
  const targetBottom = expectedPosition.y + bubbleRadius;
  if (targetBottom >= gameConfig.dangerLineY) {
    return {
      status: 'danger',
      reason: 'TARGET_TOUCHES_DANGER_LINE',
      targetCell: { col, row, ...expectedPosition },
      targetBottom,
      bubble: null
    };
  }

  const bubble = board.addGameplayBubble(col, row, activeShot.bubbleType, {
    dangerLineY: gameConfig.dangerLineY,
    bubbleRadius,
    rejectAtDanger: true
  });

  if (!bubble) {
    return { status: 'blocked', reason: 'BOARD_REJECTED_INSERT', bubble: null };
  }

  return {
    status: 'landed',
    reason: 'COMMITTED',
    targetCell: { col, row, ...expectedPosition },
    targetBottom,
    bubble
  };
}

export function isLandingCandidate(targetCell, board, gameConfig, options = {}) {
  if (!targetCell || !board.isWithinBounds(targetCell.col, targetCell.row)
    || board.isOccupied(targetCell.col, targetCell.row)) {
    return false;
  }

  const expectedPosition = getBubbleRenderPosition(targetCell, gameConfig.board);
  if (!isExactGridPosition(targetCell, expectedPosition)) return false;
  if (options.hitBubble && !isNeighborCell(targetCell, options.hitBubble, gameConfig.board)) return false;
  if (options.topLanding && targetCell.row !== 0) return false;
  return expectedPosition.y + getBoardVisualRadius(gameConfig) < gameConfig.dangerLineY;
}
