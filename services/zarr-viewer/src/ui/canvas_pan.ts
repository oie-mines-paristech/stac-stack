export interface CanvasPanState {
  x: number;
  y: number;
}

export interface ViewOrigin {
  x: number;
  y: number;
}

export interface CanvasPanController {
  sync(): void;
  reset(): void;
  getState(): CanvasPanState;
}

export interface ViewPanController {
  sync(): void;
  reset(): void;
  getOrigin(): ViewOrigin;
}

export function isCanvasPannable(
  wrap: HTMLElement,
  canvas: HTMLCanvasElement,
  nativeSize: boolean,
): boolean {
  if (!nativeSize) return false;
  const planeWidth = canvas.dataset?.planeWidth;
  const planeHeight = canvas.dataset?.planeHeight;
  if (planeWidth && planeHeight) {
    const width = Number(planeWidth);
    const height = Number(planeHeight);
    if (width > wrap.clientWidth + 1 || height > wrap.clientHeight + 1) return true;
  }
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  if (width <= 0 || height <= 0) return false;
  return width > wrap.clientWidth + 1 || height > wrap.clientHeight + 1;
}

export function wireViewPan(
  wrap: HTMLElement,
  stack: HTMLElement,
  canvas: HTMLCanvasElement,
  isNativeSize: () => boolean,
  getPlaneSize: () => { width: number; height: number },
  getViewportSize: () => { width: number; height: number },
  getOrigin: () => ViewOrigin,
  onOriginCommit: (origin: ViewOrigin) => void,
): ViewPanController {
  let dragOrigin: { x: number; y: number; originX: number; originY: number } | null = null;

  const clampOrigin = (origin: ViewOrigin): ViewOrigin => {
    const plane = getPlaneSize();
    const viewport = getViewportSize();
    const maxX = Math.max(0, plane.width - viewport.width);
    const maxY = Math.max(0, plane.height - viewport.height);
    return {
      x: Math.max(0, Math.min(maxX, origin.x)),
      y: Math.max(0, Math.min(maxY, origin.y)),
    };
  };

  const clampDragDelta = (
    deltaX: number,
    deltaY: number,
    originX: number,
    originY: number,
  ): ViewOrigin => {
    const plane = getPlaneSize();
    const viewport = getViewportSize();
    const maxOriginX = Math.max(0, plane.width - viewport.width);
    const maxOriginY = Math.max(0, plane.height - viewport.height);
    const minDeltaX = originX - maxOriginX;
    const maxDeltaX = originX;
    const minDeltaY = originY - maxOriginY;
    const maxDeltaY = originY;
    return {
      x: Math.max(minDeltaX, Math.min(maxDeltaX, deltaX)),
      y: Math.max(minDeltaY, Math.min(maxDeltaY, deltaY)),
    };
  };

  const applyPreviewTransform = (deltaX: number, deltaY: number): void => {
    if (deltaX === 0 && deltaY === 0) {
      stack.style.transform = "";
    } else {
      stack.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    }
  };

  const reset = (): void => {
    dragOrigin = null;
    applyPreviewTransform(0, 0);
    wrap.classList.remove("canvas-wrap--panning");
    onOriginCommit({ x: 0, y: 0 });
  };

  const sync = (): void => {
    const plane = getPlaneSize();
    const pannable =
      isNativeSize() &&
      (plane.width > wrap.clientWidth + 1 || plane.height > wrap.clientHeight + 1);
    wrap.classList.toggle("canvas-wrap--pannable", pannable);
    wrap.toggleAttribute("data-canvas-pannable", pannable);
    if (!pannable) {
      applyPreviewTransform(0, 0);
      if (getOrigin().x !== 0 || getOrigin().y !== 0) {
        onOriginCommit({ x: 0, y: 0 });
      }
    }
  };

  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!isCanvasPannable(wrap, canvas, isNativeSize())) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".canvas-tool")) return;
    if (!stack.contains(event.target)) return;

    const origin = getOrigin();
    dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    wrap.classList.add("canvas-wrap--panning");
    wrap.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  wrap.addEventListener("pointermove", (event) => {
    if (!dragOrigin) return;
    const rawDeltaX = event.clientX - dragOrigin.x;
    const rawDeltaY = event.clientY - dragOrigin.y;
    const delta = clampDragDelta(
      rawDeltaX,
      rawDeltaY,
      dragOrigin.originX,
      dragOrigin.originY,
    );
    applyPreviewTransform(delta.x, delta.y);
    event.preventDefault();
  });

  const finishDrag = (event: PointerEvent): void => {
    if (!dragOrigin) return;
    const start = dragOrigin;
    const rawDeltaX = event.clientX - start.x;
    const rawDeltaY = event.clientY - start.y;
    const delta = clampDragDelta(
      rawDeltaX,
      rawDeltaY,
      start.originX,
      start.originY,
    );
    dragOrigin = null;
    applyPreviewTransform(0, 0);
    wrap.classList.remove("canvas-wrap--panning");
    if (wrap.hasPointerCapture(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId);
    }
    onOriginCommit(
      clampOrigin({
        x: start.originX - delta.x,
        y: start.originY - delta.y,
      }),
    );
  };

  wrap.addEventListener("pointerup", finishDrag);
  wrap.addEventListener("pointercancel", finishDrag);

  return {
    sync,
    reset,
    getOrigin,
  };
}

/** @deprecated CSS translate pan — kept for tests */
export function wireCanvasPan(
  wrap: HTMLElement,
  stack: HTMLElement,
  canvas: HTMLCanvasElement,
  isNativeSize: () => boolean,
): CanvasPanController {
  let pan: CanvasPanState = { x: 0, y: 0 };
  let dragOrigin: { x: number; y: number; panX: number; panY: number } | null = null;

  const applyTransform = (): void => {
    if (pan.x === 0 && pan.y === 0) {
      stack.style.transform = "";
    } else {
      stack.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    }
  };

  const reset = (): void => {
    pan = { x: 0, y: 0 };
    dragOrigin = null;
    applyTransform();
    wrap.classList.remove("canvas-wrap--panning");
  };

  const sync = (): void => {
    const pannable = isCanvasPannable(wrap, canvas, isNativeSize());
    wrap.classList.toggle("canvas-wrap--pannable", pannable);
    wrap.toggleAttribute("data-canvas-pannable", pannable);
    if (!pannable) reset();
  };

  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!isCanvasPannable(wrap, canvas, isNativeSize())) return;
    if (!(event.target instanceof Node) || !stack.contains(event.target)) return;

    dragOrigin = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    wrap.classList.add("canvas-wrap--panning");
    wrap.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  wrap.addEventListener("pointermove", (event) => {
    if (!dragOrigin) return;
    pan = {
      x: dragOrigin.panX + event.clientX - dragOrigin.x,
      y: dragOrigin.panY + event.clientY - dragOrigin.y,
    };
    applyTransform();
    event.preventDefault();
  });

  const finishDrag = (event: PointerEvent): void => {
    if (!dragOrigin) return;
    dragOrigin = null;
    wrap.classList.remove("canvas-wrap--panning");
    if (wrap.hasPointerCapture(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId);
    }
  };

  wrap.addEventListener("pointerup", finishDrag);
  wrap.addEventListener("pointercancel", finishDrag);

  return {
    sync,
    reset,
    getState: () => ({ ...pan }),
  };
}
