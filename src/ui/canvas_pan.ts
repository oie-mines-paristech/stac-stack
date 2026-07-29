export interface CanvasPanState {
  x: number;
  y: number;
}

export interface CanvasPanController {
  sync(): void;
  reset(): void;
  getState(): CanvasPanState;
}

export function isCanvasPannable(
  wrap: HTMLElement,
  canvas: HTMLCanvasElement,
  nativeSize: boolean,
): boolean {
  if (!nativeSize) return false;
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  if (width <= 0 || height <= 0) return false;
  return width > wrap.clientWidth + 1 || height > wrap.clientHeight + 1;
}

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
