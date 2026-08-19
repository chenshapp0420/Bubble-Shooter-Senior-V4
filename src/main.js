import './styles.css';
import {
  getRuntimeGameConfig,
  getPortraitShooterGroupBounds,
  getBoardVisualRadius
} from './game/config.js';
import { Board } from './game/Board.js';
import { BubbleRenderer } from './game/BubbleRenderer.js';
import {
  createActiveShot,
  getWallBounds,
  isAtTopBoundary,
  updateActiveShot
} from './game/Physics.js';
import { isInsideVisibleWalls } from './game/WallResolver.js';
import { findHitBubble, findLandingCell, findTopLandingCell } from './game/Collision.js';
import { commitLanding } from './game/Landing.js';
import { resolveAfterLanding } from './game/MatchResolver.js';
import { EffectsManager } from './game/EffectsManager.js';
import { AudioManager, GAME_OVER_AUDIO_SOURCE } from './game/AudioManager.js';
import { GameOverAudio } from './game/GameOverAudio.js';
import { getBubbleRenderPosition } from './game/GridMath.js';
import { Shooter } from './game/Shooter.js';
import {
  checkGameOver,
  getBoardBubbleDangerGeometry,
  getDangerLineY,
  getDangerDistance,
  RefillSystem
} from './game/RefillSystem.js';
import { MissTracker } from './game/MissTracker.js';
import { ScoreManager } from './game/ScoreManager.js';
import { StageManager } from './game/StageManager.js';
import { CLEAR_DURATION_MS, renderClearCelebration } from './game/ClearCelebration.js';
import { isPointInRestartButton, renderGameOverOverlay } from './game/GameOverOverlay.js';
import { getLowBubbleRefillRows } from './game/LowBubbleRefill.js';
import { getUniqueSpecialBubbles } from './game/SpecialBubbles.js';
import { SPECIAL_BUBBLE_BONUS } from './game/ScoreManager.js';
import {
  getShootAngle,
  getTrajectoryPlan,
  getTrajectoryPoints,
  screenToGameCoordinates
} from './game/Trajectory.js';
import {
  getTouchAimTarget,
  getTouchAimZoneYStart,
  hasTouchDragExceeded
} from './game/TouchAim.js';

const FIXED_STEP_MS = 1000 / 60;
const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d');

if (!context) {
  throw new Error('Canvas 2D context is unavailable.');
}

function getCanvasCssSize() {
  const bounds = canvas.getBoundingClientRect();
  const borderX = parseFloat(getComputedStyle(canvas).borderLeftWidth)
    + parseFloat(getComputedStyle(canvas).borderRightWidth);
  const borderY = parseFloat(getComputedStyle(canvas).borderTopWidth)
    + parseFloat(getComputedStyle(canvas).borderBottomWidth);
  return {
    width: Math.max(1, canvas.clientWidth || bounds.width - borderX),
    height: Math.max(1, canvas.clientHeight || bounds.height - borderY)
  };
}

function getVisibleViewportSize() {
  const visualViewportWidth = window.visualViewport?.width;
  const visualViewportHeight = window.visualViewport?.height;
  const documentWidth = document.documentElement.clientWidth;
  const documentHeight = document.documentElement.clientHeight;
  const widthCandidates = [window.innerWidth, documentWidth, visualViewportWidth]
    .filter((value) => Number.isFinite(value) && value > 0);
  const heightCandidates = [window.innerHeight, documentHeight, visualViewportHeight]
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    width: Math.min(...widthCandidates),
    height: Math.min(...heightCandidates)
  };
}

const initialVisibleViewport = getVisibleViewportSize();
let GAME_CONFIG = getRuntimeGameConfig(
  initialVisibleViewport.width,
  initialVisibleViewport.height
);
const DEBUG_WALLS = false;
const DEBUG_DANGER = window.location.hostname === '127.0.0.1'
  || window.location.hostname === 'localhost';

const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors, {
  specialBubbleChance: GAME_CONFIG.specialBubbleChance
});
const bubbleRenderer = new BubbleRenderer(
  context,
  GAME_CONFIG.presentation?.bubbleDiameter ?? GAME_CONFIG.physics.bubbleDiameter
);
const shooter = new Shooter(GAME_CONFIG.shooter, bubbleRenderer, GAME_CONFIG.colors);
const effectsManager = new EffectsManager(GAME_CONFIG.board);
const audioManager = new AudioManager(1.0);
audioManager.bindGameOverAudio(new GameOverAudio(GAME_OVER_AUDIO_SOURCE));
const refillSystem = new RefillSystem(
  board,
  GAME_CONFIG.colors,
  { ...GAME_CONFIG.refill, rowsPerTrigger: GAME_CONFIG.refillRowsPerTrigger }
);
const missTracker = new MissTracker(GAME_CONFIG.missesBeforeRefill);
const scoreManager = new ScoreManager();
const stageManager = new StageManager(board);
const shooterOrigin = { x: GAME_CONFIG.shooter.x, y: GAME_CONFIG.shooter.y };
let wallBounds = getWallBounds(GAME_CONFIG);
let topBoundary = GAME_CONFIG.board.y - GAME_CONFIG.physics.physicsCollisionRadius;

let activeShot = null;
let aimTarget = { x: shooterOrigin.x, y: shooterOrigin.y - 240 };
let visualAimTarget = { ...aimTarget };
let aimAngle = -90;
let pointerIsDown = false;
let activePointerId = null;
let touchAimStart = null;
let cachedCanvasBounds = null;
let gameOver = false;
let roundClear = null;
let specialBonusPopups = [];
let previousTime = performance.now();
let accumulator = 0;
let lastDangerRuntimeLog = '';
let boardCountAtGameOver = null;
let gameSessionId = 0;
let lastGameOverCheck = { source: null, result: false };
let lastLandingGameOverCheck = null;
let lastRefillGameOverCheck = null;
let resolving = false;
let lastLandingResult = null;
let lastRefillResult = null;
let lastStateTransition = { event: 'INIT', at: performance.now() };
let lastDeadlockLog = '';

function recordStateTransition(event, details = {}) {
  lastStateTransition = { event, at: performance.now(), ...details };
}

function getShootBlockReason() {
  if (gameOver) return 'GAME_OVER';
  if (activeShot) return 'ACTIVE_SHOT';
  if (resolving) return 'RESOLVING';
  if (refillSystem.isActive()) return 'REFILL';
  // Pop/floating effects are cosmetic and do not lock the next shot.
  if (roundClear) return 'ROUND_CLEAR';
  if (activePointerId !== null && !pointerIsDown && !touchAimStart) return 'POINTER_STATE';
  return null;
}

function canShoot() {
  return getShootBlockReason() === null;
}

function getShootStateSnapshot() {
  const dangerState = getDangerDebugState();
  const animationCount = effectsManager.getActiveCount();
  const shootBlockReason = getShootBlockReason();
  return {
    gameOver,
    activeShot: activeShot ? {
      x: activeShot.x,
      y: activeShot.y,
      bubbleType: activeShot.bubbleType
    } : null,
    resolving,
    refill: {
      active: refillSystem.isActive(),
      inProgress: refillSystem.isActive(),
      elapsedMs: refillSystem.elapsedMs,
      durationMs: refillSystem.durationMs
    },
    animation: { active: animationCount > 0, count: animationCount },
    roundClear,
    pointerId: activePointerId,
    isAiming: pointerIsDown || activePointerId !== null || touchAimStart !== null,
    shooterEnabled: !gameOver && shootBlockReason === null,
    canShoot: shootBlockReason === null,
    shootBlockReason,
    boardBubbleCount: dangerState.bubbles.length,
    lowestBoardBubble: dangerState.lowestBubble,
    dangerLineY: dangerState.dangerLineY,
    lowestBubbleCrossedDanger: dangerState.crossed,
    lastLandingResult,
    lastRefillResult,
    lastStateTransition
  };
}

function assertPortraitRuntimeState() {
  const dangerState = getDangerDebugState();
  if (dangerState.crossed && !gameOver) {
    console.error('BOARD_DANGER_WITHOUT_GAMEOVER', getShootStateSnapshot());
    enterGameOver();
    return;
  }

  if (GAME_CONFIG.layoutMode !== 'PORTRAIT_MOBILE' || gameOver) return;
  const reason = getShootBlockReason();
  const staleTransient = reason === 'POINTER_STATE'
    || (reason === 'RESOLVING' && !activeShot && !refillSystem.isActive());
  if (staleTransient) {
    const snapshot = getShootStateSnapshot();
    const logKey = JSON.stringify({ reason, pointerId: activePointerId, event: lastStateTransition.event });
    if (logKey !== lastDeadlockLog) {
      lastDeadlockLog = logKey;
      console.error('PORTRAIT_SHOOTER_DEADLOCK', snapshot);
    }
    if (reason === 'POINTER_STATE') clearPointerAim();
    if (reason === 'RESOLVING') {
      resolving = false;
      recordStateTransition('STALE_RESOLUTION_CLEARED');
    }
  }
}

function getDevicePixelRatio() {
  return Math.max(1, window.devicePixelRatio || 1);
}

function refreshCanvasBounds() {
  const bounds = canvas.getBoundingClientRect();
  cachedCanvasBounds = {
    left: bounds.left,
    top: bounds.top,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height)
  };
}

function getGamePoint(clientX, clientY) {
  if (!cachedCanvasBounds) {
    refreshCanvasBounds();
  }
  return screenToGameCoordinates(clientX, clientY, canvas, GAME_CONFIG, cachedCanvasBounds);
}

function releasePointerCapture(pointerId) {
  if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
}

function clearPointerAim(pointerId = activePointerId) {
  pointerIsDown = false;
  releasePointerCapture(pointerId);
  activePointerId = null;
  touchAimStart = null;
}

function syncViewportLayout() {
  const viewport = getVisibleViewportSize();
  const nextConfig = getRuntimeGameConfig(viewport.width, viewport.height);
  if (nextConfig.layoutMode === 'PORTRAIT_MOBILE') {
    canvas.style.width = `${nextConfig.presentation.cssWidth}px`;
    canvas.style.height = `${nextConfig.presentation.cssHeight}px`;
  } else {
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
  }
  if (nextConfig.layoutMode === GAME_CONFIG.layoutMode
    && nextConfig.baseWidth === GAME_CONFIG.baseWidth
    && nextConfig.baseHeight === GAME_CONFIG.baseHeight
    && (nextConfig.presentation?.cssWidth ?? null) === (GAME_CONFIG.presentation?.cssWidth ?? null)
    && (nextConfig.presentation?.cssHeight ?? null) === (GAME_CONFIG.presentation?.cssHeight ?? null)) {
    return;
  }

  Object.assign(GAME_CONFIG, nextConfig);
  Object.assign(GAME_CONFIG.board, nextConfig.board);
  Object.assign(GAME_CONFIG.shooter, nextConfig.shooter);
  Object.assign(GAME_CONFIG.hud, nextConfig.hud);
  Object.assign(GAME_CONFIG.physics, nextConfig.physics);
  board.config = GAME_CONFIG.board;
  effectsManager.boardConfig = GAME_CONFIG.board;
  shooter.config = GAME_CONFIG.shooter;
  bubbleRenderer.radius = (
    GAME_CONFIG.presentation?.bubbleDiameter ?? GAME_CONFIG.physics.bubbleDiameter
  ) / 2;
  shooterOrigin.x = GAME_CONFIG.shooter.x;
  shooterOrigin.y = GAME_CONFIG.shooter.y;
  wallBounds = getWallBounds(GAME_CONFIG);
  topBoundary = GAME_CONFIG.board.y - GAME_CONFIG.physics.physicsCollisionRadius;
  aimTarget = { x: shooterOrigin.x, y: shooterOrigin.y - 240 };
  visualAimTarget = { ...aimTarget };
  refreshCanvasBounds();
}

function resizeCanvas() {
  const devicePixelRatio = getDevicePixelRatio();
  syncViewportLayout();
  refreshCanvasBounds();

  // Backing pixels follow display density; game coordinates follow the active layout.
  canvas.width = Math.round(GAME_CONFIG.baseWidth * devicePixelRatio);
  canvas.height = Math.round(GAME_CONFIG.baseHeight * devicePixelRatio);
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  renderScene();
}

function updateAim(clientX, clientY, applyTouchOffset = false) {
  const point = getGamePoint(clientX, clientY);
  visualAimTarget = applyTouchOffset ? getTouchAimTarget(point, GAME_CONFIG) : point;
  // Touch compensation is visual-only. Physics follows the actual target
  // under the finger so a vertical drag remains a direct vertical shot.
  aimTarget = point;
  aimAngle = getTrajectoryPlan(
    shooterOrigin,
    aimTarget,
    wallBounds,
    topBoundary,
    GAME_CONFIG.physics.minShootAngle,
    GAME_CONFIG.physics.maxShootAngle
  ).angle;
}

function handlePointerDown(event) {
  event.preventDefault();
  if (gameOver) {
    pointerIsDown = false;
    if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' && activePointerId === null) {
      activePointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    }
    return;
  }

  if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE') {
    if (activePointerId !== null) {
      return;
    }
    const point = getGamePoint(event.clientX, event.clientY);
    if (point.y < getTouchAimZoneYStart(GAME_CONFIG)) {
      return;
    }
    activePointerId = event.pointerId;
    touchAimStart = { x: event.clientX, y: event.clientY };
  }

  if (!canShoot()) {
    clearPointerAim();
    return;
  }

  audioManager.resume();
  pointerIsDown = true;
  canvas.setPointerCapture(event.pointerId);
  updateAim(
    event.clientX,
    event.clientY,
    GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
  );
}

function handlePointerMove(event) {
  event.preventDefault();
  if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' && event.pointerId !== activePointerId) {
    return;
  }
  updateAim(
    event.clientX,
    event.clientY,
    GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
  );
}

function handlePointerUp(event) {
  event.preventDefault();
  if (gameOver) {
    const point = getGamePoint(event.clientX, event.clientY);
    clearPointerAim(event.pointerId);
    if (isPointInRestartButton(point, GAME_CONFIG)) {
      restartGame();
    }
    return;
  }

  if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' && event.pointerId !== activePointerId) {
    return;
  }
  const touchDragExceeded = GAME_CONFIG.layoutMode !== 'PORTRAIT_MOBILE'
    || hasTouchDragExceeded(touchAimStart, { x: event.clientX, y: event.clientY });
  updateAim(event.clientX, event.clientY, GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE');
  pointerIsDown = false;
  releasePointerCapture(event.pointerId);

  if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE') {
    activePointerId = null;
    touchAimStart = null;
  }

  if (!touchDragExceeded) {
    return;
  }

  if (!activeShot) {
    if (!canShoot()) {
      return;
    }
    activeShot = createActiveShot(
      shooterOrigin,
      aimAngle,
      shooter.launchCurrentBubble(),
      GAME_CONFIG
    );
    recordStateTransition('SHOT_STARTED', { bubbleType: activeShot.bubbleType });
    audioManager.playShootMelody();
  }
}

function restartGame() {
  gameSessionId += 1;
  stageManager.reset();
  refillSystem.setPatternStage(stageManager.getStage());
  shooter.reset();
  effectsManager.clear();
  refillSystem.reset();
  activeShot = null;
  missTracker.reset();
  scoreManager.reset();
  audioManager.resetGameOverMusic();
  gameOver = false;
  boardCountAtGameOver = null;
  roundClear = null;
  specialBonusPopups = [];
  pointerIsDown = false;
  activePointerId = null;
  touchAimStart = null;
  lastDangerRuntimeLog = '';
  lastGameOverCheck = { source: null, result: false };
  lastLandingGameOverCheck = null;
  lastRefillGameOverCheck = null;
  resolving = false;
  lastLandingResult = null;
  lastRefillResult = null;
  lastDeadlockLog = '';
  recordStateTransition('RESTARTED');
  accumulator = 0;
  previousTime = performance.now();
  aimTarget = { x: shooterOrigin.x, y: shooterOrigin.y - 240 };
  visualAimTarget = { ...aimTarget };
  aimAngle = -90;
}

function enterGameOver() {
  if (gameOver) {
    return;
  }

  clearPointerAim();
  activeShot = null;
  resolving = false;
  roundClear = null;
  specialBonusPopups = [];
  gameOver = true;
  boardCountAtGameOver = board.getOccupiedBubbles().length;
  refillSystem.reset();
  recordStateTransition('GAME_OVER', { boardCount: boardCountAtGameOver });
  audioManager.playGameOverMusic();
}

function checkBoardGameOver(source) {
  const result = checkGameOver(board, GAME_CONFIG);
  lastGameOverCheck = { source, result };
  if (source.startsWith('landing')) {
    lastLandingGameOverCheck = { source, result };
  }
  if (source.startsWith('refill')) {
    lastRefillGameOverCheck = { source, result };
  }
  return result;
}

function getRenderedBubbleDiagnostics() {
  const dangerLineY = getDangerLineY(GAME_CONFIG);
  return bubbleRenderer.getDebugDraws()
    .map((draw) => {
      const boardOccupied = draw.row !== null && draw.col !== null
        ? board.isOccupied(draw.col, draw.row)
        : false;
      const boardGeometry = boardOccupied
        ? getBoardBubbleDangerGeometry(
          { row: draw.row, col: draw.col },
          GAME_CONFIG.board,
          dangerLineY,
          getBoardVisualRadius(GAME_CONFIG)
        )
        : null;
      return {
        source: draw.source,
        row: draw.row,
        col: draw.col,
        x: draw.x,
        y: draw.y,
        radius: boardGeometry?.visualRadius ?? draw.radius,
        bottom: boardGeometry?.bubbleBottom ?? draw.bottom,
        dangerLineY,
        crossed: boardGeometry?.crossed ?? draw.bottom >= dangerLineY,
        boardOccupied
      };
    })
    .sort((left, right) => right.bottom - left.bottom);
}

function getDangerDebugState() {
  const bubbles = board.getOccupiedBubbles().map((bubble) => {
    const position = getBubbleRenderPosition(bubble, GAME_CONFIG.board);
    const geometry = getBoardBubbleDangerGeometry(
      bubble,
      GAME_CONFIG.board,
      getDangerLineY(GAME_CONFIG),
      getBoardVisualRadius(GAME_CONFIG)
    );
    const bubbleBottom = geometry.bubbleBottom;
    return {
      col: bubble.col,
      row: bubble.row,
      storedX: bubble.x,
      storedY: bubble.y,
      renderX: position.x,
      renderY: position.y,
      visualRadius: geometry.visualRadius,
      bubbleBottom,
      dangerLineY: geometry.dangerLineY,
      crossed: geometry.crossed,
      renderPositionMatchesLogic: Math.abs((bubble.x ?? position.x) - position.x) < 0.001
        && Math.abs((bubble.y ?? position.y) - position.y) < 0.001
    };
  });
  const sortedBubbles = bubbles.sort((left, right) => right.bubbleBottom - left.bubbleBottom);
  const lowest = sortedBubbles[0] ?? null;
  return {
    dangerLineY: getDangerLineY(GAME_CONFIG),
    bubbles: sortedBubbles,
    lowestBubble: lowest,
    renderedBubbles: getRenderedBubbleDiagnostics(),
    gameOver,
    crossed: Boolean(lowest?.crossed),
    boardCountAtGameOver
  };
}

function getRenderedDangerGeometry(geometry) {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = bounds.width / GAME_CONFIG.baseWidth;
  const scaleY = bounds.height / GAME_CONFIG.baseHeight;
  return {
    centerY: bounds.top + geometry.centerY * scaleY,
    bubbleBottom: bounds.top + geometry.bubbleBottom * scaleY,
    dangerLineY: bounds.top + geometry.dangerLineY * scaleY,
    scaleX,
    scaleY,
    crossed: geometry.bubbleBottom * scaleY >= geometry.dangerLineY * scaleY
  };
}

const isLocalDevelopmentHost = window.location.hostname === '127.0.0.1'
  || window.location.hostname === 'localhost';
const isPreviewHost = window.location.hostname.endsWith('.vercel.app');
const DEBUG_RUNTIME = import.meta.env.DEV || isLocalDevelopmentHost || isPreviewHost;

if (DEBUG_RUNTIME) {
  window.__debugLayoutState = () => ({
    layoutMode: GAME_CONFIG.layoutMode,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    canvasCss: (() => {
      const bounds = canvas.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    })(),
    viewportMetrics: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualViewportHeight: window.visualViewport?.height ?? null,
      visualViewportOffsetTop: window.visualViewport?.offsetTop ?? null,
      visibleViewport: getVisibleViewportSize(),
      devicePixelRatio: getDevicePixelRatio()
    },
    game: {
      width: GAME_CONFIG.baseWidth,
      height: GAME_CONFIG.baseHeight,
      board: { ...GAME_CONFIG.board },
      bubbleDiameter: GAME_CONFIG.physics.bubbleDiameter,
      dangerLineY: GAME_CONFIG.dangerLineY,
      shooter: { ...GAME_CONFIG.shooter },
      renderedShooterGroup: GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
        ? getPortraitShooterGroupBounds(GAME_CONFIG, {
          canvasCssWidth: canvas.getBoundingClientRect().width,
          canvasCssHeight: canvas.getBoundingClientRect().height,
          visibleViewportHeight: window.visualViewport?.height ?? window.innerHeight,
          canvasLeft: canvas.getBoundingClientRect().left,
          canvasTop: canvas.getBoundingClientRect().top,
          safeAreaInsetBottom: 0
        })
        : null
    }
  });
  window.__debugDangerState = () => {
    const state = getDangerDebugState();
    console.info('[DANGER RUNTIME]', state);
    return state;
  };
  window.__debugPortraitGameOver = () => {
    const diagnostics = board.getOccupiedBubbles()
      .map((bubble) => {
        const geometry = getBoardBubbleDangerGeometry(
          bubble,
          GAME_CONFIG.board,
          getDangerLineY(GAME_CONFIG),
          getBoardVisualRadius(GAME_CONFIG)
        );
        return {
          row: bubble.row,
          col: bubble.col,
          logical: geometry,
          rendered: getRenderedDangerGeometry(geometry),
          crossedLogicalDanger: geometry.crossed,
          crossedRenderedDanger: getRenderedDangerGeometry(geometry).crossed
        };
      })
      .sort((left, right) => right.logical.bubbleBottom - left.logical.bubbleBottom);
    const lowest = diagnostics[0] ?? null;
    return {
      portraitMode: GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE',
      gameOver,
      dangerLineY: getDangerLineY(GAME_CONFIG),
      renderedDangerLineY: getRenderedDangerGeometry({
        centerY: 0,
        bubbleBottom: 0,
        dangerLineY: getDangerLineY(GAME_CONFIG)
      }).dangerLineY,
      boardBubbleCount: board.getOccupiedBubbles().length,
      lowestBoardBubble: lowest,
      activeShot: activeShot ? { x: activeShot.x, y: activeShot.y } : null,
      shooterLocked: getShootBlockReason() !== null,
      input: { pointerIsDown, activePointerId, touchAimStart },
      lastLandingGameOverCheck,
      lastRefillGameOverCheck,
      lastGameOverCheck
    };
  };
  window.__debugShootState = () => getShootStateSnapshot();
  window.__debugSafeState = () => {
    const state = getDangerDebugState();
    console.info('[DANGER DEBUG SAFE]', state);
    return state;
  };
  window.__debugAllRenderedBubbles = () => {
    const diagnostics = getRenderedBubbleDiagnostics();
    console.info('[DANGER RENDERED BUBBLES]', diagnostics);
    return diagnostics;
  };
  window.__forceDangerTouch = () => {
    const bubbles = board.getOccupiedBubbles();
    board.removeBubbles(bubbles);
    const bubble = board.addBubble(0, 0, 'red');
    if (!bubble) return null;
    bubble.row = (getDangerLineY(GAME_CONFIG) - GAME_CONFIG.board.y - getBoardVisualRadius(GAME_CONFIG))
      / GAME_CONFIG.board.cellHeight;
    const position = getBubbleRenderPosition(bubble, GAME_CONFIG.board);
    bubble.x = position.x;
    bubble.y = position.y;
    renderScene();
    return getDangerDebugState();
  };
  window.__forceDangerExactTouch = window.__forceDangerTouch;
  window.__forceDangerSafe = () => {
    const bubbles = board.getOccupiedBubbles();
    board.removeBubbles(bubbles);
    const bubble = board.addBubble(0, 0, 'red');
    if (!bubble) return null;
    bubble.row = (getDangerLineY(GAME_CONFIG) - GAME_CONFIG.board.y - getBoardVisualRadius(GAME_CONFIG) - 1)
      / GAME_CONFIG.board.cellHeight;
    const position = getBubbleRenderPosition(bubble, GAME_CONFIG.board);
    bubble.x = position.x;
    bubble.y = position.y;
    gameOver = false;
    activeShot = null;
    audioManager.resetGameOverMusic();
    renderScene();
    return getDangerDebugState();
  };
  window.__forceDangerOnePixelSafe = window.__forceDangerSafe;
}

function handlePointerCancel(event) {
  if (GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' && event.pointerId !== activePointerId) {
    return;
  }
  clearPointerAim(event.pointerId);
}

function handleLostPointerCapture(event) {
  if (event.pointerId === activePointerId) {
    clearPointerAim(null);
  }
}

function drawBackground() {
  const background = context.createLinearGradient(0, 0, 0, GAME_CONFIG.baseHeight);
  background.addColorStop(0, '#eadfc7');
  background.addColorStop(0.56, '#d8d1bc');
  background.addColorStop(1, '#b7b69f');
  context.fillStyle = background;
  context.fillRect(0, 0, GAME_CONFIG.baseWidth, GAME_CONFIG.baseHeight);

  context.save();
  context.globalAlpha = 0.26;
  context.fillStyle = '#f7f1df';
  for (let y = 0; y < GAME_CONFIG.baseHeight; y += 18) {
    context.fillRect(0, y, GAME_CONFIG.baseWidth, 1);
  }
  context.globalAlpha = 0.22;
  context.fillStyle = '#87907a';
  context.beginPath();
  context.moveTo(0, 240);
  context.quadraticCurveTo(150, 130, 310, 245);
  context.quadraticCurveTo(470, 95, 690, 250);
  context.quadraticCurveTo(800, 165, 900, 225);
  context.lineTo(900, 380);
  context.lineTo(0, 380);
  context.closePath();
  context.fill();
  context.globalAlpha = 0.18;
  context.fillStyle = '#596b5d';
  context.beginPath();
  context.moveTo(0, 320);
  context.quadraticCurveTo(190, 225, 390, 335);
  context.quadraticCurveTo(590, 215, 900, 330);
  context.lineTo(900, 480);
  context.lineTo(0, 480);
  context.closePath();
  context.fill();
  context.globalAlpha = 0.34;
  context.fillStyle = '#fff6d9';
  context.beginPath();
  context.arc(760, 112, 46, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(61, 78, 55, 0.35)';
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(24, 0);
  context.quadraticCurveTo(42, 150, 28, 330);
  context.moveTo(75, 0);
  context.quadraticCurveTo(55, 170, 80, 385);
  context.stroke();
  context.lineWidth = 2;
  for (let y = 64; y < 380; y += 54) {
    context.beginPath();
    context.moveTo(28, y);
    context.lineTo(65, y - 20);
    context.moveTo(50, y + 18);
    context.lineTo(88, y - 4);
    context.stroke();
  }
  context.restore();

  const centerX = GAME_CONFIG.baseWidth / 2;
  const centerY = GAME_CONFIG.baseHeight * 0.4;
  const arenaGlow = context.createRadialGradient(centerX, centerY, 80, centerX, centerY, Math.max(300, GAME_CONFIG.baseWidth * 0.52));
  arenaGlow.addColorStop(0, 'rgba(255, 251, 231, 0.28)');
  arenaGlow.addColorStop(0.7, 'rgba(255, 250, 228, 0.08)');
  arenaGlow.addColorStop(1, 'rgba(109, 110, 89, 0)');
  context.fillStyle = arenaGlow;
  context.fillRect(0, 55, GAME_CONFIG.baseWidth, Math.max(0, GAME_CONFIG.baseHeight - 55));

  context.strokeStyle = 'rgba(83, 94, 72, 0.22)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(wallBounds.visibleLeftWall, 55);
  context.lineTo(wallBounds.visibleLeftWall, GAME_CONFIG.baseHeight - 35);
  context.moveTo(wallBounds.visibleRightWall, 55);
  context.lineTo(wallBounds.visibleRightWall, GAME_CONFIG.baseHeight - 35);
  context.stroke();

  // The raised opening board owns the upper visual field; the compact HUD
  // below is the only text kept above it so the first bubble row stays clear.
}

function drawScoreHud() {
  const { chances } = missTracker.getState();
  const filledChances = String.fromCodePoint(9679).repeat(chances);
  const emptyChances = String.fromCodePoint(9675).repeat(GAME_CONFIG.initialChances - chances);

  context.save();
  const chanceWarning = chances === 1;
  const warningPulse = chanceWarning ? 0.78 + Math.sin(performance.now() / 110) * 0.22 : 1;
  context.globalAlpha = warningPulse;
  context.fillStyle = chanceWarning ? '#ffd36a' : 'rgba(226, 242, 255, 0.84)';
  context.font = `700 ${GAME_CONFIG.hud.score.fontSize}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(`得分 ${scoreManager.getDisplayScore()}分`, GAME_CONFIG.hud.score.x, GAME_CONFIG.hud.score.baselineY);
  context.font = `700 ${GAME_CONFIG.hud.stage.fontSize}px system-ui, sans-serif`;
  context.fillText(`STAGE ${stageManager.getStage()}`, GAME_CONFIG.hud.stage.x, GAME_CONFIG.hud.stage.baselineY);
  context.font = '700 12px system-ui, sans-serif';
  context.textAlign = 'right';
  context.fillText(`CHANCES  ${filledChances}${emptyChances}`, GAME_CONFIG.hud.chances.x, GAME_CONFIG.hud.chances.baselineY);
  context.restore();
}

function drawHud() {
  const { chances } = missTracker.getState();
  const filledChances = '●'.repeat(chances);
  const emptyChances = '○'.repeat(GAME_CONFIG.initialChances - chances);

  context.save();
  context.fillStyle = 'rgba(226, 242, 255, 0.84)';
  context.font = '700 19px system-ui, sans-serif';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(`CHANCES  ${filledChances}${emptyChances}`, 54, 52);
  context.restore();
}

function drawDangerLine() {
  const dangerLineY = getDangerLineY(GAME_CONFIG);
  const dangerDistance = getDangerDistance(
    board,
    dangerLineY,
    getBoardVisualRadius(GAME_CONFIG)
  );
  const dangerPulse = dangerDistance <= 50
    ? 0.62 + Math.sin(performance.now() / 130) * 0.2
    : 1;

  context.save();
  context.strokeStyle = dangerDistance <= 100
    ? `rgba(255, 82, 82, ${0.62 * dangerPulse})`
    : 'rgba(255, 103, 103, 0.48)';
  context.lineWidth = dangerDistance <= 50 ? 3 : 2;
  context.setLineDash([8, 8]);
  context.beginPath();
  context.moveTo(wallBounds.visibleLeftWall, dangerLineY);
  context.lineTo(wallBounds.visibleRightWall, dangerLineY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(255, 166, 166, 0.68)';
  context.font = '600 13px system-ui, sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.fillText('DANGER', wallBounds.visibleRightWall - 8, dangerLineY - 7);
  context.restore();
}

function drawGameOverLegacy() {
  if (!gameOver) {
    return;
  }

  context.save();
  context.fillStyle = 'rgba(3, 9, 20, 0.74)';
  context.fillRect(42, 300, 556, 230);
  context.strokeStyle = 'rgba(255, 134, 134, 0.72)';
  context.lineWidth = 2;
  context.strokeRect(42, 300, 556, 230);
  context.fillStyle = '#fff1f1';
  context.font = '700 38px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('遊戲結束', GAME_CONFIG.baseWidth / 2, 375);
  context.fillStyle = '#ffffff';
  context.font = '700 30px system-ui, sans-serif';
  context.fillText(`得分 ${scoreManager.getDisplayScore()}分`, GAME_CONFIG.baseWidth / 2, 420);
  context.fillStyle = '#ffd2d2';
  context.font = '600 18px system-ui, sans-serif';
  context.fillText('泡泡已越過危險線', GAME_CONFIG.baseWidth / 2, 425);
  context.fillStyle = '#e4f3ff';
  context.fillRect(220, 450, 200, 52);
  context.strokeStyle = 'rgba(221, 242, 255, 0.76)';
  context.strokeRect(220, 450, 200, 52);
  context.fillStyle = '#12304d';
  context.font = '700 17px system-ui, sans-serif';
  context.fillText('再玩一次！加油！', GAME_CONFIG.baseWidth / 2, 476);
  context.restore();
}

function drawGameOver() {
  if (!gameOver) return;
  renderGameOverOverlay(context, GAME_CONFIG, {
    score: scoreManager.getDisplayScore(),
    stage: stageManager.getStage()
  });
}

function checkDangerLineAgainstRenderedGeometry() {
  const state = getDangerDebugState();
  const rendered = getRenderedBubbleDiagnostics();
  rendered.filter((bubble) => bubble.crossed).forEach((bubble) => {
    if (DEBUG_DANGER) {
      console.info('[DANGER TOUCH]', bubble);
    }
    if (bubble.source === 'BOARD' && !gameOver) {
      console.error('PORTRAIT_GAMEOVER_INVARIANT_VIOLATION', bubble);
      enterGameOver();
    }
  });
  if (state.crossed && !gameOver) {
    enterGameOver();
  }
  if (DEBUG_DANGER && state.crossed) {
    const logKey = `${state.lowestBubble?.row}:${state.lowestBubble?.col}:${gameOver}`;
    if (logKey !== lastDangerRuntimeLog) {
      lastDangerRuntimeLog = logKey;
      console.info('[DANGER RUNTIME]', state);
    }
  }
  return state.crossed;
}

function drawDangerDebugOverlay(state) {
  const boardBubble = state.lowestBubble;
  if (!boardBubble) return;

  context.save();
  context.strokeStyle = '#ff4f5e';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(boardBubble.renderX, boardBubble.renderY, boardBubble.visualRadius + 4, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#ff7882';
  context.font = '700 14px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('DANGER HIT', boardBubble.renderX, boardBubble.renderY - boardBubble.visualRadius - 10);
  context.restore();
}

function drawRoundClear() {
  if (roundClear) {
    renderClearCelebration(context, GAME_CONFIG, roundClear);
  }
}

function drawBoardArea() {
  const { x, y, columns, cellWidth, initialFillRows, cellHeight } = GAME_CONFIG.board;
  const renderedBubbleDiameter = GAME_CONFIG.presentation?.bubbleDiameter
    ?? GAME_CONFIG.physics.bubbleDiameter;
  const boardWidth = (columns - 1) * cellWidth + renderedBubbleDiameter + cellWidth / 2;
  const boardHeight = (initialFillRows - 1) * cellHeight + renderedBubbleDiameter;
  const boardGlow = context.createRadialGradient(
    x + boardWidth / 2,
    y + boardHeight / 2,
    20,
    x + boardWidth / 2,
    y + boardHeight / 2,
    boardWidth * 0.72
  );

  boardGlow.addColorStop(0, 'rgba(255, 250, 225, 0.26)');
  boardGlow.addColorStop(1, 'rgba(255, 250, 225, 0)');
  context.fillStyle = boardGlow;
  context.fillRect(x - 32, y - 30, boardWidth + 12, boardHeight + 60);
}

function drawTrajectory() {
  if (activeShot) {
    return;
  }

  const trajectoryPlan = getTrajectoryPlan(
    shooterOrigin,
    aimTarget,
    wallBounds,
    topBoundary,
    GAME_CONFIG.physics.minShootAngle,
    GAME_CONFIG.physics.maxShootAngle
  );
  const points = trajectoryPlan.points;

  context.save();
  context.strokeStyle = pointerIsDown
    ? GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
      ? 'rgba(216, 239, 255, 0.94)'
      : 'rgba(216, 239, 255, 0.72)'
    : GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
      ? 'rgba(173, 213, 244, 0.58)'
      : 'rgba(173, 213, 244, 0.42)';
  context.lineWidth = GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' ? 2.6 : 2;
  context.setLineDash(GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE' ? [5, 9] : [4, 10]);
  context.lineCap = 'round';
  context.beginPath();
  const startPoint = GAME_CONFIG.layoutMode === 'PORTRAIT_MOBILE'
    ? {
      x: points[0].x + Math.cos(trajectoryPlan.angle * Math.PI / 180) * GAME_CONFIG.physics.visualBubbleRadius,
      y: points[0].y + Math.sin(trajectoryPlan.angle * Math.PI / 180) * GAME_CONFIG.physics.visualBubbleRadius
    }
    : points[0];
  context.moveTo(startPoint.x, startPoint.y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.stroke();
  context.restore();
}

function drawBoard() {
  if (refillSystem.isActive()) {
    return;
  }
  board.getBubbles().forEach((bubble) => {
    const position = getBubbleRenderPosition(bubble, GAME_CONFIG.board);
    bubbleRenderer.drawBubble(position.x, position.y, bubble.bubbleType, 1, {
      id: `board-${bubble.col}-${bubble.row}`,
      row: bubble.row,
      col: bubble.col,
      specialLabel: bubble.specialLabel,
      source: 'BOARD'
    });
  });
}

function drawActiveShot() {
  if (activeShot) {
    const visualRadius = GAME_CONFIG.physics.visualBubbleRadius;
    if (!isInsideVisibleWalls(activeShot.x, visualRadius, wallBounds)) {
      console.error('WALL_INVARIANT_VIOLATION', {
        x: activeShot.x,
        vx: activeShot.velocity.x,
        minCenterX: wallBounds.minX,
        maxCenterX: wallBounds.maxX,
        angle: aimAngle,
        previousX: activeShot.previousPosition?.x,
        currentX: activeShot.x
      });
    }
    bubbleRenderer.drawBubble(activeShot.x, activeShot.y, activeShot.bubbleType, 1, {
      source: 'ACTIVE_SHOT'
    });
  }
}

function drawSpecialBonusPopups() {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  specialBonusPopups.forEach((popup) => {
    const progress = Math.min(1, popup.elapsedMs / 850);
    context.globalAlpha = 1 - progress;
    context.fillStyle = '#73551b';
    context.font = '800 22px system-ui, sans-serif';
    context.fillText(`+${SPECIAL_BUBBLE_BONUS}`, popup.x, popup.y - progress * 34);
  });
  context.restore();
}

function drawDebugWalls() {
  if (!DEBUG_WALLS) return;
  context.save();
  context.setLineDash([3, 6]);
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  [wallBounds.visibleLeftWall, wallBounds.visibleRightWall, wallBounds.minX, wallBounds.maxX]
    .forEach((x) => {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, GAME_CONFIG.baseHeight);
      context.stroke();
    });
  context.restore();
}

function renderScene() {
  bubbleRenderer.beginFrame();
  drawBackground();
  drawDebugWalls();
  drawScoreHud();
  drawDangerLine();
  drawBoardArea();
  drawTrajectory();
  drawBoard();
  shooter.draw(context);
  drawActiveShot();
  effectsManager.render(context, bubbleRenderer);
  drawSpecialBonusPopups();
  drawRoundClear();
  const dangerState = checkDangerLineAgainstRenderedGeometry();
  if (DEBUG_DANGER && dangerState) {
    drawDangerDebugOverlay(getDangerDebugState());
  }
  drawGameOver();
}

function startRefill(rows = refillSystem.rowsPerTrigger, options = {}) {
  if (gameOver) {
    lastRefillResult = { status: 'cancelled', reason: 'GAME_OVER' };
    return;
  }

  const beforeBubbles = board.getOccupiedBubbles();
  const fallbackRows = rows >= 4 ? [3, 2] : rows >= 3 ? [2] : [];
  const newBubbles = refillSystem.start(rows, {
    fallbackRows,
    dangerLineY: GAME_CONFIG.dangerLineY,
    bubbleRadius: getBoardVisualRadius(GAME_CONFIG),
    minimumSafetyGap: options.minimumSafetyGap
  });

  if (!newBubbles) {
    if (refillSystem.lastStartBlockedByDanger || checkBoardGameOver('refill-failed')) {
      lastRefillResult = { status: 'danger', rows };
      recordStateTransition('REFILL_DANGER', lastRefillResult);
      enterGameOver();
      return;
    }
    if (options.resetChances === false) {
      refillSystem.reset();
      lastRefillResult = { status: 'cancelled', reason: 'NO_SAFE_NONFATAL_REFILL', rows };
      recordStateTransition('REFILL_CANCELLED', lastRefillResult);
      return;
    }
    lastRefillResult = { status: 'failed', rows };
    recordStateTransition('REFILL_FAILED', lastRefillResult);
    enterGameOver();
    return;
  }

  if (options.resetChances !== false) missTracker.reset();
  effectsManager.queueRefill(
    beforeBubbles,
    board.getOccupiedBubbles(),
    GAME_CONFIG.refill.durationMs,
    refillSystem.lastRowsAdded ?? GAME_CONFIG.refillRowsPerTrigger
  );
  audioManager.playRefillMusic();
  lastRefillResult = {
    status: 'started',
    rows: refillSystem.lastRowsAdded ?? rows,
    bubbleCount: newBubbles.length
  };
  recordStateTransition('REFILL_STARTED', lastRefillResult);

  if (checkBoardGameOver('refill-complete')) {
    lastRefillResult = { ...lastRefillResult, status: 'danger-after-refill' };
    enterGameOver();
  }
}

function updatePhysics() {
  if (gameOver || roundClear) {
    return;
  }
  if (checkBoardGameOver('frame-before-shot')) {
    enterGameOver();
    return;
  }
  if (activeShot) {
    activeShot = updateActiveShot(activeShot, GAME_CONFIG);

    if (activeShot.wallBounceCount > 0) {
      audioManager.playWallBounceSound();
    }

    const hitBubble = findHitBubble(activeShot, board, GAME_CONFIG);

      const reachedTopBoundary = isAtTopBoundary(activeShot, GAME_CONFIG);
      const landingCell = hitBubble
        ? findLandingCell(activeShot, hitBubble, board, GAME_CONFIG.board)
        : reachedTopBoundary
        ? findTopLandingCell(activeShot, board, GAME_CONFIG.board)
        : null;

  if (landingCell) {
      resolving = true;
      const landingResult = commitLanding(
        activeShot,
        landingCell,
        board,
        GAME_CONFIG,
        { hitBubble, topLanding: !hitBubble && reachedTopBoundary }
      );
      lastLandingResult = {
        status: landingResult.status,
        row: landingCell.row,
        col: landingCell.col,
        bubbleType: landingResult.bubble?.bubbleType ?? activeShot.bubbleType
      };
      recordStateTransition('LANDING_RESULT', lastLandingResult);

      if (landingResult.status === 'danger') {
        lastLandingGameOverCheck = { source: 'landing-candidate', result: true };
        lastGameOverCheck = { source: 'landing-candidate', result: true };
        enterGameOver();
        return;
      }

      if (landingResult.status === 'landed') {
        audioManager.playHitBubble();
      }

      const addedBubble = landingResult.bubble;

      if (addedBubble) {
        if (checkBoardGameOver('landing-after-insert')) {
          enterGameOver();
          return;
        }
        const resolution = resolveAfterLanding(board, addedBubble.col, addedBubble.row);
        const sessionId = gameSessionId;
        effectsManager.queuePop(resolution.matched, (_cell, index) => {
          if (sessionId !== gameSessionId) return;
          audioManager.playPop(index);
        });
        effectsManager.queueFloatingDrop(
          resolution.floating,
          (count) => {
            if (sessionId !== gameSessionId) return;
            audioManager.playFloatingRewardMusic(count);
          }
        );

        const missState = missTracker.registerShot(resolution.matched.length);

        if (resolution.matched.length > 0) {
          scoreManager.addMatch(resolution.matched.length);
        }
        if (resolution.floating.length > 0) {
          scoreManager.addFloating(resolution.floating.length);
        }
        const removedSpecialBubbles = getUniqueSpecialBubbles([
          ...resolution.matched,
          ...resolution.floating
        ]);
        if (removedSpecialBubbles.length > 0) {
          scoreManager.addSpecialBonus(removedSpecialBubbles.length);
          removedSpecialBubbles.forEach((bubble) => {
            const position = getBubbleRenderPosition(bubble, GAME_CONFIG.board);
            specialBonusPopups.push({ ...position, elapsedMs: 0 });
          });
        }

        if (board.isBoardCleared()) {
          const stage = stageManager.getStage();
          const bonus = scoreManager.addBoardClear(stage);
          roundClear = {
            elapsedMs: 0,
            stage,
            bonus,
            score: scoreManager.getDisplayScore()
          };
          missTracker.reset();
          audioManager.playBoardClearCheer();
        } else if (checkBoardGameOver('landing-after-resolution')) {
          enterGameOver();
        } else if (missState.shouldRefill) {
          startRefill(4);
        } else {
          const lowBubbleRows = getLowBubbleRefillRows(board.getOccupiedBubbles().length);
          if (lowBubbleRows > 0) {
            startRefill(lowBubbleRows, {
              resetChances: false,
              minimumSafetyGap: GAME_CONFIG.minimumDangerSafetyGap
            });
          }
        }
      }

      activeShot = null;
      resolving = false;
      recordStateTransition('LANDING_COMPLETE', { status: landingResult.status });
    } else if (hitBubble || reachedTopBoundary) {
      // A blocked local landing ends safely without teleporting across the board.
      activeShot = null;
      recordStateTransition('SHOT_CANCELLED', { reason: 'NO_SAFE_LANDING' });
    }
  }
}

function frame(currentTime) {
  const elapsed = Math.min(currentTime - previousTime, 100);
  previousTime = currentTime;
  accumulator += elapsed;

  while (accumulator >= FIXED_STEP_MS) {
    updatePhysics();
    accumulator -= FIXED_STEP_MS;
  }

  const refillWasActive = refillSystem.isActive();
  refillSystem.update(elapsed);
  if (refillWasActive && !refillSystem.isActive() && lastRefillResult?.status === 'started') {
    lastRefillResult = { ...lastRefillResult, status: 'complete' };
    recordStateTransition('REFILL_COMPLETE', lastRefillResult);
  }
  if (!gameOver && checkBoardGameOver('frame')) {
    enterGameOver();
  }
  scoreManager.update(elapsed);
  effectsManager.update(elapsed);
  specialBonusPopups = specialBonusPopups
    .map((popup) => ({ ...popup, elapsedMs: popup.elapsedMs + elapsed }))
    .filter((popup) => popup.elapsedMs < 850);
  if (roundClear) {
    roundClear.elapsedMs += elapsed;
    if (roundClear.elapsedMs >= CLEAR_DURATION_MS) {
      stageManager.startNextStage();
      refillSystem.setPatternStage(stageManager.getStage());
      roundClear = null;
      missTracker.reset();
      refillSystem.reset();
    }
  }
  assertPortraitRuntimeState();
  renderScene();
  window.requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerCancel);
canvas.addEventListener('lostpointercapture', handleLostPointerCapture);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
window.visualViewport?.addEventListener('resize', resizeCanvas);
resizeCanvas();
window.requestAnimationFrame(frame);
