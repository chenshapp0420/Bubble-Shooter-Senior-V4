export function gridToWorld(col, row, boardConfig) {
  const rowOffset = row % 2 === 1 ? boardConfig.cellWidth / 2 : 0;

  return {
    x: boardConfig.x + col * boardConfig.cellWidth + rowOffset,
    y: boardConfig.y + row * boardConfig.cellHeight
  };
}

export function getBubbleRenderPosition(bubble, boardConfig) {
  return gridToWorld(bubble.col, bubble.row, boardConfig);
}

export function getNeighbors(col, row, boardConfig) {
  const horizontalNeighbors = [
    [col - 1, row],
    [col + 1, row]
  ];
  const diagonalColumns = row % 2 === 0 ? [col - 1, col] : [col, col + 1];

  return [
    ...horizontalNeighbors,
    [diagonalColumns[0], row - 1],
    [diagonalColumns[1], row - 1],
    [diagonalColumns[0], row + 1],
    [diagonalColumns[1], row + 1]
  ].filter(([neighborCol, neighborRow]) => (
    neighborCol >= 0 &&
    neighborCol < boardConfig.columns &&
    neighborRow >= 0 &&
    neighborRow < boardConfig.rows
  ));
}
