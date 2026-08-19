export const CLEAR_DURATION_MS = 1800;

export function renderClearCelebration(context, config, celebration) {
  const progress = Math.min(1, celebration.elapsedMs / CLEAR_DURATION_MS);
  const bonusProgress = Math.min(1, celebration.elapsedMs / 800);
  const centerX = config.baseWidth / 2;
  const centerY = config.baseHeight / 2;
  const alpha = progress < 0.15 ? progress / 0.15 : 1;

  context.save();
  context.fillStyle = `rgba(3, 10, 22, ${0.48 * alpha})`;
  context.fillRect(0, 0, config.baseWidth, config.baseHeight);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.globalAlpha = alpha;
  context.fillStyle = '#fff6c4';
  context.font = '900 66px system-ui, sans-serif';
  context.fillText('CLEAR!', centerX, centerY - 70);
  context.fillStyle = '#ffd94a';
  context.font = '800 27px system-ui, sans-serif';
  context.fillText(`BONUS +${celebration.bonus}`, centerX, centerY - 6 - bonusProgress * 26);
  context.fillStyle = '#f3f8ff';
  context.font = '700 23px system-ui, sans-serif';
  context.fillText(`總得分 ${celebration.score}分`, centerX, centerY + 42);
  context.fillStyle = '#bde2ff';
  context.font = '700 17px system-ui, sans-serif';
  context.fillText(`STAGE ${celebration.stage} COMPLETE`, centerX, centerY + 82);
  context.restore();
}
