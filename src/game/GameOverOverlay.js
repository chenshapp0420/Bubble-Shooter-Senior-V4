export function getRestartButtonRect(config) {
  return {
    x: (config.baseWidth - 300) / 2,
    y: config.baseHeight / 2 + 170,
    width: 300,
    height: 60
  };
}

export function isPointInRestartButton(point, config) {
  const rect = getRestartButtonRect(config);
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function renderGameOverOverlay(context, config, { score, stage }) {
  const panel = {
    x: (config.baseWidth - 480) / 2,
    y: 280,
    width: 480,
    height: 320
  };
  const button = getRestartButtonRect(config);

  context.save();
  context.fillStyle = 'rgba(3, 9, 20, 0.68)';
  context.fillRect(0, 0, config.baseWidth, config.baseHeight);
  context.fillStyle = 'rgba(8, 24, 46, 0.96)';
  context.fillRect(panel.x, panel.y, panel.width, panel.height);
  context.strokeStyle = 'rgba(255, 134, 134, 0.72)';
  context.lineWidth = 2;
  context.strokeRect(panel.x, panel.y, panel.width, panel.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff1f1';
  context.font = '900 48px system-ui, sans-serif';
  context.fillText('遊戲結束', config.baseWidth / 2, panel.y + 62);
  context.fillStyle = '#ffffff';
  context.font = '900 38px system-ui, sans-serif';
  context.fillText(`得分 ${score}分`, config.baseWidth / 2, panel.y + 133);
  context.fillStyle = '#ffd2d2';
  context.font = '700 20px system-ui, sans-serif';
  context.fillText(`STAGE ${stage}`, config.baseWidth / 2, panel.y + 183);
  context.fillStyle = '#e4f3ff';
  context.fillRect(button.x, button.y, button.width, button.height);
  context.strokeStyle = 'rgba(221, 242, 255, 0.76)';
  context.strokeRect(button.x, button.y, button.width, button.height);
  context.fillStyle = '#12304d';
  context.font = '800 20px system-ui, sans-serif';
  context.fillText('再玩一次！加油！', config.baseWidth / 2, button.y + button.height / 2);
  context.restore();
}
