export const BUBBLE_PALETTE = {
  red: { base: '#b58a35', light: '#fff0b8', shadow: '#6e4a18', edge: '#fff8dd' },
  orange: { base: '#a86f43', light: '#f4d5aa', shadow: '#5d3421', edge: '#fff1d2' },
  yellow: { base: '#e5d8ad', light: '#fffbed', shadow: '#9b8751', edge: '#fffef3' },
  green: { base: '#738857', light: '#dbe6bc', shadow: '#405538', edge: '#f0f3d7' },
  blue: { base: '#70888b', light: '#dceceb', shadow: '#3e595d', edge: '#edf7ee' },
  purple: { base: '#8f748f', light: '#ead9e5', shadow: '#563f57', edge: '#f9eef4' },
  fluorescentPink: { base: '#a26778', light: '#f2d0d4', shadow: '#653746', edge: '#ffedf0' }
};

export const SPECIAL_LABEL_STYLES = Object.freeze({
  '貪': { fill: '#ffe36a', stroke: '#3d2353', shadow: 'rgba(61, 35, 83, 0.72)' },
  '嗔': { fill: '#fffaf0', stroke: '#4b201b', shadow: 'rgba(75, 32, 27, 0.72)' },
  '痴': { fill: '#315d9b', stroke: '#fffaf0', shadow: 'rgba(255, 250, 240, 0.82)' },
  '慢': { fill: '#274e2d', stroke: '#fffaf0', shadow: 'rgba(255, 250, 240, 0.82)' },
  '疑': { fill: '#fffaf0', stroke: '#3d2353', shadow: 'rgba(61, 35, 83, 0.72)' }
});

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

    if (metadata.specialLabel) {
      const labelStyle = SPECIAL_LABEL_STYLES[metadata.specialLabel]
        ?? { fill: '#fffaf0', stroke: '#2f2418', shadow: 'rgba(47, 36, 24, 0.72)' };
      context.save();
      context.globalAlpha = 0.96;
      context.shadowColor = labelStyle.shadow;
      context.shadowBlur = Math.max(1.5, radius * 0.12);
      context.strokeStyle = labelStyle.stroke;
      context.lineWidth = Math.max(2, radius * 0.1);
      context.fillStyle = labelStyle.fill;
      context.font = `900 ${Math.min(28, Math.max(16, radius * 1.05))}px serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.strokeText(metadata.specialLabel, x, y + radius * 0.03);
      context.fillText(metadata.specialLabel, x, y + radius * 0.03);
      context.restore();
    }
    context.restore();
  }
}
