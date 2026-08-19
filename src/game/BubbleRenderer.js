export const BUBBLE_PALETTE = {
  red: { base: '#FF2A1A', light: '#FFE2DE', shadow: '#A50B08', edge: '#FFFFFF' },
  orange: { base: '#FF8C00', light: '#FFE6B3', shadow: '#A94B00', edge: '#FFFFFF' },
  yellow: { base: '#FFE600', light: '#FFF9B0', shadow: '#A88400', edge: '#FFFFFF' },
  green: { base: '#19D647', light: '#D2FFD9', shadow: '#087C27', edge: '#FFFFFF' },
  blue: { base: '#159BFF', light: '#D5EEFF', shadow: '#07509B', edge: '#FFFFFF' },
  purple: { base: '#7D2FE8', light: '#E6D4FF', shadow: '#35107D', edge: '#FFFFFF' },
  fluorescentPink: { base: '#FF1493', light: '#FFD1EA', shadow: '#990052', edge: '#FFFFFF' }
};

export class BubbleRenderer {
  constructor(context, diameter) {
    this.context = context;
    this.radius = diameter / 2;
    this.debugDraws = [];
  }

  beginFrame() {
    this.debugDraws = [];
  }

  getDebugDraws() {
    return this.debugDraws.slice();
  }

  drawBubble(x, y, colorName, scale = 1, metadata = {}) {
    this.debugDraws.push({
      id: metadata.id ?? `bubble-${this.debugDraws.length}`,
      row: metadata.row ?? null,
      col: metadata.col ?? null,
      x,
      y,
      radius: this.radius * scale,
      bottom: y + this.radius * scale,
      renderedX: x,
      renderedY: y,
      renderedBottom: y + this.radius * scale,
      source: metadata.source ?? 'UNKNOWN'
    });

    const context = this.context;
    const radius = this.radius * scale;
    const palette = BUBBLE_PALETTE[colorName];

    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = 5 * scale;
    context.shadowOffsetY = 3 * scale;

    const gradient = context.createRadialGradient(
      x - radius * 0.38,
      y - radius * 0.46,
      radius * 0.08,
      x,
      y,
      radius * 1.08
    );
    gradient.addColorStop(0, palette.light);
    gradient.addColorStop(0.28, palette.base);
    gradient.addColorStop(0.78, palette.base);
    gradient.addColorStop(1, palette.shadow);

    context.beginPath();
    context.arc(x, y, radius - 1, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
    context.shadowColor = 'transparent';

    context.lineWidth = Math.max(1.5, 2 * scale);
    context.strokeStyle = palette.edge;
    context.globalAlpha = 0.7;
    context.stroke();

    context.globalAlpha = 0.75;
    context.beginPath();
    context.ellipse(
      x - radius * 0.28,
      y - radius * 0.38,
      radius * 0.2,
      radius * 0.11,
      -0.45,
      0,
      Math.PI * 2
    );
    context.fillStyle = '#ffffff';
    context.fill();

    context.globalAlpha = 0.16;
    context.beginPath();
    context.arc(x, y + radius * 0.28, radius * 0.64, 0.25, Math.PI - 0.25);
    context.strokeStyle = palette.shadow;
    context.lineWidth = radius * 0.11;
    context.stroke();
    context.restore();
  }
}
