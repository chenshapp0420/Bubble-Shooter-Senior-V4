export function getStageFillRows(stage, boardConfig) {
  return Math.min(
    boardConfig.rows,
    stage >= 3 ? boardConfig.initialFillRows + 1 : boardConfig.initialFillRows
  );
}

export class StageManager {
  constructor(board) {
    this.board = board;
    this.stage = 1;
  }

  reset() {
    this.stage = 1;
    this.board.reset(getStageFillRows(this.stage, this.board.config), this.stage);
  }

  startNextStage() {
    this.stage += 1;
    this.board.reset(getStageFillRows(this.stage, this.board.config), this.stage);
    return this.stage;
  }

  getStage() {
    return this.stage;
  }

  getFillRows() {
    return getStageFillRows(this.stage, this.board.config);
  }
}
