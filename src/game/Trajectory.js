export function screenToGameCoordinates(clientX, clientY, canvas, gameConfig, bounds = null) {
  const canvasBounds = bounds ?? canvas.getBoundingClientRect();

  return {
    x: (clientX - canvasBounds.left) * (gameConfig.baseWidth / canvasBounds.width),
    y: (clientY - canvasBounds.top) * (gameConfig.baseHeight / canvasBounds.height)
  };
}

export function getShootAngle(origin, target, minAngle, maxAngle) {
  let angle = Math.atan2(target.y - origin.y, target.x - origin.x) * (180 / Math.PI);

  // Keep a pointer below-left from being interpreted as a downward angle on
  // the opposite side of the atan2 range.
  if (angle > 0 && target.x < origin.x) {
    angle -= 360;
  }

  return Math.max(minAngle, Math.min(maxAngle, angle));
}

export function getTrajectoryPlan(origin, target, wallBounds, topBoundary, minAngle, maxAngle) {
  const angle = getShootAngle(origin, target, minAngle, maxAngle);
  const points = getTrajectoryPoints(origin, angle, wallBounds, topBoundary);

  return {
    angle,
    points,
    mode: points.length > 2 ? 'REFLECTION' : 'DIRECT'
  };
}

export function getTrajectoryPoints(origin, angle, wallBounds, topBoundary, maxBounces = 4) {
  const angleRadians = angle * (Math.PI / 180);
  let directionX = Math.cos(angleRadians);
  let directionY = Math.sin(angleRadians);
  let current = { ...origin };
  const points = [{ ...current }];

  for (let bounce = 0; bounce <= maxBounces; bounce += 1) {
    const wallDistance = directionX > 0
      ? (wallBounds.maxX - current.x) / directionX
      : (wallBounds.minX - current.x) / directionX;
    const topDistance = directionY < 0
      ? (topBoundary - current.y) / directionY
      : Number.POSITIVE_INFINITY;
    const distanceToNextEvent = Math.min(wallDistance, topDistance);

    if (!Number.isFinite(distanceToNextEvent) || distanceToNextEvent <= 0) {
      break;
    }

    current = {
      x: current.x + directionX * distanceToNextEvent,
      y: current.y + directionY * distanceToNextEvent
    };
    points.push({ ...current });

    if (topDistance <= wallDistance) {
      break;
    }

    directionX *= -1;
  }

  return points;
}
