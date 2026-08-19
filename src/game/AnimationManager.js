export class AnimationManager {
  constructor() {
    this.effects = [];
  }

  add(effect) {
    this.effects.push(effect);
  }

  update(deltaMs) {
    this.effects = this.effects.filter((effect) => !effect.update(deltaMs));
  }

  render(context, bubbleRenderer) {
    this.effects.forEach((effect) => effect.render(context, bubbleRenderer));
  }

  getActiveCount() {
    return this.effects.length;
  }

  clear() {
    this.effects = [];
  }
}
