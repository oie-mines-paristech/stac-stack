import { dataRowFromCanvas } from "./spatial.js";

export interface DisplaySize {
  width: number;
  height: number;
}

export interface ViewOrigin {
  x: number;
  y: number;
}

export interface DisplayTransform {
  planeWidth: number;
  planeHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  regionX0: number;
  regionY0: number;
  regionWidth: number;
  regionHeight: number;
}

export interface RenderRegion {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

export interface RenderTarget {
  width: number;
  height: number;
}

export interface ViewLayout {
  region: RenderRegion;
  target: RenderTarget;
  displayTransform: DisplayTransform;
}

export function clampViewOrigin(
  origin: ViewOrigin,
  planeWidth: number,
  planeHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ViewOrigin {
  const maxX = Math.max(0, planeWidth - viewportWidth);
  const maxY = Math.max(0, planeHeight - viewportHeight);
  return {
    x: Math.max(0, Math.min(maxX, origin.x)),
    y: Math.max(0, Math.min(maxY, origin.y)),
  };
}

export function computeViewLayout(
  planeWidth: number,
  planeHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fillView: boolean,
  viewOrigin: ViewOrigin,
): ViewLayout {
  const baseTransform: DisplayTransform = {
    planeWidth,
    planeHeight,
    canvasWidth: planeWidth,
    canvasHeight: planeHeight,
    regionX0: 0,
    regionY0: 0,
    regionWidth: planeWidth,
    regionHeight: planeHeight,
  };

  if (
    planeWidth <= 0 ||
    planeHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return {
      region: { x0: 0, y0: 0, width: 1, height: 1 },
      target: { width: 1, height: 1 },
      displayTransform: baseTransform,
    };
  }

  if (fillView) {
    const scale = Math.min(viewportWidth / planeWidth, viewportHeight / planeHeight);
    const targetWidth = Math.max(1, Math.floor(planeWidth * scale));
    const targetHeight = Math.max(1, Math.floor(planeHeight * scale));
    return {
      region: { x0: 0, y0: 0, width: planeWidth, height: planeHeight },
      target: { width: targetWidth, height: targetHeight },
      displayTransform: {
        ...baseTransform,
        canvasWidth: targetWidth,
        canvasHeight: targetHeight,
      },
    };
  }

  const origin = clampViewOrigin(
    viewOrigin,
    planeWidth,
    planeHeight,
    viewportWidth,
    viewportHeight,
  );
  const regionWidth = Math.min(viewportWidth, planeWidth - origin.x);
  const regionHeight = Math.min(viewportHeight, planeHeight - origin.y);

  return {
    region: {
      x0: origin.x,
      y0: origin.y,
      width: Math.max(1, regionWidth),
      height: Math.max(1, regionHeight),
    },
    target: {
      width: Math.max(1, regionWidth),
      height: Math.max(1, regionHeight),
    },
    displayTransform: {
      planeWidth,
      planeHeight,
      canvasWidth: Math.max(1, regionWidth),
      canvasHeight: Math.max(1, regionHeight),
      regionX0: origin.x,
      regionY0: origin.y,
      regionWidth: Math.max(1, regionWidth),
      regionHeight: Math.max(1, regionHeight),
    },
  };
}

export function canvasToPlanePixel(
  canvasX: number,
  canvasY: number,
  transform: DisplayTransform,
  flipY: boolean,
): { x: number; y: number } {
  const localX = Math.max(
    0,
    Math.min(
      transform.regionWidth - 1,
      Math.floor((canvasX * transform.regionWidth) / Math.max(1, transform.canvasWidth)),
    ),
  );
  const localY = Math.max(
    0,
    Math.min(
      transform.regionHeight - 1,
      Math.floor((canvasY * transform.regionHeight) / Math.max(1, transform.canvasHeight)),
    ),
  );
  const x = Math.max(
    0,
    Math.min(transform.planeWidth - 1, transform.regionX0 + localX),
  );
  const planeRow = transform.regionY0 + localY;
  const y = dataRowFromCanvas(planeRow, transform.planeHeight, flipY);
  return { x, y };
}
