export const SAME_NEIGHBOR_COLOR_WEIGHT = 0.58;
export const MAX_PREFERRED_CLUSTER_SIZE = 6;
export const MAX_PREFERRED_HORIZONTAL_RUN = 3;
export const HORIZONTAL_RUN_BREAKER_PROBABILITY = {
  atLimit: 0.7,
  overLimit: 0.9
};
export const PRIOR_NEIGHBOR_WEIGHTS = {
  left: 0.25,
  upperLeft: 0.35,
  upperRight: 0.4
};

function pickRandom(items, random) {
  return items[Math.floor(random() * items.length)];
}

function getPatternNeighbors(col, row, rows, columns) {
  const diagonalColumns = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
  return [
    [col - 1, row],
    [col + 1, row],
    [diagonalColumns[0], row - 1],
    [diagonalColumns[1], row - 1],
    [diagonalColumns[0], row + 1],
    [diagonalColumns[1], row + 1]
  ].filter(([neighborCol, neighborRow]) => (
    neighborCol >= 0 && neighborCol < columns
    && neighborRow >= 0 && neighborRow < rows
  ));
}

function getPriorNeighborEntries(col, row, rows, columns) {
  const diagonalColumns = row % 2 === 0 ? [col - 1, col] : [col, col + 1];
  return [
    { col: col - 1, row, weight: PRIOR_NEIGHBOR_WEIGHTS.left },
    { col: diagonalColumns[0], row: row - 1, weight: PRIOR_NEIGHBOR_WEIGHTS.upperLeft },
    { col: diagonalColumns[1], row: row - 1, weight: PRIOR_NEIGHBOR_WEIGHTS.upperRight }
  ].filter(({ col: neighborCol, row: neighborRow }) => (
    neighborCol >= 0 && neighborCol < columns
    && neighborRow >= 0 && neighborRow < rows
  ));
}

function pickWeightedNeighbor(entries, random) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * totalWeight;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.color;
  }
  return entries.at(-1).color;
}

function getHorizontalRunLength(cells, index, color, columns) {
  const row = Math.floor(index / columns);
  let start = index;
  while (start > row * columns && cells[start - 1] === color) start -= 1;
  let end = index;
  while (end < row * columns + columns - 1 && cells[end + 1] === color) end += 1;
  return end - start + 1;
}

function connectedGroupSize(cells, candidateIndex, candidateColor, rows, columns) {
  const startRow = Math.floor(candidateIndex / columns);
  const startCol = candidateIndex % columns;
  const pending = [[startCol, startRow]];
  const visited = new Set();
  let size = 0;

  while (pending.length > 0) {
    const [col, row] = pending.pop();
    const key = `${col}:${row}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const index = row * columns + col;
    const color = index === candidateIndex ? candidateColor : cells[index];
    if (color !== candidateColor) continue;
    size += 1;

    getPatternNeighbors(col, row, rows, columns).forEach(([nextCol, nextRow]) => {
      const nextIndex = nextRow * columns + nextCol;
      if (nextIndex === candidateIndex || cells[nextIndex] === candidateColor) {
        pending.push([nextCol, nextRow]);
      }
    });
  }

  return size;
}

function chooseBreakerColor({
  colors,
  availableColors,
  neighborColors,
  preferredColor,
  cells,
  index,
  rows,
  columns,
  random
}) {
  const alternatives = availableColors.filter((color) => color !== preferredColor);
  const nearbyOtherColors = neighborColors.filter((color, neighborIndex, list) => (
    color && color !== preferredColor && list.indexOf(color) === neighborIndex
  ));
  const supportingColors = nearbyOtherColors.filter((color) => alternatives.includes(color));
  const candidates = supportingColors.length > 0
    ? supportingColors
    : (alternatives.length > 0 ? alternatives : colors);

  // Prefer the least connected alternative, while retaining a small random
  // choice so breakers do not form a fixed visual rhythm.
  const scored = candidates.map((color) => ({
    color,
    groupSize: connectedGroupSize(cells, index, color, rows, columns)
  }));
  const smallestGroup = Math.min(...scored.map(({ groupSize }) => groupSize));
  const lowGroupCandidates = scored
    .filter(({ groupSize }) => groupSize <= smallestGroup + 1)
    .map(({ color }) => color);
  return pickRandom(lowGroupCandidates.length > 0 ? lowGroupCandidates : candidates, random);
}

export function generateBoardPattern({
  colors,
  rows,
  columns,
  patternStage = 1,
  random = Math.random,
  minimumPerColor = 5,
  maximumPerColor = Math.floor(rows * columns * 0.3),
  rowOffset = 0
}) {
  const cells = Array.from({ length: rows * columns }, () => null);
  const counts = new Map(colors.map((color) => [color, 0]));

  cells.forEach((_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const patternRow = row + rowOffset;
    const priorNeighborEntries = getPriorNeighborEntries(col, row, rows, columns)
      .map((entry) => ({
        ...entry,
        color: cells[entry.row * columns + entry.col]
      }))
      .filter((entry) => entry.color);
    const neighborColors = priorNeighborEntries.map(({ color }) => color);
    const neighborEntries = priorNeighborEntries
      .filter(({ color }) => counts.get(color) < maximumPerColor);
    const weightedNeighbors = neighborEntries;
    const availableColors = colors.filter((color) => counts.get(color) < maximumPerColor);
    const selectableColors = availableColors.length > 0 ? availableColors : colors;
    const useNeighbor = weightedNeighbors.length > 0
      && random() < (patternStage >= 3 ? SAME_NEIGHBOR_COLOR_WEIGHT - 0.03 : SAME_NEIGHBOR_COLOR_WEIGHT);
    let color = useNeighbor
      ? pickWeightedNeighbor(weightedNeighbors, random)
      : pickRandom(selectableColors, random);

    const preferredGroupSize = connectedGroupSize(cells, index, color, rows, columns);
    const clusterBreakerChance = preferredGroupSize >= MAX_PREFERRED_CLUSTER_SIZE + 1
      ? 0.86
      : preferredGroupSize >= MAX_PREFERRED_CLUSTER_SIZE - 1
        ? 0.44
        : 0;
    const horizontalRun = getHorizontalRunLength(cells, index, color, columns);
    const horizontalBreakerChance = horizontalRun >= MAX_PREFERRED_HORIZONTAL_RUN + 1
      ? HORIZONTAL_RUN_BREAKER_PROBABILITY.overLimit
      : horizontalRun === MAX_PREFERRED_HORIZONTAL_RUN
        ? HORIZONTAL_RUN_BREAKER_PROBABILITY.atLimit
        : 0;
    const breakerChance = Math.max(clusterBreakerChance, horizontalBreakerChance);
    if (breakerChance > 0 && random() < breakerChance) {
      color = chooseBreakerColor({
        colors,
        availableColors: selectableColors,
        neighborColors,
        preferredColor: color,
        cells,
        index,
        rows,
        columns,
        random
      });
    }

    // Keep a little row-to-row variation at later stages without creating a
    // second generator or a deterministic every-Nth-cell breaker pattern.
    if (patternStage >= 3 && patternRow % 2 === 1 && random() < 0.08) {
      const alternateColors = selectableColors.filter((candidate) => candidate !== color);
      if (alternateColors.length > 0) color = pickRandom(alternateColors, random);
    }

    cells[index] = color;
    counts.set(color, counts.get(color) + 1);
  });

  // Repair only distribution extremes; the weighted neighbor structure and
  // breaker decisions remain the dominant source of the final pattern.
  colors.forEach((color) => {
    while (counts.get(color) < minimumPerColor) {
      const donor = colors
        .filter((candidate) => counts.get(candidate) > minimumPerColor)
        .sort((first, second) => counts.get(second) - counts.get(first))[0];
      if (!donor) break;
      const donorIndex = cells.findIndex((cell) => cell === donor);
      cells[donorIndex] = color;
      counts.set(donor, counts.get(donor) - 1);
      counts.set(color, counts.get(color) + 1);
    }
  });

  return Array.from({ length: rows }, (_, row) => cells.slice(row * columns, (row + 1) * columns));
}

export function createClusteredRow(
  colors,
  rowIndex,
  columns,
  patternStage = 1,
  random = Math.random
) {
  return generateBoardPattern({
    colors,
    rows: 1,
    columns,
    patternStage,
    random,
    rowOffset: rowIndex,
    minimumPerColor: 0,
    maximumPerColor: Math.floor(columns * 0.6)
  })[0];
}

export function createClusteredBoardRows(colors, rows, columns, patternStage = 1, random = Math.random) {
  return generateBoardPattern({ colors, rows, columns, patternStage, random });
}
