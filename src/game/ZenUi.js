export function getZenUiLayout(config) {
  const width = config.baseWidth;
  const height = config.baseHeight;
  const portrait = config.layoutMode === 'PORTRAIT_MOBILE';
  const unit = portrait ? Math.min(width / 390, height / 650) : Math.min(width / 900, height / 700);
  const controlY = height - (portrait ? 24 : 25);
  const controlRadius = portrait ? 17 : 21;

  return {
    width,
    height,
    unit,
    portrait,
    controlBar: {
      x: width * 0.08,
      y: controlY - controlRadius - 7,
      width: width * 0.84,
      height: controlRadius * 2 + 14,
      radius: controlRadius,
      buttons: [
        { id: 'sound', x: width * 0.16, y: controlY, radius: controlRadius },
        { id: 'new-game', x: width * 0.84, y: controlY, radius: controlRadius }
      ]
    },
    monk: {
      x: width * 0.12,
      y: height - (portrait ? 66 : 73),
      scale: unit
    },
    lotusLeft: { x: width * 0.08, y: height - (portrait ? 27 : 34), scale: unit },
    lotusRight: { x: width * 0.91, y: height - (portrait ? 29 : 36), scale: unit },
    incense: {
      x: width * 0.88,
      y: height - (portrait ? 70 : 79),
      scale: unit
    },
    pavilion: {
      x: width * 0.79,
      y: height * (portrait ? 0.36 : 0.39),
      scale: unit
    }
  };
}

export function getZenControlAt(point, layout) {
  return layout.controlBar.buttons.find((button) => (
    Math.hypot(point.x - button.x, point.y - button.y) <= button.radius
  ))?.id ?? null;
}
