export const GAME_CONFIG = {
  layoutMode: 'DESKTOP',
  touchAimZoneYStart: 350,
  touchAimOffsetY: 0,
  baseWidth: 900,
  baseHeight: 700,

  board: {
    x: 106,
    y: 25,
    columns: 14,
    rows: 11,
    cellWidth: 51,
    cellHeight: 50,
    initialFillRows: 9
  },

  shooter: {
    x: 450,
    y: 660,
    nextX: 520,
    nextY: 675,
    nextOutlineRadius: 22
  },

  hud: {
    safeAreaHeight: 40,
    score: { x: 55, baselineY: 649, fontSize: 16 },
    stage: { x: 55, baselineY: 678, fontSize: 16 },
    chances: { x: 890, baselineY: 14 }
  },

  colors: [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'fluorescentPink'
  ],

  specialBubbleChance: 0.08,

  missesBeforeRefill: 3,
  initialChances: 3,
  dangerLineY: 625,

  refillRowsPerTrigger: 4,

  lowBubbleThreshold: 35,
  extremeLowBubbleThreshold: 20,
  minimumDangerSafetyGap: 80,

  refill: {
    durationMs: 400,
    bubbleDelayMs: 80
  },

  physics: {
    bubbleSpeed: 18,
    visualBubbleRadius: 25,
    visualWallSafetyRadius: 25,
    physicsCollisionRadius: 23,
    collisionDiameter: 25,
    bubbleDiameter: 50,
    horizontalMargin: 40,
    physicsWallInset: 34,
    collisionContactTolerance: 0,
    totalBubbleColors: 7,
    minShootAngle: -175,
    maxShootAngle: -5
  }
};

export const PORTRAIT_PRESENTATION = {
  logicalWidth: 390,
  logicalHeight: 650,
  bubbleDiameter: 40.5,
  bottomSafetyClearance: 16,
  launcherInternalPadding: 16
};

export function getBoardVisualRadius(config) {
  return config.presentation?.bubbleRadius ?? config.physics.visualBubbleRadius;
}

export function getLayoutMode(viewportWidth, viewportHeight) {
  return viewportWidth <= 600 && viewportHeight > viewportWidth
    ? 'PORTRAIT_MOBILE'
    : 'DESKTOP';
}

export function getPortraitShooterGeometry({ width, height, dangerLineY, visualBubbleRadius }) {
  const currentRadius = visualBubbleRadius;
  const nextRadius = currentRadius * 0.82;
  const launcherBottomOffset = 25;
  const nextOutlineRadius = 19;
  const dangerSafetyGap = 17;
  const bottomSafeArea = 16;
  const horizontalSafeArea = 8;
  const dangerAnchoredCenterY = dangerLineY + dangerSafetyGap + currentRadius;
  // The danger line is the primary portrait anchor. The browser bottom edge
  // must never push the shooter down toward mobile browser chrome.
  const shooterY = dangerAnchoredCenterY;
  const nextGap = 12;
  const rightNextX = width / 2 + currentRadius + nextRadius + nextGap;
  const rightmostNextX = rightNextX + nextOutlineRadius;
  const nextX = rightmostNextX <= width - horizontalSafeArea
    ? rightNextX
    : width / 2 - currentRadius - nextRadius - nextGap;

  return {
    x: width / 2,
    y: shooterY,
    nextX,
    nextY: shooterY,
    nextOutlineRadius,
    currentRadius,
    nextRadius,
    launcherBottomOffset,
    dangerSafetyGap,
    bottomSafeArea,
    horizontalSafeArea
  };
}

export function getPortraitShooterGroupBounds(config, {
  canvasCssWidth,
  canvasCssHeight,
  visibleViewportHeight = canvasCssHeight,
  canvasLeft = 0,
  canvasTop = 0,
  safeAreaInsetBottom = 0,
  minimumVisibleGap = 16
}) {
  const scaleX = canvasCssWidth / config.baseWidth;
  const scaleY = canvasCssHeight / config.baseHeight;
  const radius = config.presentation?.bubbleRadius ?? config.physics.visualBubbleRadius;
  const nextRadius = radius * 0.82;
  const groupTop = Math.min(
    config.shooter.y - radius,
    config.shooter.nextY - config.shooter.nextOutlineRadius
  );
  const groupBottom = Math.max(
    config.shooter.y + radius,
    config.shooter.y + config.shooter.launcherBottomOffset,
    config.shooter.nextY + nextRadius,
    config.shooter.nextY + config.shooter.nextOutlineRadius
  );
  const renderedViewportBottom = Math.min(
    canvasTop + canvasCssHeight,
    visibleViewportHeight
  );
  const renderedShooterGroupTop = canvasTop + groupTop * scaleY;
  const renderedShooterGroupBottom = canvasTop + groupBottom * scaleY;
  const renderedDangerLineY = canvasTop + config.dangerLineY * scaleY;
  const bottomSafeGap = renderedViewportBottom
    - safeAreaInsetBottom
    - renderedShooterGroupBottom;

  return {
    scaleX,
    scaleY,
    renderedDangerLineY,
    renderedShooterGroupTop,
    renderedShooterGroupBottom,
    bottomSafeGap,
    minimumVisibleGap,
    belowDangerLine: renderedShooterGroupTop > renderedDangerLineY,
    bottomSafe: bottomSafeGap >= minimumVisibleGap,
    currentBubble: {
      left: canvasLeft + (config.shooter.x - radius) * scaleX,
      right: canvasLeft + (config.shooter.x + radius) * scaleX,
      top: canvasTop + (config.shooter.y - radius) * scaleY,
      bottom: canvasTop + (config.shooter.y + radius) * scaleY
    },
    nextBubble: {
      left: canvasLeft + (config.shooter.nextX - config.shooter.nextOutlineRadius) * scaleX,
      right: canvasLeft + (config.shooter.nextX + config.shooter.nextOutlineRadius) * scaleX,
      top: canvasTop + (config.shooter.nextY - config.shooter.nextOutlineRadius) * scaleY,
      bottom: canvasTop + (config.shooter.nextY + config.shooter.nextOutlineRadius) * scaleY
    }
  };
}

export function getRuntimeGameConfig(viewportWidth, viewportHeight) {
  if (getLayoutMode(viewportWidth, viewportHeight) === 'DESKTOP') {
    return GAME_CONFIG;
  }

  const availableWidth = Math.max(1, Math.floor(viewportWidth));
  const availableHeight = Math.max(1, Math.floor(viewportHeight));
  const width = PORTRAIT_PRESENTATION.logicalWidth;
  const height = PORTRAIT_PRESENTATION.logicalHeight;
  const scale = Math.min(
    availableWidth / width,
    Math.max(1, availableHeight - PORTRAIT_PRESENTATION.bottomSafetyClearance) / height
  );
  const cssWidth = Math.min(availableWidth, width * scale);
  const cssHeight = height * scale;
  const bubbleDiameter = 44;
  const presentationBubbleDiameter = PORTRAIT_PRESENTATION.bubbleDiameter;
  // Keep the presentation bubble diameter and grid pitch nearly identical so
  // adjacent portrait bubbles retain the dense MSN-style hex packing.
  const cellWidth = 40.5;
  const cellHeight = 35.1;
  const columns = 9;
  const boardWidth = (columns - 1) * cellWidth
    + presentationBubbleDiameter
    + cellWidth / 2;
  // Compact row pitch removes bubble gaps while this origin preserves the
  // established portrait danger threshold and row-11/row-12 semantics.
  const boardY = 140;
  const boardVisualRadius = presentationBubbleDiameter / 2;
  const physicsVisualRadius = bubbleDiameter / 2;
  const dangerLineY = boardY + 11 * cellHeight + boardVisualRadius + 10;
  const shooterGeometry = getPortraitShooterGeometry({
    width,
    height,
    dangerLineY,
    visualBubbleRadius: physicsVisualRadius
  });

  return {
    ...GAME_CONFIG,
    layoutMode: 'PORTRAIT_MOBILE',
    baseWidth: width,
    baseHeight: height,
    touchAimZoneYStart: height * 0.5,
    touchAimOffsetY: -55,
    presentation: {
      scale,
      cssWidth,
      cssHeight,
      cssTop: 0,
      availableWidth,
      availableHeight,
      bottomSafetyClearance: PORTRAIT_PRESENTATION.bottomSafetyClearance,
      launcherInternalPadding: PORTRAIT_PRESENTATION.launcherInternalPadding,
      bubbleDiameter: presentationBubbleDiameter,
      bubbleRadius: presentationBubbleDiameter / 2
    },
    board: {
      ...GAME_CONFIG.board,
      x: (width - boardWidth) / 2 + boardVisualRadius,
      y: boardY,
      columns,
      cellWidth,
      cellHeight,
      initialFillRows: 8
    },
    shooter: {
      ...GAME_CONFIG.shooter,
      x: shooterGeometry.x,
      y: shooterGeometry.y,
      nextX: shooterGeometry.nextX,
      nextY: shooterGeometry.nextY,
      nextOutlineRadius: shooterGeometry.nextOutlineRadius,
      bottomSafeArea: shooterGeometry.bottomSafeArea,
      horizontalSafeArea: shooterGeometry.horizontalSafeArea,
      launcherBottomOffset: shooterGeometry.launcherBottomOffset,
      dangerSafetyGap: shooterGeometry.dangerSafetyGap
    },
    hud: {
      ...GAME_CONFIG.hud,
      safeAreaHeight: 58,
      score: { x: 16, baselineY: 16, fontSize: 18 },
      stage: { x: width / 2 - 28, baselineY: 16, fontSize: 18 },
      chances: { x: width - 16, baselineY: 16, fontSize: 18 }
    },
    dangerLineY,
    physics: {
      ...GAME_CONFIG.physics,
      bubbleDiameter,
      visualBubbleRadius: physicsVisualRadius,
      visualWallSafetyRadius: physicsVisualRadius,
      physicsWallInset: Math.max(8, (width - boardWidth) / 2)
    }
  };
}
