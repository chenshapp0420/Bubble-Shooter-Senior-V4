import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Board } from '../src/game/Board.js';
import { findHitBubble, findLandingCell, findTopLandingCell } from '../src/game/Collision.js';
import { getBubbleRenderPosition, getNeighbors, gridToWorld } from '../src/game/GridMath.js';
import {
  GAME_CONFIG,
  getBoardVisualRadius,
  getLayoutMode,
  getPortraitShooterGroupBounds,
  getRuntimeGameConfig
} from '../src/game/config.js';
import { createActiveShot, getWallBounds, resolveWallCollision, updateActiveShot } from '../src/game/Physics.js';
import {
  findConnectedSameColor,
  findFloatingBubbles,
  resolveAfterLanding
} from '../src/game/MatchResolver.js';
import { AnimationManager } from '../src/game/AnimationManager.js';
import {
  AudioManager,
  CONTACT_SOUND,
  COIN_PITCH_VARIATIONS,
  GAME_OVER_AUDIO_SOURCE,
  GAME_OVER_NOTE_GAIN_MULTIPLIER,
  GAME_OVER_MUSIC_GAIN,
  GAME_OVER_MUSIC_SEQUENCE,
  POP_VARIATIONS,
  SHOOT_SOUND,
  WALL_HIT_AUDIO_SOURCE,
  createCoinCascadePlan
} from '../src/game/AudioManager.js';
import { BUBBLE_PALETTE, SPECIAL_LABEL_STYLES } from '../src/game/BubbleRenderer.js';
import { EffectsManager } from '../src/game/EffectsManager.js';
import { checkGameOver, getBoardBubbleDangerGeometry, getBubbleWorldPosition, getDangerDistance, getDangerLineY, getRefillRowsForPressure, isBubbleAtDangerLine, isDangerLineReached, refillBoard, RefillSystem } from '../src/game/RefillSystem.js';
import { MissTracker } from '../src/game/MissTracker.js';
import { getBoardClearBonus, ScoreManager } from '../src/game/ScoreManager.js';
import { StageManager, getStageFillRows } from '../src/game/StageManager.js';
import { Shooter } from '../src/game/Shooter.js';
import {
  createClusteredRow,
  generateBoardPattern,
  HORIZONTAL_RUN_BREAKER_PROBABILITY,
  MAX_PREFERRED_CLUSTER_SIZE,
  MAX_PREFERRED_HORIZONTAL_RUN,
  PRIOR_NEIGHBOR_WEIGHTS,
  SAME_NEIGHBOR_COLOR_WEIGHT
} from '../src/game/BoardPattern.js';
import { classifyContact, findReachableLandingCells, isReachableEmptyCell } from '../src/game/Collision.js';
import { commitLanding } from '../src/game/Landing.js';
import { getShootAngle, getTrajectoryPlan, getTrajectoryPoints, screenToGameCoordinates } from '../src/game/Trajectory.js';
import { getTouchAimTarget, getTouchAimZoneYStart, hasTouchDragExceeded, MIN_TOUCH_DRAG_DISTANCE } from '../src/game/TouchAim.js';
import { isInsideVisibleWalls } from '../src/game/WallResolver.js';
import { GameOverAudio } from '../src/game/GameOverAudio.js';
import { getZenControlAt, getZenUiLayout } from '../src/game/ZenUi.js';
import { getLowBubbleRefillRows } from '../src/game/LowBubbleRefill.js';
import {
  SPECIAL_BUBBLE_LABELS,
  SPECIAL_BUBBLE_BONUS,
  getUniqueSpecialBubbles
} from '../src/game/SpecialBubbles.js';

function createBoard() {
  return new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function largestColorGroup(pattern, columns) {
  const rows = pattern.length;
  const seen = new Set();
  let largest = 0;

  pattern.forEach((cells, row) => cells.forEach((color, col) => {
    const startKey = `${col}:${row}`;
    if (seen.has(startKey)) return;
    const pending = [[col, row]];
    seen.add(startKey);
    let size = 0;

    while (pending.length > 0) {
      const [currentCol, currentRow] = pending.pop();
      size += 1;
      getNeighbors(currentCol, currentRow, {
        columns,
        rows,
        cellWidth: 51,
        cellHeight: 50,
        x: 0,
        y: 0
      }).forEach(([nextCol, nextRow]) => {
        const key = `${nextCol}:${nextRow}`;
        if (!seen.has(key) && pattern[nextRow][nextCol] === color) {
          seen.add(key);
          pending.push([nextCol, nextRow]);
        }
      });
    }

    largest = Math.max(largest, size);
  }));

  return largest;
}

test('getNeighbors keeps the staggered hex layout inside bounds', () => {
  const neighbors = getNeighbors(0, 0, GAME_CONFIG.board);
  assert.deepEqual(neighbors, [[1, 0], [0, 1]]);
  assert.equal(getNeighbors(5, 1, GAME_CONFIG.board).length, 6);
});

test('config exposes seven supported high-contrast bubble colors', () => {
  assert.equal(GAME_CONFIG.physics.totalBubbleColors, 7);
  assert.deepEqual(GAME_CONFIG.colors, [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'fluorescentPink'
  ]);
  assert.equal(GAME_CONFIG.physics.visualBubbleRadius, 25);
  assert.equal(GAME_CONFIG.physics.physicsCollisionRadius, 23);
  assert.equal(BUBBLE_PALETTE.red.base, '#b58a35');
  assert.equal(BUBBLE_PALETTE.orange.base, '#a86f43');
  assert.equal(BUBBLE_PALETTE.purple.base, '#9b7898');
  assert.equal(BUBBLE_PALETTE.fluorescentPink.base, '#a26778');
  assert.notEqual(BUBBLE_PALETTE.red.base, BUBBLE_PALETTE.orange.base);
  assert.notEqual(BUBBLE_PALETTE.purple.base, BUBBLE_PALETTE.fluorescentPink.base);
});

test('physics uses the adjusted bubble speed of 18', async () => {
  const { createActiveShot } = await import('../src/game/Physics.js');
  const shot = createActiveShot({ x: 324, y: 900 }, -90, 'fluorescentPink', GAME_CONFIG);
  assert.equal(Math.hypot(shot.velocity.x, shot.velocity.y), 18);
  assert.equal(shot.bubbleType, 'fluorescentPink');
});

test('Board occupancy and addBubble never overwrite a cell', () => {
  const board = createBoard();
  assert.equal(board.isOccupied(0, 0), true);
  assert.equal(board.addBubble(0, 0, 'blue'), null);
  assert.equal(board.getOccupiedBubbles().length, 126);

  const added = board.addBubble(0, 10, 'blue');
  assert.equal(added.bubbleType, 'blue');
  assert.equal(added.x, gridToWorld(0, 10, GAME_CONFIG.board).x);
  assert.equal(board.getBubble(0, 10), added);
});

test('opening board fills every cell in all nine initial rows', () => {
  const board = createBoard();
  assert.equal(GAME_CONFIG.board.initialFillRows, 9);
  assert.equal(board.getOccupiedBubbles().length, 14 * 9);
  for (let row = 0; row < 9; row += 1) {
    assert.equal(board.getOccupiedBubbles().filter((bubble) => bubble.row === row).length, 14);
  }
});

test('Board reports clear state and StageManager advances with denser later stages', () => {
  const board = createBoard();
  const stages = new StageManager(board);
  board.removeBubbles(board.getOccupiedBubbles());
  assert.equal(board.isBoardCleared(), true);
  assert.equal(getStageFillRows(1, GAME_CONFIG.board), 9);
  assert.equal(getStageFillRows(3, GAME_CONFIG.board), 10);
  assert.equal(getBoardClearBonus(1), 5000);
  assert.equal(getBoardClearBonus(2), 7500);
  assert.equal(getBoardClearBonus(3), 10000);
  stages.startNextStage();
  assert.equal(stages.getStage(), 2);
  assert.equal(board.getOccupiedBubbles().length, 126);
});

test('Task 08.4 keeps the dense opening board high above the danger line', () => {
  const board = createBoard();
  const lowestInitialBubble = board.getOccupiedBubbles()
    .reduce((lowest, bubble) => Math.max(lowest, bubble.y), Number.NEGATIVE_INFINITY);
  const lowestInitialBottom = lowestInitialBubble + GAME_CONFIG.physics.visualBubbleRadius;

  assert.equal(GAME_CONFIG.board.initialFillRows, 9);
  assert.equal(board.getOccupiedBubbles().length, 126);
  assert.equal(GAME_CONFIG.board.y, 25);
  assert.ok(lowestInitialBottom <= GAME_CONFIG.dangerLineY - 55);
  assert.ok(GAME_CONFIG.dangerLineY - lowestInitialBottom >= 90);
  assert.equal(GAME_CONFIG.dangerLineY - lowestInitialBottom, 175);
  assert.equal(GAME_CONFIG.shooter.x, 450);
  assert.equal(GAME_CONFIG.shooter.y, 660);
});

test('Task 08.5 opening occupancy stays at least 95 percent of the filled area', () => {
  const board = createBoard();
  const filledArea = GAME_CONFIG.board.columns * GAME_CONFIG.board.initialFillRows;
  const occupancyRatio = board.getOccupiedBubbles().length / filledArea;
  assert.ok(occupancyRatio >= 0.95);
  assert.equal(board.getOccupiedBubbles().length, 126);
});

test('HUD score and stage stay below the danger line and clear of the shooter', () => {
  const dangerLineY = GAME_CONFIG.dangerLineY;
  const shooterRadius = GAME_CONFIG.physics.visualBubbleRadius;
  const nextBubbleRadius = shooterRadius * 0.82;
  const hudRects = {
    score: { x: GAME_CONFIG.hud.score.x, y: GAME_CONFIG.hud.score.baselineY - 9, width: 150, height: 18 },
    stage: { x: GAME_CONFIG.hud.stage.x, y: GAME_CONFIG.hud.stage.baselineY - 9, width: 100, height: 18 }
  };
  const currentBubble = {
    x: GAME_CONFIG.shooter.x - shooterRadius,
    y: GAME_CONFIG.shooter.y - shooterRadius,
    width: shooterRadius * 2,
    height: shooterRadius * 2
  };
  const nextBubble = {
    x: GAME_CONFIG.shooter.nextX - nextBubbleRadius,
    y: GAME_CONFIG.shooter.nextY - nextBubbleRadius,
    width: nextBubbleRadius * 2,
    height: nextBubbleRadius * 2
  };
  const intersects = (first, second) => (
    first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y
  );

  Object.values(hudRects).forEach((rect) => {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= GAME_CONFIG.baseWidth);
    assert.ok(rect.y + rect.height <= GAME_CONFIG.baseHeight);
    assert.ok(rect.y > dangerLineY);
    assert.equal(intersects(rect, currentBubble), false);
    assert.equal(intersects(rect, nextBubble), false);
  });
  assert.equal(GAME_CONFIG.hud.score.x, 55);
  assert.equal(GAME_CONFIG.hud.stage.x, 55);
  assert.equal(GAME_CONFIG.board.y, 25);
  assert.equal(GAME_CONFIG.board.initialFillRows, 9);
  assert.equal(dangerLineY, 625);
  assert.equal(new Board(GAME_CONFIG.board, GAME_CONFIG.colors).getOccupiedBubbles().length, 126);
});

test('Task 10.5 separates shooter visuals from the board danger line', () => {
  const radius = GAME_CONFIG.physics.visualBubbleRadius;
  const currentTop = GAME_CONFIG.shooter.y - radius;
  const currentBottom = GAME_CONFIG.shooter.y + radius;
  const nextRadius = radius * 0.82;
  const nextPosition = {
    x: GAME_CONFIG.shooter.nextX,
    y: GAME_CONFIG.shooter.nextY
  };

  assert.equal(GAME_CONFIG.shooter.y, 660);
  assert.equal(currentTop, 635);
  assert.ok(currentTop > GAME_CONFIG.dangerLineY + 8);
  assert.equal(currentBottom, 685);
  assert.equal(GAME_CONFIG.shooter.nextX, 520);
  assert.equal(GAME_CONFIG.shooter.nextY, 675);
  assert.ok(nextPosition.x - nextRadius >= 0);
  assert.ok(nextPosition.x + nextRadius <= GAME_CONFIG.baseWidth);
  assert.ok(nextPosition.y - nextRadius >= 0);
  assert.ok(nextPosition.y + nextRadius <= GAME_CONFIG.baseHeight);
});

test('Task 10.5 keeps Board row 11 safe and row 12 dangerous', () => {
  const testConfig = {
    ...GAME_CONFIG,
    board: { ...GAME_CONFIG.board, y: 25, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());

  board.addBubble(0, 11, 'red');
  assert.equal(checkGameOver(board, testConfig), false);
  board.removeBubble(0, 11);
  board.addBubble(0, 12, 'purple');
  assert.equal(checkGameOver(board, testConfig), true);
});

test('Task 10.5 active shot crossing the line is not a Board Game Over', () => {
  const testConfig = {
    ...GAME_CONFIG,
    board: { ...GAME_CONFIG.board, y: 25, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const activeShot = { x: GAME_CONFIG.shooter.x, y: 640, bubbleType: 'blue' };

  assert.ok(activeShot.y + GAME_CONFIG.physics.visualBubbleRadius >= testConfig.dangerLineY);
  assert.equal(checkGameOver(board, testConfig), false);
});

test('BoardPattern is reproducible with a seed but differs across seeds', () => {
  const first = generateBoardPattern({
    colors: GAME_CONFIG.colors,
    rows: GAME_CONFIG.board.initialFillRows,
    columns: GAME_CONFIG.board.columns,
    random: seededRandom(7)
  });
  const same = generateBoardPattern({
    colors: GAME_CONFIG.colors,
    rows: GAME_CONFIG.board.initialFillRows,
    columns: GAME_CONFIG.board.columns,
    random: seededRandom(7)
  });
  const different = generateBoardPattern({
    colors: GAME_CONFIG.colors,
    rows: GAME_CONFIG.board.initialFillRows,
    columns: GAME_CONFIG.board.columns,
    random: seededRandom(8)
  });

  assert.deepEqual(first, same);
  assert.notDeepEqual(first, different);
  const counts = Object.fromEntries(GAME_CONFIG.colors.map((color) => [color, 0]));
  first.flat().forEach((color) => { counts[color] += 1; });
  GAME_CONFIG.colors.forEach((color) => {
    assert.ok(counts[color] >= 5);
    assert.ok(counts[color] <= 42);
  });
  assert.ok(first.flat().some((color, index, cells) => (
    index % GAME_CONFIG.board.columns > 0 && cells[index - 1] === color
  )));
});

test('Board reset consumes a new runtime random sequence', () => {
  const random = seededRandom(91);
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors, { random });
  const first = board.getOccupiedBubbles().map(({ bubbleType }) => bubbleType);
  board.reset();
  const second = board.getOccupiedBubbles().map(({ bubbleType }) => bubbleType);
  assert.notDeepEqual(first, second);
  assert.equal(second.length, 126);
});

test('cluster tuning keeps natural groups while lowering oversized pure regions', () => {
  assert.equal(SAME_NEIGHBOR_COLOR_WEIGHT, 0.58);
  assert.equal(MAX_PREFERRED_CLUSTER_SIZE, 6);

  const largestGroups = Array.from({ length: 100 }, (_, index) => (
    largestColorGroup(generateBoardPattern({
      colors: GAME_CONFIG.colors,
      rows: GAME_CONFIG.board.initialFillRows,
      columns: GAME_CONFIG.board.columns,
      random: seededRandom(index + 1)
    }), GAME_CONFIG.board.columns)
  )).sort((first, second) => first - second);
  const average = largestGroups.reduce((sum, size) => sum + size, 0) / largestGroups.length;
  const percentile90 = largestGroups[Math.ceil(largestGroups.length * 0.9) - 1];
  const oversizedRatio = largestGroups.filter((size) => size >= 10).length / largestGroups.length;

  assert.ok(average <= 9);
  assert.ok(largestGroups[49] >= 5 && largestGroups[49] <= 8);
  assert.ok(percentile90 <= 11);
  assert.ok(oversizedRatio <= 0.2);
});

test('refill row generation delegates to the same clustered generator', () => {
  const expected = generateBoardPattern({
    colors: GAME_CONFIG.colors,
    rows: 1,
    columns: GAME_CONFIG.board.columns,
    random: seededRandom(123),
    minimumPerColor: 0,
    maximumPerColor: Math.floor(GAME_CONFIG.board.columns * 0.6)
  })[0];
  const actual = createClusteredRow(
    GAME_CONFIG.colors,
    0,
    GAME_CONFIG.board.columns,
    1,
    seededRandom(123)
  );

  assert.deepEqual(actual, expected);
});

test('BoardPattern uses directional neighbors and a probabilistic horizontal breaker', () => {
  assert.equal(PRIOR_NEIGHBOR_WEIGHTS.left, 0.25);
  assert.equal(PRIOR_NEIGHBOR_WEIGHTS.upperLeft, 0.35);
  assert.equal(PRIOR_NEIGHBOR_WEIGHTS.upperRight, 0.4);
  assert.equal(MAX_PREFERRED_HORIZONTAL_RUN, 3);
  assert.equal(HORIZONTAL_RUN_BREAKER_PROBABILITY.atLimit, 0.7);
  assert.equal(HORIZONTAL_RUN_BREAKER_PROBABILITY.overLimit, 0.9);
});

test('findHitBubble uses circular distance and returns the closest occupied bubble', () => {
  const board = createBoard();
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(5, 6, 'blue');
  const target = board.getBubble(5, 6);
  const hit = findHitBubble(
    { x: target.x, y: target.y + 45, collisionRadius: 23 },
    board,
    GAME_CONFIG
  );
  const miss = findHitBubble(
    { x: 0, y: target.y + 130, collisionRadius: 23 },
    board,
    GAME_CONFIG
  );

  assert.equal(hit, target);
  assert.equal(miss, null);
});

test('findLandingCell selects the nearest free hex neighbor', () => {
  const board = createBoard();
  const hitBubble = board.getBubble(5, 8);
  getNeighbors(hitBubble.col, hitBubble.row, GAME_CONFIG.board).forEach(([col, row]) => board.removeBubble(col, row));
  const landing = findLandingCell(
    { x: hitBubble.x + 23, y: hitBubble.y + 48 },
    hitBubble,
    board,
    GAME_CONFIG.board
  );

  assert.ok(landing);
  assert.deepEqual([landing.col, landing.row], [5, 9]);
  assert.equal(board.isOccupied(landing.col, landing.row), false);
});

test('findLandingCell returns null when all local neighbors are occupied', () => {
  const board = createBoard();
  const hitBubble = board.getBubble(5, 6);
  const occupiedNeighbors = getNeighbors(hitBubble.col, hitBubble.row, GAME_CONFIG.board);
  occupiedNeighbors.forEach(([col, row]) => board.addBubble(col, row, 'red'));

  const landing = findLandingCell(
    { x: hitBubble.x, y: hitBubble.y + 48 },
    hitBubble,
    board,
    GAME_CONFIG.board
  );

  assert.equal(landing, null);
});

test('findTopLandingCell selects the nearest free cell in the topmost free row', () => {
  const board = createBoard();
  board.removeBubble(5, 0);
  const landing = findTopLandingCell(
    { x: 324, y: 105 },
    board,
    GAME_CONFIG.board
  );

  assert.ok(landing);
  assert.equal(landing.row, 0);
  assert.equal(board.isOccupied(landing.col, landing.row), false);
});

test('commitLanding rejects a target touching the danger line before Board insertion', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 13 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const activeShot = {
    bubbleType: 'red',
    x: 450,
    y: 500,
    velocity: { x: 0, y: -18 },
    collisionRadius: 25
  };
  const targetCell = { col: 0, row: 10, ...gridToWorld(0, 10, testConfig.board) };

  const result = commitLanding(activeShot, targetCell, board, testConfig, { topLanding: false });

  assert.equal(result.status, 'danger');
  assert.equal(board.getOccupiedBubbles().length, 0);

  const belowTarget = { col: 0, row: 11, ...gridToWorld(0, 11, testConfig.board) };
  const belowResult = commitLanding(activeShot, belowTarget, board, testConfig, { topLanding: false });
  assert.equal(belowResult.status, 'danger');
  assert.equal(board.getOccupiedBubbles().length, 0);
});

test('commitLanding only inserts safe grid-center cells and never overwrites occupied cells', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const activeShot = {
    bubbleType: 'orange',
    x: 450,
    y: 500,
    velocity: { x: 0, y: -18 },
    collisionRadius: 25
  };
  const safeTarget = { col: 4, row: 5, ...gridToWorld(4, 5, GAME_CONFIG.board) };
  const first = commitLanding(activeShot, safeTarget, board, GAME_CONFIG);
  const second = commitLanding(activeShot, safeTarget, board, GAME_CONFIG);

  assert.equal(first.status, 'landed');
  assert.equal(first.bubble.x, safeTarget.x);
  assert.equal(first.bubble.y, safeTarget.y);
  assert.equal(second.status, 'rejected');
  assert.equal(board.getOccupiedBubbles().length, 1);
});

test('blocked landing does not use a global fallback or create a bottom pile', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  const hitBubble = board.getBubble(5, 5);
  getNeighbors(hitBubble.col, hitBubble.row, GAME_CONFIG.board)
    .forEach(([col, row]) => board.addBubble(col, row, 'blue'));
  const activeShot = {
    bubbleType: 'green',
    x: hitBubble.x,
    y: hitBubble.y + 49,
    previousPosition: { x: hitBubble.x, y: hitBubble.y + 60 },
    velocity: { x: 0, y: -18 },
    collisionRadius: 25
  };
  const beforeCount = board.getOccupiedBubbles().length;
  const result = commitLanding(activeShot, null, board, GAME_CONFIG, { hitBubble });

  assert.equal(result.status, 'blocked');
  assert.equal(board.getOccupiedBubbles().length, beforeCount);
  assert.equal(board.getBubble(5, GAME_CONFIG.board.rows - 1)?.bubbleType, undefined);
});

test('top landing does not teleport to a lower or opposite-side cell when top row is full', () => {
  const board = createBoard();
  assert.equal(findTopLandingCell({ x: 840, y: 65 }, board, GAME_CONFIG.board), null);
});

test('findConnectedSameColor returns only the connected same-color component', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 0, 'red');
  board.addBubble(1, 0, 'red');
  board.addBubble(0, 1, 'red');
  board.addBubble(3, 0, 'blue');
  const cells = findConnectedSameColor(board, 0, 0);

  assert.equal(cells.length, 3);
  assert.deepEqual(cells[0], { col: 0, row: 0, bubbleType: 'red' });
});

test('resolveAfterLanding removes a group of three and keeps a group of two', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 0, 'red');
  board.addBubble(1, 0, 'red');
  board.addBubble(2, 0, 'red');

  const result = resolveAfterLanding(board, 1, 0);
  assert.equal(result.matched.length, 3);
  assert.equal(board.getOccupiedBubbles().length, 0);

  board.addBubble(0, 0, 'blue');
  board.addBubble(1, 0, 'blue');
  const noMatch = resolveAfterLanding(board, 1, 0);
  assert.equal(noMatch.matched.length, 0);
  assert.equal(board.getOccupiedBubbles().length, 2);
});

test('large connected component removes all ten same-color bubbles', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  for (let col = 0; col < 10; col += 1) {
    board.addBubble(col, 0, 'red');
  }

  const result = resolveAfterLanding(board, 5, 0);
  assert.equal(result.matched.length, 10);
  assert.equal(board.getOccupiedBubbles().length, 0);
});

test('findFloatingBubbles returns occupied bubbles not connected to row zero', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 0, 'green');
  board.addBubble(0, 1, 'green');
  board.addBubble(5, 5, 'purple');

  const floating = findFloatingBubbles(board);
  assert.deepEqual(floating, [{ col: 5, row: 5, bubbleType: 'purple' }]);
});

test('floating resolver identifies a twenty-bubble disconnected cluster', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 0, 'red');

  for (let row = 5; row < 10; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      board.addBubble(col, row, 'purple');
    }
  }

  const floating = findFloatingBubbles(board);
  assert.equal(floating.length, 20);
});

test('AnimationManager removes completed effects after their update lifecycle', () => {
  const manager = new AnimationManager();
  let elapsed = 0;
  manager.add({
    update(deltaMs) {
      elapsed += deltaMs;
      return elapsed >= 100;
    },
    render() {}
  });

  manager.update(40);
  assert.equal(manager.getActiveCount(), 1);
  manager.update(60);
  assert.equal(manager.getActiveCount(), 0);
});

test('AudioManager supports master volume and mute state without external assets', () => {
  const audio = new AudioManager(0.8);
  assert.equal(audio.masterVolume, 0.8);
  assert.equal(audio.muted, false);
  assert.equal(audio.toggleMute(), true);
  assert.equal(audio.muted, true);
  audio.setMuted(false);
  assert.equal(audio.muted, false);
});

test('GameOverAudio exposes a single first-phrase source and safe reset', () => {
  const audio = new GameOverAudio('/audio/ama_happy_game_over.mp3', 8725);
  assert.equal(audio.source, '/audio/ama_happy_game_over.mp3');
  assert.ok(audio.phraseDurationMs >= 8000);
  assert.ok(audio.phraseDurationMs <= 12000);
  audio.setMuted(true);
  assert.equal(audio.playOnce(), false);
  audio.reset();
});

test('Zen palette keeps all seven gameplay colors distinct and special chance occasional', () => {
  const bases = GAME_CONFIG.colors.map((color) => BUBBLE_PALETTE[color].base);
  assert.equal(new Set(bases).size, GAME_CONFIG.colors.length);
  assert.ok(GAME_CONFIG.specialBubbleChance > 0);
  assert.ok(GAME_CONFIG.specialBubbleChance < 0.2);
});

test('A-1 portrait presentation keeps bubbles tight and inside the mobile board', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const diameter = config.presentation.bubbleDiameter;
    const diagonalNeighborDistance = Math.hypot(
      config.board.cellWidth / 2,
      config.board.cellHeight
    );
    const boardLeft = (config.board.x - config.physics.visualBubbleRadius) * config.presentation.scale;
    const boardRight = (
      config.board.x
      + (config.board.columns - 1) * config.board.cellWidth
      + config.board.cellWidth / 2
      + config.physics.visualBubbleRadius
    ) * config.presentation.scale;

    assert.equal(config.presentation.bubbleDiameter, config.board.cellWidth);
    assert.ok(Math.abs(config.board.cellHeight - diameter * Math.sqrt(3) / 2) < 0.1);
    assert.ok(diagonalNeighborDistance <= diameter + 1);
    assert.ok(boardLeft >= 0);
    assert.ok(boardRight <= config.presentation.cssWidth);
  });
});

test('A-1 special label styles provide deterministic high contrast for all labels', () => {
  SPECIAL_BUBBLE_LABELS.forEach((label) => {
    const style = SPECIAL_LABEL_STYLES[label];
    assert.ok(style);
    assert.notEqual(style.fill, style.stroke);
    assert.ok(style.shadow);
  });
  assert.equal(SPECIAL_LABEL_STYLES['貪'].fill, '#ffe36a');
  assert.equal(SPECIAL_LABEL_STYLES['嗔'].fill, '#fffaf0');
  assert.equal(SPECIAL_LABEL_STYLES['痴'].fill, '#315d9b');
  assert.equal(SPECIAL_LABEL_STYLES['慢'].fill, '#274e2d');
  assert.equal(SPECIAL_LABEL_STYLES['疑'].fill, '#fffaf0');
});

test('fixed Zen art integration keeps the approved source separate from gameplay art', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /zen-fixed-art\.png/);
  assert.match(source, /drawFixedArtCrop/);
  assert.doesNotMatch(source, /drawImage\(\s*fixedZenArt\s*,\s*0\s*,\s*0\s*,\s*1536\s*,\s*2048/);
});

test('A-1 purple palette is softer while remaining distinct', () => {
  assert.equal(BUBBLE_PALETTE.purple.base, '#9b7898');
  assert.equal(BUBBLE_PALETTE.purple.light, '#c5a8c0');
  assert.equal(BUBBLE_PALETTE.purple.shadow, '#755a73');
  assert.notEqual(BUBBLE_PALETTE.purple.base, BUBBLE_PALETTE.orange.base);
  assert.notEqual(BUBBLE_PALETTE.purple.base, BUBBLE_PALETTE.yellow.base);
});

test('A-1 renderer keeps bubble interiors free of decorative texture arcs', async () => {
  const source = await readFile(new URL('../src/game/BubbleRenderer.js', import.meta.url), 'utf8');
  assert.match(source, /createRadialGradient/);
  assert.doesNotMatch(source, /arc\(x - radius \* 0\.12/);
  assert.doesNotMatch(source, /arc\(x, y \+ radius \* 0\.28/);
});

test('full Zen UI decor stays inside all supported portrait canvases', () => {
  [[360, 800], [390, 844], [412, 915]].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const layout = getZenUiLayout(config);
    const buttons = layout.controlBar.buttons;
    buttons.forEach((button) => {
      assert.ok(button.x - button.radius >= 0);
      assert.ok(button.x + button.radius <= config.baseWidth);
      assert.ok(button.y - button.radius >= 0);
      assert.ok(button.y + button.radius <= config.baseHeight);
    });
    assert.ok(layout.monk.x > 0 && layout.monk.x < config.baseWidth / 2);
    assert.ok(layout.incense.x < config.baseWidth);
    assert.ok(layout.lotusLeft.y <= config.baseHeight);
    assert.ok(layout.lotusRight.y <= config.baseHeight);
  });
});

test('full Zen UI controls map only to real sound and new-game actions', () => {
  const layout = getZenUiLayout(getRuntimeGameConfig(390, 844));
  assert.equal(getZenControlAt(layout.controlBar.buttons[0], layout), 'sound');
  assert.equal(getZenControlAt(layout.controlBar.buttons[1], layout), 'new-game');
  assert.equal(getZenControlAt({ x: 195, y: 500 }, layout), null);
});

test('special bubbles support exactly the five required labels and preserve color', () => {
  assert.deepEqual(SPECIAL_BUBBLE_LABELS, ['貪', '嗔', '痴', '慢', '疑']);
  assert.equal(SPECIAL_BUBBLE_LABELS[2], '痴');

  const board = new Board({ ...GAME_CONFIG.board, initialFillRows: 0 }, GAME_CONFIG.colors);
  const special = board.addBubble(0, 0, 'green', { specialLabel: '痴' });
  assert.equal(special.bubbleType, 'green');
  assert.equal(special.specialLabel, '痴');
});

test('special bubble participates in normal color matching', () => {
  const board = new Board({ ...GAME_CONFIG.board, initialFillRows: 0 }, GAME_CONFIG.colors);
  board.addBubble(0, 0, 'blue', { specialLabel: '貪' });
  board.addBubble(1, 0, 'blue');
  board.addBubble(2, 0, 'blue');
  const result = resolveAfterLanding(board, 1, 0);
  assert.equal(result.matched.length, 3);
  assert.equal(result.matched.find((bubble) => bubble.specialLabel)?.specialLabel, '貪');
});

test('hitting but not removing a special bubble awards no bonus', () => {
  const board = new Board({ ...GAME_CONFIG.board, initialFillRows: 0 }, GAME_CONFIG.colors);
  board.addBubble(0, 0, 'purple', { specialLabel: '嗔' });
  board.addBubble(1, 0, 'purple');
  const result = resolveAfterLanding(board, 1, 0);
  const score = new ScoreManager();
  assert.equal(result.matched.length, 0);
  assert.equal(score.addSpecialBonus(getUniqueSpecialBubbles(result.matched).length), 0);
  assert.equal(score.getScore(), 0);
});

test('removing a special bubble awards the bonus exactly once', () => {
  const board = new Board({ ...GAME_CONFIG.board, initialFillRows: 0 }, GAME_CONFIG.colors);
  board.addBubble(0, 0, 'red', { specialLabel: '痴' });
  board.addBubble(1, 0, 'red');
  board.addBubble(2, 0, 'red');
  const result = resolveAfterLanding(board, 1, 0);
  const score = new ScoreManager();
  const unique = getUniqueSpecialBubbles([...result.matched, ...result.matched]);
  assert.equal(unique.length, 1);
  assert.equal(score.addSpecialBonus(unique.length), SPECIAL_BUBBLE_BONUS);
  assert.equal(score.getScore(), SPECIAL_BUBBLE_BONUS);
});

test('floating removal of a special bubble awards the bonus once', () => {
  const board = new Board({ ...GAME_CONFIG.board, initialFillRows: 0 }, GAME_CONFIG.colors);
  board.addBubble(0, 0, 'green');
  board.addBubble(1, 0, 'green');
  board.addBubble(2, 0, 'green');
  board.addBubble(5, 5, 'yellow', { specialLabel: '疑' });
  const result = resolveAfterLanding(board, 1, 0);
  const score = new ScoreManager();
  assert.equal(result.floating.length, 1);
  assert.equal(result.floating[0].specialLabel, '疑');
  assert.equal(score.addSpecialBonus(getUniqueSpecialBubbles(result.floating).length), SPECIAL_BUBBLE_BONUS);
});

test('V2 replacement audio assets wire only wall hit and Game Over events', async () => {
  const audioSource = await readFile(new URL('../src/game/AudioManager.js', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const wallAsset = await readFile(new URL('../public/audio/amitabha_wall.mp3', import.meta.url));
  const gameOverAsset = await readFile(new URL('../public/audio/guanyin_game_over.mp3', import.meta.url));
  assert.ok(wallAsset.length > 0);
  assert.ok(gameOverAsset.length > 0);
  assert.match(audioSource, /WALL_HIT_AUDIO_SOURCE = '\/audio\/amitabha_wall\.mp3'/);
  assert.match(audioSource, /GAME_OVER_AUDIO_SOURCE = '\/audio\/guanyin_game_over\.mp3'/);
  assert.match(mainSource, /bindGameOverAudio\(new GameOverAudio\(GAME_OVER_AUDIO_SOURCE\)\)/);
  assert.match(mainSource, /if \(activeShot\.wallBounceCount > 0\) \{\s*audioManager\.playWallBounceSound\(\);/);
  assert.equal((mainSource.match(/audioManager\.playWallBounceSound\(\)/g) ?? []).length, 1);

  const previousAudio = globalThis.Audio;
  const playedSources = [];
  globalThis.Audio = class MockAudio {
    constructor(source) {
      this.source = source;
      this.currentTime = 0;
      this.volume = 1;
      this.preload = '';
      this.loop = false;
    }

    play() {
      playedSources.push(this.source);
      return Promise.resolve();
    }

    pause() {}
  };

  try {
    const audio = new AudioManager(0.8);
    assert.equal(audio.playWallBounceSound(), true);
    assert.equal(audio.playWallBounceSound(), true);
    assert.deepEqual(playedSources, [WALL_HIT_AUDIO_SOURCE, WALL_HIT_AUDIO_SOURCE]);
    audio.bindGameOverAudio(new GameOverAudio(GAME_OVER_AUDIO_SOURCE, 10));
    assert.equal(audio.playGameOverMusic(), true);
    assert.equal(audio.playGameOverMusic(), false);
    assert.equal(playedSources.at(-1), GAME_OVER_AUDIO_SOURCE);
    audio.resetGameOverMusic();
    assert.equal(audio.playGameOverMusic(), true);
    audio.setMuted(true);
    assert.equal(audio.playWallBounceSound(), false);
    assert.equal(audio.playGameOverMusic(), false);
  } finally {
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
  }
});

test('shooting angles reach both near-horizontal limits without allowing downward shots', () => {
  const origin = { x: 324, y: 900 };
  assert.equal(getShootAngle(origin, { x: 0, y: 890 }, -175, -5), -175);
  assert.equal(getShootAngle(origin, { x: 640, y: 890 }, -175, -5), -5);
  assert.equal(getShootAngle(origin, { x: 324, y: 1000 }, -175, -5), -5);
});

test('wall bounds use the independent inset and keep the bubble inside the arena', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  assert.equal(bounds.visibleLeftWall, 34);
  assert.equal(bounds.visibleRightWall, 866);
  assert.equal(bounds.minX, 59);
  assert.equal(bounds.maxX, 841);
  const left = createActiveShot({ x: bounds.minX + 1, y: 500 }, -175, 'red', GAME_CONFIG);
  left.velocity.x = -18;
  updateActiveShot(left, GAME_CONFIG);
  assert.equal(left.x, bounds.minX + 17);
  assert.ok(left.velocity.x > 0);

  const right = createActiveShot({ x: bounds.maxX - 1, y: 500 }, -5, 'red', GAME_CONFIG);
  right.velocity.x = 18;
  updateActiveShot(right, GAME_CONFIG);
  assert.equal(right.x, bounds.maxX - 17);
  assert.ok(right.velocity.x < 0);
});

test('visual bubble radius keeps both complete edges inside the visible walls', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  assert.equal(isInsideVisibleWalls(bounds.minX, 25, bounds), true);
  assert.equal(isInsideVisibleWalls(bounds.maxX, 25, bounds), true);
  assert.equal(isInsideVisibleWalls(bounds.minX - 0.01, 25, bounds), false);
  assert.equal(isInsideVisibleWalls(bounds.maxX + 0.01, 25, bounds), false);
});

test('high-speed multi-wall correction keeps the bubble center inside bounds', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  const shot = createActiveShot({ x: bounds.minX + 1, y: 500 }, -90, 'red', GAME_CONFIG);
  shot.velocity.x = 5000;

  for (let step = 0; step < 12; step += 1) {
    updateActiveShot(shot, GAME_CONFIG);
    assert.ok(shot.x >= bounds.minX);
    assert.ok(shot.x <= bounds.maxX);
  }

  assert.ok(shot.wallBounceCount > 0);
});

test('resolveWallCollision handles extreme overshoot and clamps visual safety bounds', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  const resolved = resolveWallCollision(bounds.minX - 100000, -9876, bounds);
  assert.ok(resolved.x >= bounds.minX && resolved.x <= bounds.maxX);
  assert.ok(resolved.bounceCount > 0);
  assert.notEqual(resolved.velocityX, 0);
});

test('extreme angles remain inside visual bounds for 1000 fixed steps', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  for (const angle of [-175, -170, -90, -10, -5]) {
    const shot = createActiveShot({ x: 450, y: 610 }, angle, 'red', GAME_CONFIG);
    for (let step = 0; step < 1000; step += 1) {
      updateActiveShot(shot, GAME_CONFIG);
      assert.ok(shot.x - GAME_CONFIG.physics.visualWallSafetyRadius >= GAME_CONFIG.physics.physicsWallInset);
      assert.ok(shot.x + GAME_CONFIG.physics.visualWallSafetyRadius <= GAME_CONFIG.baseWidth - GAME_CONFIG.physics.physicsWallInset);
      assert.ok(shot.x >= bounds.minX && shot.x <= bounds.maxX);
    }
  }
});

test('extreme trajectory and physics share the same reflection wall', () => {
  const bounds = getWallBounds(GAME_CONFIG);
  const points = getTrajectoryPoints(
    { x: GAME_CONFIG.shooter.x, y: GAME_CONFIG.shooter.y },
    -175,
    bounds,
    GAME_CONFIG.board.y - GAME_CONFIG.physics.collisionDiameter
  );
  assert.ok(points.some((point) => point.x === bounds.minX));

  const shot = createActiveShot({ x: GAME_CONFIG.shooter.x, y: GAME_CONFIG.shooter.y }, -175, 'red', GAME_CONFIG);
  let reflected = false;
  for (let step = 0; step < 100; step += 1) {
    updateActiveShot(shot, GAME_CONFIG);
    if (shot.wallBounceCount > 0) {
      reflected = shot.velocity.x > 0;
      break;
    }
  }
  assert.equal(reflected, true);
});

test('a near-threshold grazing contact remains clear while true contact collides', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(3, 3, 'red');
  const target = board.getBubble(3, 3);

  const nearMiss = findHitBubble(
    { x: target.x + 46.25, y: target.y, collisionRadius: 23 },
    board,
    GAME_CONFIG
  );
  const contact = findHitBubble(
    { x: target.x + 45, y: target.y, collisionRadius: 23 },
    board,
    GAME_CONFIG
  );
  assert.equal(nearMiss, null);
  assert.equal(contact, target);
});

test('cavity contact allows a reachable empty hex cell while frontal contact lands', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(5, 5, 'blue');
  const target = board.getBubble(5, 5);
  const cavityShot = {
    x: target.x,
    y: target.y + 46,
    previousPosition: { x: target.x - 13.37, y: target.y + 58.06 },
    velocity: { x: 18 * 0.743, y: -18 * 0.67 },
    collisionRadius: 23
  };
  const cavityCell = gridToWorld(6, 5, GAME_CONFIG.board);

  assert.equal(classifyContact(cavityShot, target, GAME_CONFIG), 'glancing');
  assert.equal(isReachableEmptyCell(cavityShot, { col: 6, row: 5, ...cavityCell }, board, GAME_CONFIG.board), true);
  assert.equal(findReachableLandingCells(cavityShot, board, GAME_CONFIG.board, target).length > 0, true);
  assert.equal(findHitBubble(cavityShot, board, GAME_CONFIG), null);

  const frontalShot = {
    x: target.x - 45,
    y: target.y,
    previousPosition: { x: target.x - 63, y: target.y },
    velocity: { x: 18, y: 0 },
    collisionRadius: 23
  };
  assert.equal(classifyContact(frontalShot, target, GAME_CONFIG), 'frontal');
  assert.equal(findHitBubble(frontalShot, board, GAME_CONFIG), target);
});

test('side entry prefers the legal neighbor on the entry side', () => {
  const board = createBoard();
  const hitBubble = board.getBubble(5, 6);
  board.removeBubble(4, 6);
  const landing = findLandingCell(
    {
      x: hitBubble.x - 49,
      y: hitBubble.y,
      previousPosition: { x: hitBubble.x - 67, y: hitBubble.y },
      velocity: { x: 18, y: 0 }
    },
    hitBubble,
    board,
    GAME_CONFIG.board
  );
  assert.deepEqual([landing.col, landing.row], [4, 6]);
  assert.equal(board.isOccupied(landing.col, landing.row), false);
});

test('left and right boundary landing cells never leave the grid', () => {
  const board = createBoard();
  const leftHit = board.getBubble(0, 6);
  const rightHit = board.getBubble(9, 6);
  getNeighbors(leftHit.col, leftHit.row, GAME_CONFIG.board).forEach(([col, row]) => board.removeBubble(col, row));
  getNeighbors(rightHit.col, rightHit.row, GAME_CONFIG.board).forEach(([col, row]) => board.removeBubble(col, row));
  const leftLanding = findLandingCell({ x: leftHit.x - 49, y: leftHit.y }, leftHit, board, GAME_CONFIG.board);
  const rightLanding = findLandingCell({ x: rightHit.x + 49, y: rightHit.y }, rightHit, board, GAME_CONFIG.board);

  assert.ok(leftLanding && leftLanding.col >= 0 && leftLanding.col < GAME_CONFIG.board.columns);
  assert.ok(rightLanding && rightLanding.col >= 0 && rightLanding.col < GAME_CONFIG.board.columns);
});

test('swept collision catches a high-speed shot without tunneling through a bubble', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(3, 3, 'blue');
  const target = board.getBubble(3, 3);
  const hit = findHitBubble(
    {
      x: target.x + 70,
      y: target.y,
      previousPosition: { x: target.x - 70, y: target.y },
      collisionRadius: 25
    },
    board,
    GAME_CONFIG
  );
  assert.equal(hit, target);
});

test('Task 07 config exposes misses, chances, danger line, and refill timing', () => {
  assert.equal(GAME_CONFIG.missesBeforeRefill, 3);
  assert.equal(GAME_CONFIG.initialChances, 3);
  assert.equal(GAME_CONFIG.baseWidth, 900);
  assert.equal(GAME_CONFIG.baseHeight, 700);
  assert.equal(GAME_CONFIG.board.columns, 14);
  assert.equal(GAME_CONFIG.board.rows, 11);
  assert.equal(GAME_CONFIG.board.initialFillRows, 9);
  assert.equal(GAME_CONFIG.shooter.x, 450);
  assert.equal(GAME_CONFIG.shooter.y, 660);
  assert.equal(GAME_CONFIG.dangerLineY, 625);
  assert.equal(GAME_CONFIG.refillRowsPerTrigger, 4);
  assert.deepEqual(GAME_CONFIG.refill, { durationMs: 400, bubbleDelayMs: 80 });
});

test('Task 11.1 classifies the supported viewport modes', () => {
  assert.equal(getLayoutMode(390, 844), 'PORTRAIT_MOBILE');
  assert.equal(getLayoutMode(360, 800), 'PORTRAIT_MOBILE');
  assert.equal(getLayoutMode(412, 915), 'PORTRAIT_MOBILE');
  assert.equal(getLayoutMode(900, 700), 'DESKTOP');
});

test('Task 11.1 preserves the desktop runtime geometry', () => {
  assert.equal(getRuntimeGameConfig(900, 700), GAME_CONFIG);
  assert.equal(GAME_CONFIG.layoutMode, 'DESKTOP');
  assert.equal(GAME_CONFIG.board.columns, 14);
  assert.equal(GAME_CONFIG.physics.bubbleDiameter, 50);
  assert.equal(GAME_CONFIG.dangerLineY, 625);
});

test('Task 11.1 portrait bubble remains senior-readable', () => {
  [360, 390, 412].forEach((width) => {
    const config = getRuntimeGameConfig(width, width === 360 ? 800 : width === 390 ? 844 : 915);
    assert.equal(config.layoutMode, 'PORTRAIT_MOBILE');
    assert.ok(config.physics.bubbleDiameter >= 42);
    assert.ok(config.board.columns >= 8 && config.board.columns <= 10);
  });
});

test('Task 11.1 portrait board fits every target viewport', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const radius = config.physics.visualBubbleRadius;
    const left = (config.board.x - radius) * config.presentation.scale;
    const right = (config.board.x
      + (config.board.columns - 1) * config.board.cellWidth
      + config.board.cellWidth / 2
      + radius) * config.presentation.scale;
    assert.ok(left >= 0);
    assert.ok(right <= config.presentation.cssWidth);
  });
});

test('Task 11.1 portrait HUD clears the first board row', () => {
  const config = getRuntimeGameConfig(390, 844);
  const hudBottom = config.hud.score.baselineY + config.hud.score.fontSize / 2;
  const firstRowTop = config.board.y - config.physics.visualBubbleRadius;
  assert.ok(firstRowTop > hudBottom);
});

test('Task 11.1 portrait danger line keeps board row 11 safe and row 12 dangerous', () => {
  const config = getRuntimeGameConfig(390, 844);
  const radius = config.physics.visualBubbleRadius;
  const row11Bottom = config.board.y + 11 * config.board.cellHeight + radius;
  const row12Bottom = config.board.y + 12 * config.board.cellHeight + radius;
  assert.ok(row11Bottom < config.dangerLineY);
  assert.ok(row12Bottom >= config.dangerLineY);
});

test('portrait starting board keeps large rendered clearance without changing desktop rows', () => {
  const desktop = getRuntimeGameConfig(900, 700);
  const portraitSizes = [[360, 640], [375, 667], [390, 700], [390, 844], [412, 915], [430, 932]];

  assert.equal(desktop.board.initialFillRows, 9);
  portraitSizes.forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const board = new Board(config.board, config.colors);
    const lowest = board.getOccupiedBubbles()
      .map((bubble) => getBoardBubbleDangerGeometry(
        bubble,
        config.board,
        config.dangerLineY,
        getBoardVisualRadius(config)
      ))
      .sort((left, right) => right.bubbleBottom - left.bubbleBottom)[0];

    assert.equal(config.board.initialFillRows, 8);
    assert.equal(config.board.columns, 9);
    assert.equal(config.presentation.bubbleDiameter, 40.5);
    assert.equal(config.board.cellWidth, 40.5);
    assert.equal(config.board.cellHeight, 35.1);
    assert.ok((config.dangerLineY - lowest.bubbleBottom) * config.presentation.scale >= 100);
    assert.equal(lowest.crossed, false);
  });
});

test('Task 11.1 portrait shooter stays below danger with a visible gap', () => {
  const config = getRuntimeGameConfig(390, 844);
  const currentTop = config.shooter.y - config.physics.visualBubbleRadius;
  assert.ok(currentTop > config.dangerLineY);
  assert.ok(currentTop - config.dangerLineY >= 10);
});

test('Task 11.1 portrait next bubble stays inside the viewport', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const nextRadius = config.physics.visualBubbleRadius * 0.82;
    assert.ok(config.shooter.nextX - nextRadius >= 0);
    assert.ok(config.shooter.nextX + nextRadius <= width);
    assert.ok(config.shooter.nextY - nextRadius >= 0);
    assert.ok(config.shooter.nextY + nextRadius <= height);
  });
});

test('Task 11.1 portrait has no horizontal overflow in the canvas geometry', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    assert.ok(config.presentation.cssWidth <= width);
    assert.ok(config.presentation.cssHeight <= height - 16);
  });
});

test('Task 11.1 portrait pointer coordinates scale to the active game geometry', async () => {
  const source = await readFile(new URL('../src/game/Trajectory.js', import.meta.url), 'utf8');
  assert.match(source, /gameConfig\.baseWidth \/ canvasBounds\.width/);
  assert.match(source, /gameConfig\.baseHeight \/ canvasBounds\.height/);
  const config = getRuntimeGameConfig(390, 844);
  const canvas = { getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    width: config.presentation.cssWidth,
    height: config.presentation.cssHeight
  }) };
  const { screenToGameCoordinates } = await import('../src/game/Trajectory.js');
  assert.deepEqual(screenToGameCoordinates(
    config.presentation.cssWidth / 2,
    config.presentation.cssHeight / 2,
    canvas,
    config
  ), { x: 195, y: 325 });
});

test('Task 11.2 uses a large lower-half portrait touch aim zone', () => {
  assert.equal(getTouchAimZoneYStart(getRuntimeGameConfig(360, 800)), 325);
  assert.equal(getTouchAimZoneYStart(getRuntimeGameConfig(390, 844)), 325);
  assert.equal(getTouchAimZoneYStart(getRuntimeGameConfig(412, 915)), 325);
});

test('Task 11.2 applies the portrait touch aim offset above the finger', () => {
  const config = getRuntimeGameConfig(390, 844);
  assert.equal(config.touchAimOffsetY, -55);
  assert.deepEqual(getTouchAimTarget({ x: 195, y: 500 }, config), { x: 195, y: 445 });
});

test('Task 11.2 keeps the minimum touch drag distance at 16 CSS pixels', () => {
  assert.equal(MIN_TOUCH_DRAG_DISTANCE, 16);
  assert.equal(hasTouchDragExceeded({ x: 100, y: 100 }, { x: 112, y: 100 }), false);
  assert.equal(hasTouchDragExceeded({ x: 100, y: 100 }, { x: 116, y: 100 }), true);
});

test('Task 11.2 portrait pointerdown starts aim without an immediate launch', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerDown = source.slice(source.indexOf('function handlePointerDown'), source.indexOf('function handlePointerMove'));
  assert.doesNotMatch(pointerDown, /launchCurrentBubble/);
  assert.match(pointerDown, /setPointerCapture/);
});

test('Task 11.2 portrait drag over threshold launches only on pointerup', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerUp = source.slice(source.indexOf('function handlePointerUp'), source.indexOf('function restartGame'));
  assert.match(pointerUp, /hasTouchDragExceeded/);
  assert.match(pointerUp, /launchCurrentBubble/);
  assert.match(pointerUp, /!touchDragExceeded/);
});

test('Task 11.2 short portrait tap is cancelled without launch', () => {
  assert.equal(hasTouchDragExceeded({ x: 195, y: 700 }, { x: 195, y: 715 }), false);
});

test('Task 11.2 pointercancel clears the active touch aim', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerCancel = source.slice(source.indexOf('function handlePointerCancel'), source.indexOf('function drawBackground'));
  assert.match(pointerCancel, /clearPointerAim\(event\.pointerId\)/);
  assert.match(source, /function clearPointerAim/);
  assert.match(source, /function handleLostPointerCapture/);
});

test('Task 11.2 accepts only the first active pointer', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /activePointerId !== null/);
  assert.match(source, /event\.pointerId !== activePointerId/);
});

test('Task 11.2 preserves pointer capture release lifecycle', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /canvas\.setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /releasePointerCapture\(pointerId\)/);
  assert.match(source, /canvas\.releasePointerCapture\(pointerId\)/);
  assert.match(source, /canvas\.addEventListener\('lostpointercapture'/);
});

test('Portrait shooting keeps straight, angled, and bank trajectories valid', () => {
  const config = getRuntimeGameConfig(390, 700);
  const origin = config.shooter;
  const wallBounds = getWallBounds(config);
  const topBoundary = config.board.y - config.physics.physicsCollisionRadius;
  const targets = [
    ['straight', { x: origin.x, y: origin.y - 400 }, 'DIRECT'],
    ['slight-left', { x: origin.x - 50, y: origin.y - 300 }, 'DIRECT'],
    ['slight-right', { x: origin.x + 50, y: origin.y - 300 }, 'DIRECT'],
    ['left-bank', { x: 0, y: origin.y - 50 }, 'REFLECTION'],
    ['right-bank', { x: config.baseWidth, y: origin.y - 50 }, 'REFLECTION']
  ];

  targets.forEach(([name, target, expectedMode]) => {
    const plan = getTrajectoryPlan(
      origin,
      target,
      wallBounds,
      topBoundary,
      config.physics.minShootAngle,
      config.physics.maxShootAngle
    );
    const shot = createActiveShot(origin, plan.angle, 'blue', config);
    assert.ok(Number.isFinite(plan.angle), `${name} angle must be finite`);
    assert.equal(plan.mode, expectedMode, `${name} trajectory mode`);
    assert.ok(plan.points.length >= 2, `${name} must have a trajectory`);
    assert.ok(Number.isFinite(shot.velocity.x));
    assert.ok(Number.isFinite(shot.velocity.y));
  });
});

test('Task 17 outside-release input lifecycle completes one captured shot without duplication', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerUp = source.slice(source.indexOf('function handlePointerUp'), source.indexOf('function restartGame'));
  assert.match(pointerUp, /event\.pointerId !== activePointerId/);
  assert.match(pointerUp, /clearPointerAim\(event\.pointerId\)/);
  assert.match(pointerUp, /if \(!activeShot\)/);
  assert.equal((pointerUp.match(/launchCurrentBubble\(\)/g) ?? []).length, 1);
  assert.match(source, /function handleLostPointerCapture/);
  assert.match(source, /clearPointerAim\(null\)/);
});

test('Task 17 cached canvas geometry avoids layout reads during pointer movement', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const updateAimSource = source.slice(source.indexOf('function updateAim'), source.indexOf('function handlePointerDown'));
  assert.match(updateAimSource, /getGamePoint\(/);
  assert.doesNotMatch(updateAimSource, /getBoundingClientRect/);
  assert.match(source, /function refreshCanvasBounds/);
});

test('Task 11.2 portrait aim continues to use getShootAngle', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /getTrajectoryPlan\(/);
  assert.match(source, /getTouchAimTarget/);
});

test('Task 11.2 leaves desktop pointer mode and geometry unchanged', () => {
  assert.equal(GAME_CONFIG.layoutMode, 'DESKTOP');
  assert.equal(GAME_CONFIG.touchAimOffsetY, 0);
  assert.equal(GAME_CONFIG.shooter.x, 450);
  assert.equal(GAME_CONFIG.shooter.y, 660);
});

test('Task 11.2 touch lifecycle keeps game over, active shot, and refill locks', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerUp = source.slice(source.indexOf('function handlePointerUp'), source.indexOf('function restartGame'));
  assert.match(pointerUp, /if \(gameOver\)/);
  assert.match(pointerUp, /if \(!activeShot\)/);
  assert.match(pointerUp, /if \(!canShoot\(\)\)/);
  assert.match(source, /function getShootBlockReason\(\)/);
});

test('Portrait runtime exposes one shoot lock authority and deadlock diagnostics', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /window\.__debugShootState\s*=\s*\(\) => getShootStateSnapshot\(\)/);
  ['GAME_OVER', 'ACTIVE_SHOT', 'RESOLVING', 'REFILL', 'ROUND_CLEAR', 'POINTER_STATE'].forEach((reason) => {
    assert.match(source, new RegExp(`'${reason}'`));
  });
  assert.match(source, /PORTRAIT_SHOOTER_DEADLOCK/);
  assert.match(source, /BOARD_DANGER_WITHOUT_GAMEOVER/);
  assert.match(source, /refillSystem\.reset\(\);/);
  assert.match(source, /resolving = false;/);
});

test('Portrait deadlock recovery keeps visual configuration frozen', () => {
  const config = getRuntimeGameConfig(390, 844);
  assert.equal(config.presentation.bubbleDiameter, 40.5);
  assert.equal(config.board.columns, 9);
  assert.equal(config.board.cellWidth, 40.5);
  assert.equal(config.board.cellHeight, 35.1);
  assert.equal(config.board.initialFillRows, 8);
});

test('Task 11.2 converts 360x800 touch coordinates before applying offset', () => {
  const config = getRuntimeGameConfig(360, 800);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: config.presentation.cssWidth, height: config.presentation.cssHeight }) };
  const point = screenToGameCoordinates(config.presentation.cssWidth / 2, config.presentation.cssHeight * 0.8, canvas, config);
  assert.ok(Math.abs(point.x - config.baseWidth / 2) < 0.001);
  assert.ok(Math.abs(getTouchAimTarget(point, config).y - (config.baseHeight * 0.8 - 55)) < 0.001);
});

test('Task 11.2 converts 390x844 touch coordinates before applying offset', () => {
  const config = getRuntimeGameConfig(390, 844);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: config.presentation.cssWidth, height: config.presentation.cssHeight }) };
  const point = screenToGameCoordinates(config.presentation.cssWidth / 2, config.presentation.cssHeight * 0.8, canvas, config);
  assert.ok(Math.abs(point.x - config.baseWidth / 2) < 0.001);
  assert.ok(Math.abs(getTouchAimTarget(point, config).y - (config.baseHeight * 0.8 - 55)) < 0.001);
});

test('Task 11.2 converts 412x915 touch coordinates before applying offset', () => {
  const config = getRuntimeGameConfig(412, 915);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: config.presentation.cssWidth, height: config.presentation.cssHeight }) };
  const point = screenToGameCoordinates(config.presentation.cssWidth / 2, config.presentation.cssHeight * 0.8, canvas, config);
  assert.ok(Math.abs(point.x - config.baseWidth / 2) < 0.001);
  assert.ok(Math.abs(getTouchAimTarget(point, config).y - (config.baseHeight * 0.8 - 55)) < 0.001);
});

test('Task 11.2 keeps portrait angle clamps and trajectory physics shared', () => {
  const config = getRuntimeGameConfig(390, 844);
  const angle = getShootAngle(
    config.shooter,
    getTouchAimTarget({ x: 10, y: 500 }, config),
    config.physics.minShootAngle,
    config.physics.maxShootAngle
  );
  const points = getTrajectoryPoints(
    config.shooter,
    angle,
    getWallBounds(config),
    config.board.y - config.physics.physicsCollisionRadius
  );
  assert.ok(angle >= config.physics.minShootAngle && angle <= config.physics.maxShootAngle);
  assert.ok(points.length >= 2);
});

test('Task 12 portrait shooter and next bubble stay below danger at every target viewport', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
  const radius = getBoardVisualRadius(config);
    const nextRadius = radius * 0.82;
    const currentTop = config.shooter.y - radius;
    const nextTop = config.shooter.nextY - nextRadius;
    assert.ok(currentTop >= config.dangerLineY + 16);
    assert.ok(nextTop >= config.dangerLineY + 16);
    assert.ok(config.shooter.y + radius <= height);
    assert.ok(config.shooter.nextY + nextRadius <= height);
    assert.ok(Math.hypot(
      config.shooter.nextX - config.shooter.x,
      config.shooter.nextY - config.shooter.y
    ) > radius + nextRadius);
  });
});

test('Task 12 direct-shot-first keeps a vertical portrait aim direct', () => {
  const config = getRuntimeGameConfig(390, 844);
  const plan = getTrajectoryPlan(
    config.shooter,
    { x: config.shooter.x, y: config.shooter.y - 220 },
    getWallBounds(config),
    config.board.y - config.physics.physicsCollisionRadius,
    config.physics.minShootAngle,
    config.physics.maxShootAngle
  );
  const shot = createActiveShot(config.shooter, plan.angle, 'blue', config);
  assert.equal(plan.mode, 'DIRECT');
  assert.equal(plan.points.length, 2);
  assert.ok(Math.abs(plan.points[0].x - plan.points[1].x) < 0.001);
  assert.ok(Math.abs(shot.velocity.x) < 0.001);
  assert.ok(shot.velocity.y < 0);
});

test('Task 12 only uses reflection when the direct aim reaches a wall first', () => {
  const config = getRuntimeGameConfig(390, 844);
  const plan = getTrajectoryPlan(
    config.shooter,
    { x: 0, y: config.shooter.y - 7 },
    getWallBounds(config),
    config.board.y - config.physics.physicsCollisionRadius,
    config.physics.minShootAngle,
    config.physics.maxShootAngle
  );
  assert.equal(plan.mode, 'REFLECTION');
  assert.ok(plan.points.length > 2);
});

test('Task 12 preview and physics share one trajectory plan', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /aimAngle = getTrajectoryPlan\(/);
  assert.match(source, /const trajectoryPlan = getTrajectoryPlan\(/);
  assert.match(source, /createActiveShot\(\s*shooterOrigin,\s*aimAngle/);
});

test('Task 12 touch compensation is visual-only while physics uses the actual touch point', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /visualAimTarget = applyTouchOffset \? getTouchAimTarget/);
  assert.match(source, /aimTarget = point/);
  assert.match(source, /Touch compensation is visual-only/);
});

test('Task 12 restart transaction resets board, transient state, input, audio, and session', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const restart = source.slice(source.indexOf('function restartGame'), source.indexOf('function enterGameOver'));
  [
    /gameSessionId \+= 1/,
    /stageManager\.reset\(\)/,
    /refillSystem\.reset\(\)/,
    /shooter\.reset\(\)/,
    /effectsManager\.clear\(\)/,
    /activeShot = null/,
    /missTracker\.reset\(\)/,
    /scoreManager\.reset\(\)/,
    /audioManager\.resetGameOverMusic\(\)/,
    /gameOver = false/,
    /activePointerId = null/,
    /touchAimStart = null/
  ].forEach((pattern) => assert.match(restart, pattern));
});

test('Task 12 game-over pointerup handles restart before portrait pointer filtering', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const pointerUp = source.slice(source.indexOf('function handlePointerUp'), source.indexOf('function restartGame'));
  assert.ok(pointerUp.indexOf('if (gameOver)') < pointerUp.indexOf("event.pointerId !== activePointerId"));
  assert.match(pointerUp, /isPointInRestartButton\(point, GAME_CONFIG\)/);
  assert.match(pointerUp, /restartGame\(\)/);
});

test('Task 12 stale effect callbacks are guarded by the session id', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const sessionId = gameSessionId/);
  assert.match(source, /if \(sessionId !== gameSessionId\) return/);
});

test('Task 12 repeated reset transactions recreate a fresh initial board and shooter', () => {
  const board = new Board(GAME_CONFIG.board, GAME_CONFIG.colors);
  const stage = new StageManager(board);
  const refill = new RefillSystem(board, GAME_CONFIG.colors, GAME_CONFIG.refill);
  const effects = new EffectsManager(GAME_CONFIG.board);
  const shooter = new Shooter(GAME_CONFIG.shooter, null, GAME_CONFIG.colors);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    board.removeBubbles(board.getOccupiedBubbles());
    refill.start(1);
    effects.queuePop([{ col: 0, row: 0, bubbleType: 'red' }], () => {});
    shooter.launchCurrentBubble();
    stage.reset();
    refill.reset();
    effects.clear();
    shooter.reset();
    assert.equal(board.getOccupiedBubbles().length, GAME_CONFIG.board.columns * GAME_CONFIG.board.initialFillRows);
    assert.equal(refill.isActive(), false);
    assert.equal(effects.getActiveCount(), 0);
    assert.equal(shooter.currentBubble, 'blue');
    assert.equal(shooter.nextBubble, 'yellow');
  }
});

test('Task 12 desktop geometry remains unchanged while portrait shooter is danger-anchored', () => {
  assert.equal(GAME_CONFIG.baseWidth, 900);
  assert.equal(GAME_CONFIG.baseHeight, 700);
  assert.equal(GAME_CONFIG.dangerLineY, 625);
  assert.equal(GAME_CONFIG.shooter.y, 660);
  [360, 390, 412].forEach((width) => {
    const height = width === 360 ? 800 : width === 390 ? 844 : 915;
    const config = getRuntimeGameConfig(width, height);
    assert.ok(config.shooter.y - config.physics.visualBubbleRadius >= config.dangerLineY + 16);
    assert.ok(config.shooter.y + config.shooter.launcherBottomOffset
      <= height - config.shooter.bottomSafeArea);
  });
});

test('Task 13 portrait shooter UI uses one bottom safe-area geometry', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const radius = config.physics.visualBubbleRadius;
    const nextRadius = radius * 0.82;
    const currentTop = config.shooter.y - radius;
    const shooterVisualBottom = config.shooter.y + radius;
    const launcherBottom = config.shooter.y + config.shooter.launcherBottomOffset;
    const nextBubbleBottom = config.shooter.nextY + nextRadius;
    const nextOutlineBottom = config.shooter.nextY + config.shooter.nextOutlineRadius;
    const visualBottom = Math.max(
      shooterVisualBottom,
      launcherBottom,
      nextBubbleBottom,
      nextOutlineBottom
    );
    const nextLeft = config.shooter.nextX - config.shooter.nextOutlineRadius;
    const nextRight = config.shooter.nextX + config.shooter.nextOutlineRadius;
    const nextTop = config.shooter.nextY - config.shooter.nextOutlineRadius;

    assert.ok(currentTop >= config.dangerLineY + config.shooter.dangerSafetyGap);
    assert.ok(shooterVisualBottom <= height - config.shooter.bottomSafeArea);
    assert.ok(launcherBottom <= height - config.shooter.bottomSafeArea);
    assert.ok(nextLeft >= config.shooter.horizontalSafeArea);
    assert.ok(nextRight <= width - config.shooter.horizontalSafeArea);
    assert.ok(nextTop >= config.dangerLineY + config.shooter.dangerSafetyGap);
    assert.ok(nextOutlineBottom <= height - config.shooter.bottomSafeArea);
    assert.ok(Math.hypot(
      config.shooter.nextX - config.shooter.x,
      config.shooter.nextY - config.shooter.y
    ) > radius + nextRadius);
    assert.ok(height - visualBottom >= config.shooter.bottomSafeArea);
  });
});

test('Task 13 portrait geometry keeps next bubble beside the shooter and desktop unchanged', () => {
  const desktop = getRuntimeGameConfig(900, 700);
  assert.equal(desktop, GAME_CONFIG);
  assert.equal(desktop.shooter.x, 450);
  assert.equal(desktop.shooter.y, 660);
  assert.equal(desktop.shooter.nextX, 520);
  assert.equal(desktop.shooter.nextY, 675);

  const portrait = getRuntimeGameConfig(390, 844);
  assert.equal(portrait.shooter.nextY, portrait.shooter.y);
  assert.ok(portrait.shooter.nextX > portrait.shooter.x);
  assert.equal(portrait.dangerLineY, 556.35);
});

test('Task 14 rendered portrait shooter group stays inside CSS viewport space', () => {
  [
    [360, 800],
    [390, 844],
    [412, 915],
    [390, 700]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const rendered = getPortraitShooterGroupBounds(config, {
      canvasCssWidth: config.presentation.cssWidth,
      canvasCssHeight: config.presentation.cssHeight,
      visibleViewportHeight: height,
      canvasTop: config.presentation.cssTop,
      safeAreaInsetBottom: 0
    });

    assert.equal(rendered.scaleX, config.presentation.scale);
    assert.equal(rendered.scaleY, config.presentation.scale);
    assert.equal(rendered.belowDangerLine, true);
    assert.equal(rendered.bottomSafe, true);
    assert.ok(rendered.bottomSafeGap >= 16);
    assert.ok(rendered.currentBubble.top > rendered.renderedDangerLineY);
    assert.ok(rendered.currentBubble.bottom <= height - 16);
    assert.ok(rendered.nextBubble.top > rendered.renderedDangerLineY);
    assert.ok(rendered.nextBubble.bottom <= height - 16);
    assert.ok(rendered.nextBubble.left >= 0);
    assert.ok(rendered.nextBubble.right <= width);
    assert.ok(rendered.currentBubble.right < rendered.nextBubble.left);
  });
});

test('Task 14 rendered geometry converts internal coordinates when CSS canvas is shorter', () => {
  const config = getRuntimeGameConfig(390, 844);
  const rendered = getPortraitShooterGroupBounds(config, {
    canvasCssWidth: 390,
    canvasCssHeight: 600,
    visibleViewportHeight: 600,
    safeAreaInsetBottom: 0,
    minimumVisibleGap: 16
  });

  assert.ok(rendered.scaleY < 1);
  assert.equal(rendered.belowDangerLine, true);
  assert.equal(rendered.bottomSafe, true);
  assert.ok(rendered.bottomSafeGap >= 16);
  assert.ok(rendered.renderedShooterGroupBottom <= 600 - 16);
});

test('Task 14 portrait resize produces a new safe layout and keeps desktop unchanged', async () => {
  const fullViewport = getRuntimeGameConfig(390, 844);
  const reducedViewport = getRuntimeGameConfig(390, 700);
  const fullBounds = getPortraitShooterGroupBounds(fullViewport, {
    canvasCssWidth: fullViewport.presentation.cssWidth,
    canvasCssHeight: fullViewport.presentation.cssHeight,
    visibleViewportHeight: 844
  });
  const reducedBounds = getPortraitShooterGroupBounds(reducedViewport, {
    canvasCssWidth: reducedViewport.presentation.cssWidth,
    canvasCssHeight: reducedViewport.presentation.cssHeight,
    visibleViewportHeight: 700
  });
  assert.equal(fullViewport.shooter.y, reducedViewport.shooter.y);
    assert.equal(fullBounds.bottomSafe, true);
  assert.equal(reducedBounds.bottomSafe, true);

  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /window\.addEventListener\('orientationchange', resizeCanvas\)/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('resize', resizeCanvas\)/);
  assert.equal(getRuntimeGameConfig(900, 700), GAME_CONFIG);
});

test('Task 15 portrait shooter is anchored to Danger Line instead of viewport bottom', () => {
  const configs = [
    getRuntimeGameConfig(360, 800),
    getRuntimeGameConfig(390, 844),
    getRuntimeGameConfig(412, 915),
    getRuntimeGameConfig(390, 700)
  ];

  configs.forEach((config) => {
    const radius = config.physics.visualBubbleRadius;
    const groupTop = Math.min(
      config.shooter.y - radius,
      config.shooter.nextY - config.shooter.nextOutlineRadius
    );
    const groupBottom = Math.max(
      config.shooter.y + radius,
      config.shooter.y + config.shooter.launcherBottomOffset,
      config.shooter.nextY + config.shooter.nextOutlineRadius
    );
    assert.equal(config.shooter.y, config.dangerLineY + config.shooter.dangerSafetyGap + radius);
    assert.ok(groupTop - config.dangerLineY >= config.shooter.dangerSafetyGap);
    assert.ok(groupBottom <= config.baseHeight - 16);
    assert.ok(config.shooter.nextY - config.shooter.nextOutlineRadius > config.dangerLineY);
    assert.ok(Math.hypot(
      config.shooter.nextX - config.shooter.x,
      config.shooter.nextY - config.shooter.y
    ) > radius + radius * 0.82);
  });
});

test('Task 15 keeps portrait shooter position stable when only viewport bottom changes', () => {
  const tall = getRuntimeGameConfig(390, 915);
  const normal = getRuntimeGameConfig(390, 844);
  const reduced = getRuntimeGameConfig(390, 700);
  assert.equal(tall.shooter.y, normal.shooter.y);
  assert.equal(normal.shooter.y, reduced.shooter.y);
  assert.equal(tall.shooter.nextY, reduced.shooter.nextY);
  assert.equal(getRuntimeGameConfig(900, 700).shooter.y, GAME_CONFIG.shooter.y);
});

test('Task 16 cross-device portrait presentation scales the complete game into visible CSS space', () => {
  [
    [320, 568],
    [360, 640],
    [375, 667],
    [390, 650],
    [390, 700],
    [360, 800],
    [390, 844],
    [393, 852],
    [412, 915],
    [430, 932]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const expectedScale = Math.min(width / 390, (height - 16) / 650);
    const rendered = getPortraitShooterGroupBounds(config, {
      canvasCssWidth: config.presentation.cssWidth,
      canvasCssHeight: config.presentation.cssHeight,
      visibleViewportHeight: height,
      canvasTop: 0,
      safeAreaInsetBottom: 0,
      minimumVisibleGap: 16
    });

    assert.ok(Math.abs(config.presentation.scale - expectedScale) < 0.000001);
    assert.ok(config.presentation.cssWidth <= width);
    assert.ok(config.presentation.cssHeight <= height - 16);
    assert.equal(rendered.belowDangerLine, true);
    assert.equal(rendered.bottomSafe, true);
    assert.ok(rendered.renderedDangerLineY < rendered.renderedShooterGroupTop);
    assert.ok(rendered.currentBubble.left >= 0);
    assert.ok(rendered.currentBubble.right <= config.presentation.cssWidth);
    assert.ok(rendered.currentBubble.top >= 0);
    assert.ok(rendered.currentBubble.bottom <= config.presentation.cssHeight - 16);
    assert.ok(rendered.nextBubble.left >= 0);
    assert.ok(rendered.nextBubble.right <= config.presentation.cssWidth);
    assert.ok(rendered.nextBubble.top >= 0);
    assert.ok(rendered.nextBubble.bottom <= config.presentation.cssHeight - 16);
    assert.ok(rendered.renderedShooterGroupBottom <= config.presentation.cssHeight - 16);
    assert.ok(height - (rendered.renderedShooterGroupBottom) >= 16);
  });
});

test('Final mobile fix keeps senior-sized bubbles and every shooter visual inside portrait bounds', () => {
  [
    [320, 568],
    [360, 640],
    [375, 667],
    [390, 700],
    [360, 800],
    [390, 844],
    [393, 852],
    [412, 915],
    [430, 932]
  ].forEach(([width, height]) => {
    const config = getRuntimeGameConfig(width, height);
    const rendered = getPortraitShooterGroupBounds(config, {
      canvasCssWidth: config.presentation.cssWidth,
      canvasCssHeight: config.presentation.cssHeight,
      visibleViewportHeight: height,
      minimumVisibleGap: 16
    });
    const bubbleDiameter = config.presentation.bubbleDiameter * config.presentation.scale;
    const boardWidth = (
      (config.board.columns - 1) * config.board.cellWidth
      + config.presentation.bubbleDiameter
      + config.board.cellWidth / 2
    ) * config.presentation.scale;

    assert.ok(bubbleDiameter >= 26);
    if (width >= 360 && width <= 430) {
      assert.ok(bubbleDiameter >= 28);
    }
    assert.ok(boardWidth / width >= 0.90);
    assert.ok(rendered.renderedDangerLineY < rendered.renderedShooterGroupTop);
    assert.ok(rendered.currentBubble.bottom <= config.presentation.cssHeight - 16);
    assert.ok(rendered.nextBubble.bottom <= config.presentation.cssHeight - 16);
    assert.ok(rendered.renderedShooterGroupBottom <= config.presentation.cssHeight - 16);
    assert.ok(rendered.bottomSafeGap >= 16);
    assert.ok(rendered.currentBubble.right < rendered.nextBubble.left);
  });
});

test('refill pressure uses four rows while the board remains above danger', () => {
  const board = createBoard();
  assert.equal(getRefillRowsForPressure(board, GAME_CONFIG), 4);
  assert.equal(GAME_CONFIG.physics.visualWallSafetyRadius, 25);
});

test('low-bubble refill uses one or two rows and never applies to a clear board', () => {
  assert.equal(getLowBubbleRefillRows(0), 0);
  assert.equal(getLowBubbleRefillRows(10), 2);
  assert.equal(getLowBubbleRefillRows(19), 2);
  assert.equal(getLowBubbleRefillRows(20), 1);
  assert.equal(getLowBubbleRefillRows(25), 1);
  assert.equal(getLowBubbleRefillRows(35), 0);
  assert.equal(getLowBubbleRefillRows(40), 0);
});

test('low-bubble refill falls back from two rows to one when the safety gap requires it', () => {
  const board = createBoard();
  board.removeBubbles(board.getOccupiedBubbles());
  for (let col = 0; col < 10; col += 1) board.addBubble(col, 8, 'blue');
  const refill = new RefillSystem(board, GAME_CONFIG.colors, { rowsPerTrigger: 2 });
  const added = refill.start(2, {
    fallbackRows: [1],
    dangerLineY: GAME_CONFIG.dangerLineY,
    bubbleRadius: GAME_CONFIG.physics.visualBubbleRadius,
    minimumSafetyGap: GAME_CONFIG.minimumDangerSafetyGap
  });
  assert.equal(added.length, GAME_CONFIG.board.columns);
  assert.equal(board.getBubble(0, 9).bubbleType, 'blue');
  assert.ok(getDangerDistance(board, GAME_CONFIG.dangerLineY, GAME_CONFIG.physics.visualBubbleRadius) >= 80);
});

test('miss tracker starts with three chances and refills at three misses', () => {
  const tracker = new MissTracker(GAME_CONFIG.missesBeforeRefill);
  assert.deepEqual(tracker.getState(), { missCount: 0, chances: 3, shouldRefill: false });

  for (let count = 1; count <= 2; count += 1) {
    const state = tracker.registerShot(2);
    assert.equal(state.missCount, count);
    assert.equal(state.chances, 3 - count);
    assert.equal(state.shouldRefill, false);
  }

  assert.deepEqual(tracker.registerShot(2), {
    missCount: 3,
    chances: 0,
    shouldRefill: true
  });
  tracker.reset();
  assert.equal(tracker.getState().chances, 3);
});

test('successful matches recover one chance without exceeding the limit', () => {
  const tracker = new MissTracker(GAME_CONFIG.missesBeforeRefill);
  tracker.registerShot(0);
  tracker.registerShot(0);
  tracker.registerShot(0);
  assert.equal(tracker.getState().chances, 0);
  assert.equal(tracker.registerShot(3).chances, 1);
  assert.equal(tracker.registerShot(3).chances, 2);
  assert.equal(tracker.registerShot(3).chances, 3);
  assert.equal(tracker.registerShot(3).chances, 3);
});

test('repeated misses can trigger refill and eventually game over', () => {
  const board = createBoard();
  const tracker = new MissTracker(GAME_CONFIG.missesBeforeRefill);
  let gameOver = false;
  let refillCount = 0;

  for (let shot = 0; shot < 12 && !gameOver; shot += 1) {
    const state = tracker.registerShot(0);
    if (state.shouldRefill) {
      const refill = refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: refillCount });
      if (!refill.success || isDangerLineReached(board, GAME_CONFIG.dangerLineY, GAME_CONFIG.physics.physicsCollisionRadius)) {
        gameOver = true;
      } else {
        refillCount += 1;
        tracker.reset();
      }
    }
  }

  assert.equal(refillCount, 0);
  assert.equal(gameOver, true);
});

test('refill shifts bubbles by four rows and adds four clustered fourteen-bubble rows', () => {
  const board = createBoard();
  const result = refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: 0 });

  assert.equal(result.success, true);
  assert.equal(result.bubbles.length, 56);
  assert.equal(board.getOccupiedBubbles().length, 182);
  assert.ok(GAME_CONFIG.colors.includes(board.getBubble(0, 0).bubbleType));
  assert.ok(GAME_CONFIG.colors.includes(board.getBubble(0, 1).bubbleType));
  assert.equal(board.getBubble(0, 4).y, GAME_CONFIG.board.y + GAME_CONFIG.board.cellHeight * 4);
  assert.equal(board.getBubble(0, 1).x, gridToWorld(0, 1, GAME_CONFIG.board).x);
  assert.ok(GAME_CONFIG.colors.includes(board.getBubble(1, 0).bubbleType));
  assert.ok(GAME_CONFIG.colors.includes(board.getBubble(2, 0).bubbleType));
  assert.equal(board.isOccupied(0, 0), true);
});

test('Task 08.8 refill uses the raised origin and presses down four shared grid rows', () => {
  const board = createBoard();
  const before = board.getBubble(0, 8);
  const beforeDistance = GAME_CONFIG.dangerLineY - (before.y + GAME_CONFIG.physics.visualBubbleRadius);
  const result = refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: 0 });
  const shifted = board.getBubble(0, 12);
  const afterDistance = GAME_CONFIG.dangerLineY - (shifted.y + GAME_CONFIG.physics.visualBubbleRadius);

  assert.equal(result.success, true);
  assert.equal(shifted.y - before.y, GAME_CONFIG.board.cellHeight * 4);
  assert.equal(afterDistance, beforeDistance - GAME_CONFIG.board.cellHeight * 4);
  assert.equal(shifted.x, gridToWorld(0, 12, GAME_CONFIG.board).x);
  assert.equal(board.getBubble(1, 4).x, gridToWorld(1, 4, GAME_CONFIG.board).x);
});

test('two rapid refills move the board toward the danger line after a safe opening', () => {
  const board = createBoard();
  const initialDistance = getDangerDistance(
    board,
    GAME_CONFIG.dangerLineY,
    GAME_CONFIG.physics.visualBubbleRadius
  );
  assert.equal(initialDistance, 175);
  assert.equal(refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: 0 }).bubbles.length, 56);
  const firstDistance = getDangerDistance(
    board,
    GAME_CONFIG.dangerLineY,
    GAME_CONFIG.physics.visualBubbleRadius
  );
  assert.ok(firstDistance < 0);
  assert.equal(refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: 4 }).bubbles.length, 56);
  assert.ok(getDangerDistance(board, GAME_CONFIG.dangerLineY, GAME_CONFIG.physics.visualBubbleRadius) < 0);
});

test('four-row refill preserves bottom-row bubble state while pressing downward', () => {
  const board = createBoard();
  board.addBubble(0, GAME_CONFIG.board.rows - 1, 'purple');
  const before = board.getOccupiedBubbles().length;
  const result = refillBoard(board, { colors: GAME_CONFIG.colors, rowIndex: 1 });

  assert.equal(result.success, true);
  assert.equal(result.bubbles.length, 56);
  assert.equal(board.getOccupiedBubbles().length, before + 56);
  assert.equal(board.getBubble(0, GAME_CONFIG.board.rows + 3).bubbleType, 'purple');
});

test('danger line detection is based on bubble world position and radius', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 11 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  assert.equal(isDangerLineReached(board, testConfig.dangerLineY, 25), false);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 10, 'red');
  assert.equal(isDangerLineReached(board, testConfig.dangerLineY, 25), true);
});

test('checkGameOver uses the visual bubble radius at the exact danger boundary', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 11 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const boundaryBubble = board.addBubble(0, 10, 'red');

  assert.equal(checkGameOver(board, testConfig), true);

  board.removeBubble(boundaryBubble.col, boundaryBubble.row);
  board.addBubble(0, 9, 'red');
  assert.equal(checkGameOver(board, testConfig), false);
});

test('checkGameOver remains independent from the smaller physics collision radius', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 11 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const bubble = board.addBubble(0, 10, 'blue');
  const position = getBubbleWorldPosition(bubble, testConfig.board);

  assert.ok(
    position.y + testConfig.physics.physicsCollisionRadius < testConfig.dangerLineY
  );
  assert.equal(checkGameOver(board, testConfig), true);
});

test('danger checks and rendering geometry share gridToWorld positions', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 11 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());

  const rowAbove = board.addBubble(0, 9, 'red');
  const firstDangerRow = board.addBubble(1, 10, 'blue');
  const expected = getBubbleWorldPosition(firstDangerRow, testConfig.board);

  assert.equal(expected.y, 600);
  assert.equal(rowAbove.y + testConfig.physics.visualBubbleRadius < testConfig.dangerLineY, true);
  assert.equal(isBubbleAtDangerLine(rowAbove, testConfig), false);
  assert.equal(isBubbleAtDangerLine(firstDangerRow, testConfig), true);
  assert.equal(checkGameOver(board, testConfig), true);
  assert.equal(firstDangerRow.x, expected.x);
  assert.equal(firstDangerRow.y, expected.y);
});

test('danger checks ignore stale cached bubble y and use the real grid row', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 11 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const bubble = board.addBubble(0, 10, 'purple');
  bubble.y = -1000;

  assert.equal(checkGameOver(board, testConfig), true);
});

test('danger boundary uses the authoritative rendered center and includes exact touch', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());

  for (const [centerY, expected] of [[599, false], [600, true], [601, true]]) {
    const bubble = board.addBubble(0, 0, 'red');
    bubble.row = (centerY - testConfig.board.y) / testConfig.board.cellHeight;
    assert.equal(getBubbleRenderPosition(bubble, testConfig.board).y + 25 >= 625, expected);
    assert.equal(checkGameOver(board, testConfig), expected);
    board.removeBubble(bubble.col, bubble.row);
  }
});

test('portrait danger boundary uses the 40.5px rendered board radius', () => {
  const portrait = getRuntimeGameConfig(390, 700);
  const testConfig = {
    ...portrait,
    board: { ...portrait.board, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const radius = getBoardVisualRadius(testConfig);

  assert.equal(radius, 20.25);
  assert.equal(testConfig.board.cellWidth, 40.5);
  assert.equal(testConfig.board.cellHeight, 35.1);
  assert.equal(testConfig.board.columns, 9);

  for (const [offset, expected] of [[-1, false], [0, true], [1, true]]) {
    const bubble = board.addBubble(0, 0, 'red');
    bubble.row = (testConfig.dangerLineY - radius + offset - testConfig.board.y)
      / testConfig.board.cellHeight;
    assert.equal(
      getBubbleWorldPosition(bubble, testConfig.board).y + radius >= testConfig.dangerLineY,
      expected
    );
    assert.equal(isBubbleAtDangerLine(bubble, testConfig), expected);
    assert.equal(checkGameOver(board, testConfig), expected);
    board.removeBubble(bubble.col, bubble.row);
  }
});

test('portrait landing and refill stop at the same visible danger threshold', () => {
  const portrait = getRuntimeGameConfig(390, 700);
  const testConfig = {
    ...portrait,
    board: { ...portrait.board, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const activeShot = { bubbleType: 'blue' };

  const safeLanding = commitLanding(
    activeShot,
    { col: 0, row: 11, ...gridToWorld(0, 11, testConfig.board) },
    board,
    testConfig,
    { topLanding: false }
  );
  assert.equal(safeLanding.status, 'landed');

  board.removeBubble(0, 11);
  const dangerLanding = commitLanding(
    activeShot,
    { col: 0, row: 12, ...gridToWorld(0, 12, testConfig.board) },
    board,
    testConfig,
    { topLanding: false }
  );
  assert.equal(dangerLanding.status, 'danger');

  board.addBubble(0, 11, 'red');
  const before = board.getOccupiedBubbles().map((bubble) => ({ ...bubble }));
  const refill = refillBoard(board, {
    colors: testConfig.colors,
    rowsPerTrigger: 1,
    dangerLineY: testConfig.dangerLineY,
    bubbleRadius: getBoardVisualRadius(testConfig)
  });
  assert.equal(refill.success, false);
  assert.deepEqual(board.getOccupiedBubbles(), before);
});

test('portrait refill records a projected danger block for immediate Game Over', () => {
  const portrait = getRuntimeGameConfig(390, 700);
  const boardConfig = { ...portrait.board, rows: 20 };
  const board = new Board(boardConfig, portrait.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 11, 'red');
  const refill = new RefillSystem(board, portrait.colors, { rowsPerTrigger: 1 });
  const result = refill.start(1, {
    dangerLineY: portrait.dangerLineY,
    bubbleRadius: getBoardVisualRadius(portrait)
  });

  assert.equal(result, null);
  assert.equal(refill.lastStartBlockedByDanger, true);
  assert.equal(board.getBubble(0, 11).bubbleType, 'red');
});

test('dense portrait legal landings stop before a danger-row pile-up', () => {
  const portrait = getRuntimeGameConfig(390, 700);
  const testConfig = { ...portrait, board: { ...portrait.board, rows: 20 } };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());

  for (let row = 0; row <= 10; row += 1) {
    for (let col = 0; col < testConfig.board.columns; col += 1) {
      board.addBubble(col, row, row % 2 === 0 ? 'red' : 'blue');
    }
  }
  const beforeSafeLanding = board.getOccupiedBubbles().length;
  const safe = commitLanding(
    { bubbleType: 'green' },
    { col: 0, row: 11, ...gridToWorld(0, 11, testConfig.board) },
    board,
    testConfig
  );
  assert.equal(safe.status, 'landed');
  assert.equal(checkGameOver(board, testConfig), false);
  assert.equal(board.getOccupiedBubbles().length, beforeSafeLanding + 1);

  const beforeDangerLanding = board.getOccupiedBubbles().length;
  const danger = commitLanding(
    { bubbleType: 'yellow' },
    { col: 0, row: 12, ...gridToWorld(0, 12, testConfig.board) },
    board,
    testConfig
  );
  assert.equal(danger.status, 'danger');
  assert.equal(board.getOccupiedBubbles().length, beforeDangerLanding);
  assert.equal(checkGameOver(board, testConfig), false);
  assert.ok(danger.targetBottom >= testConfig.dangerLineY);
});

test('portrait dense-board turn invariant never leaves a non-game-over locked state', () => {
  const portrait = getRuntimeGameConfig(390, 844);
  const testConfig = { ...portrait, board: { ...portrait.board, rows: 20 } };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  let gameOverState = false;
  let activeShotState = true;

  for (let row = 0; row <= 12; row += 1) {
    const result = commitLanding(
      { bubbleType: row % 2 === 0 ? 'red' : 'blue' },
      { col: 0, row, ...gridToWorld(0, row, testConfig.board) },
      board,
      testConfig
    );
    activeShotState = false;
    if (result.status === 'danger' || checkGameOver(board, testConfig)) {
      gameOverState = true;
    }
    assert.ok(
      gameOverState || !activeShotState,
      `turn ${row} must either enter Game Over or release the shooter lock`
    );
    if (gameOverState) break;
    activeShotState = true;
  }

  assert.equal(gameOverState, true);
  assert.equal(activeShotState, false);
});

test('danger checker ignores shooter and pre-landing shot state', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const shooterBubble = { col: 0, row: 10, bubbleType: 'red', x: 0, y: 0 };
  assert.equal(checkGameOver(board, testConfig), false);
  assert.equal(isBubbleAtDangerLine(shooterBubble, testConfig), true);
});

test('danger checker ignores a cached y that falsely appears to touch the line', () => {
  const testConfig = {
    ...GAME_CONFIG,
    dangerLineY: 625,
    board: { ...GAME_CONFIG.board, y: 100, rows: 20 }
  };
  const board = new Board(testConfig.board, testConfig.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  const bubble = board.addBubble(0, 9, 'red');
  bubble.y = 600;

  assert.equal(getBubbleRenderPosition(bubble, testConfig.board).y, 550);
  assert.equal(checkGameOver(board, testConfig), false);
});

test('renderer and danger checker share the same row/col render position helper', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const refillSource = await readFile(new URL('../src/game/RefillSystem.js', import.meta.url), 'utf8');
  assert.match(mainSource, /getBubbleRenderPosition\(bubble, GAME_CONFIG\.board\)/);
  assert.match(refillSource, /return getBubbleRenderPosition\(bubble, boardConfig\)/);
  assert.match(mainSource, /PORTRAIT_GAMEOVER_INVARIANT_VIOLATION/);
});

test('game over locks shoot and refill entry points and exposes exact-touch helpers', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /if \(gameOver\) \{\s*return;\s*\}/);
  assert.match(mainSource, /window\.__forceDangerExactTouch/);
  assert.match(mainSource, /window\.__forceDangerOnePixelSafe/);
  assert.match(mainSource, /window\.__debugPortraitGameOver/);
  assert.match(mainSource, /getRenderedDangerGeometry/);
  assert.match(mainSource, /lastLandingGameOverCheck/);
  assert.match(mainSource, /lastRefillGameOverCheck/);
  assert.match(mainSource, /checkBoardGameOver\('frame'/);
  assert.match(mainSource, /activeShot = null;/);
  assert.match(mainSource, /refillSystem\.reset\(\);/);
});

test('danger geometry identifies the last safe row and first game-over row', () => {
  const boardConfig = { ...GAME_CONFIG.board, y: 25, cellHeight: 50, rows: 20 };
  const dangerLineY = 625;
  const radius = 25;
  const rows = Array.from({ length: 13 }, (_, row) => ({
    row,
    centerY: getBubbleRenderPosition({ col: 0, row }, boardConfig).y,
    bottom: getBubbleRenderPosition({ col: 0, row }, boardConfig).y + radius
  }));
  const lastSafe = rows.filter(({ bottom }) => bottom < dangerLineY).at(-1);
  const firstDanger = rows.find(({ bottom }) => bottom >= dangerLineY);

  assert.deepEqual(lastSafe, { row: 11, centerY: 575, bottom: 600 });
  assert.deepEqual(firstDanger, { row: 12, centerY: 625, bottom: 650 });
});

test('central gameplay insertion gate rejects danger bubbles before mutation', () => {
  const boardConfig = { ...GAME_CONFIG.board, y: 25, rows: 20 };
  const board = new Board(boardConfig, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());

  const safe = board.addGameplayBubble(0, 10, 'red', { dangerLineY: 625, bubbleRadius: 25 });
  const beforeDangerAttempt = board.getOccupiedBubbles().length;
  const danger = board.addGameplayBubble(1, 12, 'purple', { dangerLineY: 625, bubbleRadius: 25 });

  assert.ok(safe);
  assert.equal(danger, null);
  assert.equal(board.getOccupiedBubbles().length, beforeDangerAttempt);
});

test('refill shift obeys the central danger insertion invariant', () => {
  const boardConfig = { ...GAME_CONFIG.board, y: 25, rows: 20 };
  const board = new Board(boardConfig, GAME_CONFIG.colors);
  board.removeBubbles(board.getOccupiedBubbles());
  board.addBubble(0, 11, 'red');
  const before = board.getOccupiedBubbles().map((bubble) => ({ ...bubble }));
  const result = refillBoard(board, {
    colors: GAME_CONFIG.colors,
    rowsPerTrigger: 1,
    dangerLineY: 625,
    bubbleRadius: 25
  });

  assert.equal(result.success, false);
  assert.deepEqual(board.getOccupiedBubbles(), before);
});

test('render diagnostics classify every visible bubble source and prevent landing duplicates', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const effectsSource = await readFile(new URL('../src/game/EffectsManager.js', import.meta.url), 'utf8');
  const shooterSource = await readFile(new URL('../src/game/Shooter.js', import.meta.url), 'utf8');

  assert.match(mainSource, /source: 'BOARD'/);
  assert.match(mainSource, /source: 'ACTIVE_SHOT'/);
  assert.match(shooterSource, /source: 'SHOOTER_CURRENT'/);
  assert.match(shooterSource, /source: 'SHOOTER_NEXT'/);
  assert.match(effectsSource, /source: 'POP_EFFECT'/);
  assert.match(effectsSource, /source: 'FLOATING_EFFECT'/);
  assert.match(effectsSource, /source: 'REFILL_EFFECT'/);
  assert.doesNotMatch(mainSource, /source: 'LANDING_EFFECT'/);
  assert.match(mainSource, /window\.__debugAllRenderedBubbles/);
  assert.match(mainSource, /PORTRAIT_GAMEOVER_INVARIANT_VIOLATION/);
});

test('successful landing clears active shot in the same transaction', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const landingIndex = mainSource.indexOf('const landingResult = commitLanding(');
  const clearIndex = mainSource.indexOf('activeShot = null;', landingIndex);
  const effectsIndex = mainSource.indexOf('effectsManager.queuePop', landingIndex);

  assert.ok(landingIndex >= 0);
  assert.ok(clearIndex > landingIndex);
  assert.ok(effectsIndex > landingIndex);
  assert.equal(mainSource.includes('queueLanding'), false);
});

test('game over records board count and locks future pointer input', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /boardCountAtGameOver = board\.getOccupiedBubbles\(\)\.length/);
  assert.match(mainSource, /if \(gameOver\) \{[\s\S]*?pointerIsDown = false;[\s\S]*?return;/);
  assert.match(mainSource, /if \(gameOver\) \{\s*return;\s*\}/);
});

test('refill system blocks during its animation lifecycle and resets cleanly', () => {
  const board = createBoard();
  const refill = new RefillSystem(board, GAME_CONFIG.colors, GAME_CONFIG.refill);
  assert.equal(refill.isActive(), false);
  assert.equal(refill.start().length, GAME_CONFIG.board.columns * 4);
  assert.equal(refill.isActive(), true);
  assert.equal(refill.start(), null);
  refill.update(399);
  assert.equal(refill.isActive(), true);
  refill.update(1);
  assert.equal(refill.isActive(), false);
  refill.reset();
  assert.equal(refill.isActive(), false);
});

test('sequential pop effects trigger ten audio events at 75ms intervals', () => {
  const effects = new EffectsManager(GAME_CONFIG.board);
  const cells = Array.from({ length: 10 }, (_, col) => ({ col, row: 0, bubbleType: 'red' }));
  const events = [];
  let elapsed = 0;
  effects.queuePop(cells, () => events.push(elapsed));

  effects.update(0);
  for (let step = 0; step < 52; step += 1) {
    elapsed += 15;
    effects.update(15);
  }

  assert.equal(events.length, 10);
  assert.deepEqual(events.slice(1).map((time, index) => time - events[index]), [75, 75, 75, 75, 75, 75, 75, 75, 75]);
});

test('Task 10 shoot/contact/pop designs use short original SFX layers', async () => {
  const audioSource = await readFile(new URL('../src/game/AudioManager.js', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.equal(SHOOT_SOUND.durationMs <= 110, true);
  assert.equal(SHOOT_SOUND.transientDurationMs >= 20, true);
  assert.equal(SHOOT_SOUND.oscillatorType, 'triangle');
  assert.equal((audioSource.match(/playTone\(/g) ?? []).length > 0, true);
  assert.equal(audioSource.includes('setTimeout(() => {\n        this.playTone(587'), false);
  assert.equal(audioSource.includes('setTimeout(() => {\n        this.playTone(784'), false);

  assert.equal(CONTACT_SOUND.durationMs <= 80, true);
  assert.equal(CONTACT_SOUND.oscillatorType === 'sine' || CONTACT_SOUND.oscillatorType === 'triangle', true);
  assert.equal(CONTACT_SOUND.transientDurationMs <= 12, true);

  assert.equal(POP_VARIATIONS.length, 4);
  assert.equal(POP_VARIATIONS.every((variation) => variation.durationMs <= 70), true);
  assert.equal(POP_VARIATIONS.every((variation) => variation.durationMs < 75), true);
  assert.equal(POP_VARIATIONS.every((variation) => ['sine', 'triangle'].includes(variation.oscillatorType)), true);
  assert.equal(POP_VARIATIONS.every((variation) => variation.transientDurationMs >= 10 && variation.transientDurationMs <= 20), true);

  assert.equal((mainSource.match(/audioManager\.playHitBubble\(\)/g) ?? []).length, 1);
  assert.equal(mainSource.indexOf('audioManager.playHitBubble();') > mainSource.indexOf('commitLanding('), true);
});

test('Task 10 keeps visual and audio pop triggers on the same effect callback', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const effectsSource = await readFile(new URL('../src/game/EffectsManager.js', import.meta.url), 'utf8');

  assert.match(mainSource, /effectsManager\.queuePop\(resolution\.matched/);
  assert.match(mainSource, /audioManager\.playPop\(index\)/);
  assert.match(effectsSource, /onStart\?\.\(cell\)/);
  assert.match(effectsSource, /onPop\?\.\(popCell, index\)/);
  assert.equal(POP_VARIATIONS.every((variation) => variation.durationMs < 75), true);
});

test('score applies match, floating, and large-group bonus rules', () => {
  const score = new ScoreManager();
  assert.equal(score.getScore(), 0);
  score.addMatch(3);
  assert.equal(score.getScore(), 30);
  score.addMatch(10);
  assert.equal(score.getScore(), 230);
  score.addFloating(8);
  assert.equal(score.getScore(), 390);
  assert.equal(score.getDisplayScore(), '390');
  assert.equal(Number.isNaN(score.getScore()), false);
  score.reset();
  assert.equal(score.getScore(), 0);
});

test('game over music plays once and remains silent while muted', () => {
  const audio = new AudioManager(1.0);
  assert.equal(audio.playGameOverMusic(), true);
  assert.equal(audio.playGameOverMusic(), false);
  assert.ok(GAME_OVER_MUSIC_GAIN > 0.9);
  assert.ok(GAME_OVER_NOTE_GAIN_MULTIPLIER >= 1.8 && GAME_OVER_NOTE_GAIN_MULTIPLIER <= 2.5);
  assert.equal(GAME_OVER_NOTE_GAIN_MULTIPLIER, 2.2);
  assert.equal(GAME_OVER_MUSIC_GAIN, 1.1);
  assert.ok(Math.abs(
    Math.max(...GAME_OVER_MUSIC_SEQUENCE.map((note) => note.volume)) * GAME_OVER_NOTE_GAIN_MULTIPLIER - 0.22
  ) < 0.000001);
  assert.equal(new AudioManager(0.65).masterVolume, 0.65);
  assert.ok(audio.gameOverTimers.length > 0);
  assert.equal(GAME_OVER_MUSIC_SEQUENCE.at(-1).frequency, 392);
  assert.ok(GAME_OVER_MUSIC_SEQUENCE.at(-1).durationMs >= 400);
  assert.ok(GAME_OVER_MUSIC_SEQUENCE.at(-1).delayMs + GAME_OVER_MUSIC_SEQUENCE.at(-1).durationMs >= 3000);
  audio.resetGameOverMusic();
  assert.deepEqual(audio.gameOverTimers, []);
  audio.setMuted(true);
  assert.equal(audio.playGameOverMusic(), false);
  audio.resetGameOverMusic();
});

test('Game Over loudness keeps the dedicated gain chain and compressor', async () => {
  const audioSource = await readFile(new URL('../src/game/AudioManager.js', import.meta.url), 'utf8');
  assert.match(audioSource, /gameOverGain\.connect\(this\.masterGain\)/);
  assert.match(audioSource, /this\.masterGain\.connect\(this\.compressor\)/);
  assert.match(audioSource, /this\.compressor\.connect\(this\.audioContext\.destination\)/);
  assert.match(audioSource, /createDynamicsCompressor\(\)/);
  assert.doesNotMatch(audioSource, /this\.masterGain\.gain\.value\s*=\s*[^;]*GAME_OVER/);
});

test('正式 Game Over 流程只觸發 Game Over Music，不觸發 Coin Cascade', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal((mainSource.match(/audioManager\.playGameOverMusic\(\)/g) ?? []).length, 1);
  assert.equal((mainSource.match(/audioManager\.playGameOverCoinCascade\(\)/g) ?? []).length, 0);
});

test('Game Over coin cascade plans many staggered varied coin events', () => {
  let seed = 0;
  const random = () => {
    seed = (seed + 0.173) % 1;
    return seed;
  };
  const plan = createCoinCascadePlan(random);
  const pitchIndexes = new Set(plan.map((event) => event.pitchIndex));
  const delays = new Set(plan.map((event) => event.delayMs));
  const totalDuration = plan.at(-1).delayMs
    + plan.at(-1).durationMs
    + plan.at(-1).bounceDelayMs;

  assert.ok(plan.length >= 18 && plan.length <= 30);
  assert.equal(COIN_PITCH_VARIATIONS.length, 6);
  assert.ok(pitchIndexes.size >= 4);
  assert.ok(delays.size > 1);
  assert.ok(plan.slice(1).every((event, index) => {
    const gap = event.delayMs - plan[index].delayMs;
    return gap >= 20 && gap <= 100;
  }));
  assert.ok(totalDuration >= 1500 && totalDuration <= 2500);
  assert.ok(plan.some((event) => event.hasBounce));
});

test('Game Over coin cascade honors mute and reset cancellation state', () => {
  const audio = new AudioManager(1.0);
  audio.setMuted(true);
  assert.equal(audio.playGameOverCoinCascade(), false);
  audio.resetGameOverMusic();
  assert.equal(audio.gameOverCoinPlayed, false);
  assert.deepEqual(audio.gameOverCoinTimers, []);
});
