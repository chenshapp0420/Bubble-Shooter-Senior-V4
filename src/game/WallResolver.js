export function getWallBounds(gameConfig) {
  const visualRadius = gameConfig.physics.visualBubbleRadius;
  const visibleLeftWall = gameConfig.physics.physicsWallInset;
  const visibleRightWall = gameConfig.baseWidth - gameConfig.physics.physicsWallInset;

  return {
    visibleLeftWall,
    visibleRightWall,
    minX: visibleLeftWall + visualRadius,
    maxX: visibleRightWall - visualRadius,
    visualRadius
  };
}

export function resolveHorizontalWallCollision(x, velocityX, wallBounds) {
  const span = wallBounds.maxX - wallBounds.minX;
  if (span <= 0) {
    return { x: wallBounds.minX, velocityX: 0, bounceCount: 0 };
  }

  const period = span * 2;
  const normalized = ((x - wallBounds.minX) % period + period) % period;
  const reflected = normalized > span;
  const resolvedX = reflected
    ? wallBounds.maxX - (normalized - span)
    : wallBounds.minX + normalized;
  const crossedWall = x < wallBounds.minX || x > wallBounds.maxX;
  const crossings = crossedWall
    ? Math.max(
      1,
      Math.floor((x < wallBounds.minX
        ? wallBounds.minX - x
        : x - wallBounds.maxX) / span) + 1
    )
    : 0;
  const reflectedVelocity = x < wallBounds.minX
    ? (crossings % 2 ? Math.abs(velocityX) : -Math.abs(velocityX))
    : (crossings % 2 ? -Math.abs(velocityX) : Math.abs(velocityX));

  return {
    x: Math.max(wallBounds.minX, Math.min(wallBounds.maxX, resolvedX)),
    velocityX: crossedWall ? reflectedVelocity : velocityX,
    bounceCount: crossings
  };
}

export function isInsideVisibleWalls(x, visualRadius, wallBounds) {
  return x - visualRadius >= wallBounds.visibleLeftWall
    && x + visualRadius <= wallBounds.visibleRightWall;
}
