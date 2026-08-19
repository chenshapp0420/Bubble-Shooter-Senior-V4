export const MIN_TOUCH_DRAG_DISTANCE = 16;
export const DEFAULT_TOUCH_AIM_OFFSET_Y = -55;

export function getTouchAimZoneYStart(gameConfig) {
  return gameConfig.touchAimZoneYStart ?? gameConfig.baseHeight * 0.5;
}

export function getTouchAimTarget(point, gameConfig) {
  return {
    x: point.x,
    y: point.y + (gameConfig.touchAimOffsetY ?? DEFAULT_TOUCH_AIM_OFFSET_Y)
  };
}

export function hasTouchDragExceeded(startPoint, currentPoint, threshold = MIN_TOUCH_DRAG_DISTANCE) {
  return Math.hypot(
    currentPoint.x - startPoint.x,
    currentPoint.y - startPoint.y
  ) >= threshold;
}
