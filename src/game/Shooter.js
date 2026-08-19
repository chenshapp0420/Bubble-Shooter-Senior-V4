export class Shooter {
  constructor(shooterConfig, bubbleRenderer, colors) {
    this.config = shooterConfig;
    this.bubbleRenderer = bubbleRenderer;
    this.currentBubble = 'blue';
    this.nextBubble = 'yellow';
    this.colorSequence = colors;
    this.nextColorIndex = (colors.indexOf(this.nextBubble) + 1) % colors.length;
  }

  launchCurrentBubble() {
    const bubbleType = this.currentBubble;
    this.currentBubble = this.nextBubble;
    this.nextBubble = this.colorSequence[this.nextColorIndex];
    this.nextColorIndex = (this.nextColorIndex + 1) % this.colorSequence.length;
    return bubbleType;
  }

  reset() {
    this.currentBubble = 'blue';
    this.nextBubble = 'yellow';
    this.nextColorIndex = (this.colorSequence.indexOf(this.nextBubble) + 1) % this.colorSequence.length;
  }

  draw(context) {
    const { x, y } = this.config;

    context.save();

    // A Zen basin is drawn around the existing shooter origin. The origin is
    // deliberately unchanged; this is only a visual housing for the bubble.
    const basinWidth = 92;
    const basinHeight = 30;
    const basinGradient = context.createLinearGradient(x, y + 8, x, y + 32);
    basinGradient.addColorStop(0, '#d9b45c');
    basinGradient.addColorStop(0.18, '#704b29');
    basinGradient.addColorStop(1, '#251d1a');
    context.fillStyle = 'rgba(34, 24, 20, 0.34)';
    context.beginPath();
    context.ellipse(x, y + 27, basinWidth * 0.58, 9, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = basinGradient;
    context.beginPath();
    context.moveTo(x - basinWidth / 2, y + 12);
    context.quadraticCurveTo(x, y + basinHeight * 0.92, x + basinWidth / 2, y + 12);
    context.quadraticCurveTo(x + basinWidth * 0.34, y + 32, x, y + 34);
    context.quadraticCurveTo(x - basinWidth * 0.34, y + 32, x - basinWidth / 2, y + 12);
    context.closePath();
    context.fill();
    context.strokeStyle = '#e6c86e';
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = '#122b3a';
    context.beginPath();
    context.ellipse(x, y + 13, basinWidth * 0.42, 8, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(231, 202, 113, 0.85)';
    context.lineWidth = 2.5;
    context.beginPath();
    context.ellipse(x, y + 13, basinWidth * 0.44, 9, 0, 0, Math.PI * 2);
    context.stroke();

    this.bubbleRenderer.drawBubble(x, y, this.currentBubble, 1, { source: 'SHOOTER_CURRENT' });

    // The next bubble sits beside the current bubble so both remain inside the
    // portrait safe-area geometry calculated by getRuntimeGameConfig().
    const nextX = this.config.nextX ?? x;
    const nextY = this.config.nextY ?? y + 58;
    const nextOutlineRadius = this.config.nextOutlineRadius ?? 22;
    context.globalAlpha = 0.76;
    context.strokeStyle = 'rgba(164, 204, 239, 0.46)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(nextX, nextY, nextOutlineRadius, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    this.bubbleRenderer.drawBubble(nextX, nextY, this.nextBubble, 0.82, { source: 'SHOOTER_NEXT' });

    context.restore();
  }

  getCurrentBubblePosition() {
    return { x: this.config.x, y: this.config.y };
  }

  getNextBubblePosition() {
    return {
      x: this.config.nextX ?? this.config.x,
      y: this.config.nextY ?? this.config.y + 58
    };
  }
}
