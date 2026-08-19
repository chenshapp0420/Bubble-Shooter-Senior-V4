import { getWallBounds, resolveHorizontalWallCollision } from './WallResolver.js';

export { getWallBounds } from './WallResolver.js';
export const resolveWallCollision = resolveHorizontalWallCollision;

export function createActiveShot(origin, angle, bubbleType, gameConfig) {
  const angleRadians = angle * (Math.PI / 180);
  const bubbleSpeed = gameConfig.physics.bubbleSpeed;

  return {
    x: origin.x,
    y: origin.y,
    velocity: {
      x: Math.cos(angleRadians) * bubbleSpeed,
      y: Math.sin(angleRadians) * bubbleSpeed
    },
    bubbleType,
    collisionRadius: gameConfig.physics.physicsCollisionRadius
  };
}

export function updateActiveShot(shot, gameConfig) {
  const { minX, maxX } = getWallBounds(gameConfig);
  shot.previousPosition = { x: shot.x, y: shot.y };
  shot.wallBounceCount = 0;

  shot.x += shot.velocity.x;
  shot.y += shot.velocity.y;

  const resolved = resolveWallCollision(shot.x, shot.velocity.x, { minX, maxX });
  shot.x = resolved.x;
  shot.velocity.x = resolved.velocityX;
  shot.wallBounceCount = resolved.bounceCount;

  return shot;
}

export function isAtTopBoundary(shot, gameConfig) {
  const topBoundary = gameConfig.board.y - shot.collisionRadius;
  return shot.y <= topBoundary;
}
