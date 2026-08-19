import { getNeighbors, gridToWorld } from './GridMath.js';

function distanceSquared(first, second) {
  const deltaX = first.x - second.x;
  const deltaY = first.y - second.y;
  return deltaX * deltaX + deltaY * deltaY;
}

function getClosestPointOnSegment(start, end, point) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return { x: start.x, y: start.y, t: 0 };
  }

  const projection = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));

  return {
    x: start.x + deltaX * t,
    y: start.y + deltaY * t,
    t
  };
}

function getCollisionThreshold(activeShot, gameConfig) {
  const boardRadius = gameConfig.physics.physicsCollisionRadius;
  const tolerance = gameConfig.physics.collisionContactTolerance ?? 0;
  return Math.max(0, activeShot.collisionRadius + boardRadius - tolerance);
}

function getMotionDirection(activeShot) {
  const velocity = activeShot.velocity;
  if (!velocity) {
    return null;
  }

  const speed = Math.hypot(velocity.x, velocity.y);
  return speed > 0 ? { x: velocity.x / speed, y: velocity.y / speed } : null;
}

export function classifyContact(activeShot, bubble, gameConfig) {
  const start = activeShot.previousPosition ?? activeShot;
  const closestPoint = getClosestPointOnSegment(start, activeShot, bubble);
  const threshold = getCollisionThreshold(activeShot, gameConfig);
  const distance = Math.sqrt(distanceSquared(closestPoint, bubble));
  const direction = getMotionDirection(activeShot);

  if (distance > threshold) {
    return 'none';
  }

  if (!direction) {
    return 'frontal';
  }

  const normalLength = Math.max(distance, 0.0001);
  const normal = {
    x: (closestPoint.x - bubble.x) / normalLength,
    y: (closestPoint.y - bubble.y) / normalLength
  };
  const approachAlignment = direction.x * normal.x + direction.y * normal.y;

  return approachAlignment <= -0.72 ? 'frontal' : 'glancing';
}

function getFreeCells(board, boardConfig) {
  const cells = [];
  for (let row = 0; row < boardConfig.rows; row += 1) {
    for (let col = 0; col < boardConfig.columns; col += 1) {
      if (!board.isOccupied(col, row)) {
        cells.push({ col, row, ...gridToWorld(col, row, boardConfig) });
      }
    }
  }
  return cells;
}

export function isReachableEmptyCell(activeShot, cell, board, boardConfig) {
  if (!cell || !board.isWithinBounds(cell.col, cell.row) || board.isOccupied(cell.col, cell.row)) {
    return false;
  }

  const direction = getMotionDirection(activeShot);
  if (!direction) {
    return false;
  }

  const start = activeShot.previousPosition ?? activeShot;
  const toCell = { x: cell.x - start.x, y: cell.y - start.y };
  const forwardDistance = toCell.x * direction.x + toCell.y * direction.y;
  if (forwardDistance <= 0 || forwardDistance > boardConfig.cellWidth * 3.5) {
    return false;
  }

  const lateralDistance = Math.abs(toCell.x * direction.y - toCell.y * direction.x);
  return lateralDistance <= activeShot.collisionRadius + 2;
}

export function scoreLandingCandidate(activeShot, cell) {
  const direction = getMotionDirection(activeShot);
  const distance = Math.hypot(cell.x - activeShot.x, cell.y - activeShot.y);
  const forwardScore = direction
    ? (cell.x - activeShot.x) * direction.x + (cell.y - activeShot.y) * direction.y
    : 0;

  return distance - forwardScore * 0.12;
}

export function findReachableLandingCells(activeShot, board, boardConfig, originBubble = null) {
  const candidates = originBubble
    ? getNeighbors(originBubble.col, originBubble.row, boardConfig)
      .filter(([col, row]) => !board.isOccupied(col, row))
      .map(([col, row]) => ({ col, row, ...gridToWorld(col, row, boardConfig) }))
    : getFreeCells(board, boardConfig);

  return candidates
    .filter((cell) => isReachableEmptyCell(activeShot, cell, board, boardConfig))
    .sort((first, second) => (
      scoreLandingCandidate(activeShot, first) - scoreLandingCandidate(activeShot, second)
    ));
}

export function findHitBubble(activeShot, board, gameConfig) {
  const collisionDistance = getCollisionThreshold(activeShot, gameConfig);
  const collisionDistanceSquared = collisionDistance * collisionDistance;
  const hasSegment = Boolean(activeShot.previousPosition);
  const start = activeShot.previousPosition ?? activeShot;
  let closestHit = null;
  let closestTime = Number.POSITIVE_INFINITY;

  board.getOccupiedBubbles().forEach((bubble) => {
    const closestPoint = getClosestPointOnSegment(start, activeShot, bubble);
    const currentDistanceSquared = distanceSquared(closestPoint, bubble);
    const isApproaching = (
      (bubble.x - start.x) * (activeShot.x - start.x) +
      (bubble.y - start.y) * (activeShot.y - start.y)
    ) > 0;

    const contactType = classifyContact(activeShot, bubble, gameConfig);
    const reachableCells = contactType === 'glancing'
      ? findReachableLandingCells(activeShot, board, gameConfig.board, bubble)
      : [];

    if (
      currentDistanceSquared <= collisionDistanceSquared &&
      (!hasSegment || closestPoint.t > 0 || isApproaching) &&
      closestPoint.t < closestTime &&
      !(contactType === 'glancing' && reachableCells.length > 0)
    ) {
      closestHit = bubble;
      closestTime = closestPoint.t;
    }
  });

  return closestHit;
}

function getAvailableNeighborCells(hitBubble, board, boardConfig) {
  return getNeighbors(hitBubble.col, hitBubble.row, boardConfig)
    .filter(([col, row]) => !board.isOccupied(col, row))
    .map(([col, row]) => ({
      col,
      row,
      ...gridToWorld(col, row, boardConfig)
    }));
}

function findNearestAvailableCell(cells, position, direction = null) {
  return cells.reduce((nearest, cell) => {
    if (!nearest) {
      return cell;
    }

    const cellDistance = direction ? scoreLandingCandidate({ ...position, velocity: direction }, cell) : distanceSquared(cell, position);
    const nearestDistance = direction ? scoreLandingCandidate({ ...position, velocity: direction }, nearest) : distanceSquared(nearest, position);
    const cellDirectionScore = direction
      ? (cell.x - position.x) * direction.x + (cell.y - position.y) * direction.y
      : 0;
    const nearestDirectionScore = direction
      ? (nearest.x - position.x) * direction.x + (nearest.y - position.y) * direction.y
      : 0;

    if (cellDistance < nearestDistance - 1 || (
      Math.abs(cellDistance - nearestDistance) <= 1 &&
      cellDirectionScore > nearestDirectionScore
    )) {
      return cell;
    }

    return nearest;
  }, null);
}

function getEntryDirection(activeShot, hitBubble) {
  const dx = (activeShot.previousPosition?.x ?? activeShot.x) - hitBubble.x;
  const dy = (activeShot.previousPosition?.y ?? activeShot.y) - hitBubble.y;
  const length = Math.hypot(dx, dy);

  return length > 0 ? { x: dx / length, y: dy / length } : null;
}

export function findLandingCell(activeShot, hitBubble, board, boardConfig) {
  const neighborCells = getAvailableNeighborCells(hitBubble, board, boardConfig);
  const neighborLanding = findNearestAvailableCell(
    neighborCells,
    activeShot,
    getEntryDirection(activeShot, hitBubble)
  );

  if (neighborLanding) {
    return neighborLanding;
  }

  // A surrounded hit is blocked. Never teleport to an unrelated cell on the
  // other side of the board; the caller safely ends this shot instead.
  return null;
}

export function findTopLandingCell(activeShot, board, boardConfig) {
  const freeCells = [];
  for (let col = 0; col < boardConfig.columns; col += 1) {
    if (!board.isOccupied(col, 0)) {
      freeCells.push({ col, row: 0, ...gridToWorld(col, 0, boardConfig) });
    }
  }

  return findNearestAvailableCell(freeCells, activeShot);
}
