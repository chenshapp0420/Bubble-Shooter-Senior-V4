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

    // A low-profile launch base keeps the shooter visually connected to the
    // play field without turning it into an information panel.
    context.fillStyle = 'rgba(4, 13, 27, 0.78)';
    context.beginPath();
    context.ellipse(x, y + 20, 72, 17, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#244a70';
    context.beginPath();
    context.moveTo(x - 45, y + 19);
    context.quadraticCurveTo(x, y - 2, x + 45, y + 19);
    context.lineTo(x + 34, y + 25);
    context.lineTo(x - 34, y + 25);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(150, 198, 236, 0.55)';
    context.lineWidth = 1.5;
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
