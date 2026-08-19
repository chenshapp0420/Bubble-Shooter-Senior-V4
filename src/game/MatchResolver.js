import { getNeighbors } from './GridMath.js';

function cellKey(col, row) {
  return `${col}:${row}`;
}

export function findConnectedSameColor(board, startCol, startRow) {
  const startBubble = board.getBubble(startCol, startRow);
  if (!startBubble) {
    return [];
  }

  const connected = [];
  const queue = [{ col: startCol, row: startRow }];
  const visited = new Set([cellKey(startCol, startRow)]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentBubble = board.getBubble(current.col, current.row);

    if (!currentBubble || currentBubble.bubbleType !== startBubble.bubbleType) {
      continue;
    }

    connected.push({
      col: current.col,
      row: current.row,
      bubbleType: currentBubble.bubbleType
    });

    getNeighbors(current.col, current.row, board.config).forEach(([col, row]) => {
      const key = cellKey(col, row);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ col, row });
      }
    });
  }

  return connected;
}

export function findFloatingBubbles(board) {
  const anchored = new Set();
  const queue = board
    .getOccupiedBubbles()
    .filter((bubble) => bubble.row === 0)
    .map((bubble) => ({ col: bubble.col, row: bubble.row }));

  queue.forEach(({ col, row }) => anchored.add(cellKey(col, row)));

  while (queue.length > 0) {
    const current = queue.shift();

    getNeighbors(current.col, current.row, board.config).forEach(([col, row]) => {
      const key = cellKey(col, row);
      if (board.isOccupied(col, row) && !anchored.has(key)) {
        anchored.add(key);
        queue.push({ col, row });
      }
    });
  }

  return board
    .getOccupiedBubbles()
    .filter((bubble) => !anchored.has(cellKey(bubble.col, bubble.row)))
    .map((bubble) => ({
      col: bubble.col,
      row: bubble.row,
      bubbleType: bubble.bubbleType
    }));
}

export function resolveAfterLanding(board, col, row) {
  const connected = findConnectedSameColor(board, col, row);

  if (connected.length < 3) {
    return { matched: [], floating: [] };
  }

  board.removeBubbles(connected);
  const floating = findFloatingBubbles(board);
  board.removeBubbles(floating);

  return { matched: connected, floating };
}
