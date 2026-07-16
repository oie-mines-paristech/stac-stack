const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 280;
const STORAGE_KEY = "zarr-viewer-panel-layout";

interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
}

function loadLayout(): PanelLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      leftWidth: clamp(parsed.leftWidth ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
      rightWidth: clamp(parsed.rightWidth ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH),
      leftVisible: parsed.leftVisible ?? true,
      rightVisible: parsed.rightVisible ?? true,
    };
  } catch {
    return {
      leftWidth: DEFAULT_WIDTH,
      rightWidth: DEFAULT_WIDTH,
      leftVisible: true,
      rightVisible: true,
    };
  }
}

function saveLayout(layout: PanelLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyLayout(layout: PanelLayout): void {
  const body = document.querySelector<HTMLElement>("#body-grid");
  if (!body) return;
  body.style.setProperty("--left-w", `${layout.leftWidth}px`);
  body.style.setProperty("--right-w", `${layout.rightWidth}px`);
  body.classList.toggle("left-hidden", !layout.leftVisible);
  body.classList.toggle("right-hidden", !layout.rightVisible);

  const toggleLeft = document.querySelector<HTMLButtonElement>("#toggle-left");
  const toggleRight = document.querySelector<HTMLButtonElement>("#toggle-right");
  const dockLeft = document.querySelector<HTMLButtonElement>("#dock-left");
  const dockRight = document.querySelector<HTMLButtonElement>("#dock-right");

  if (toggleLeft) {
    toggleLeft.textContent = "◀";
    toggleLeft.title = "Hide controls panel";
    toggleLeft.hidden = !layout.leftVisible;
  }
  if (toggleRight) {
    toggleRight.textContent = "▶";
    toggleRight.title = "Hide metadata panel";
    toggleRight.hidden = !layout.rightVisible;
  }
  if (dockLeft) dockLeft.hidden = layout.leftVisible;
  if (dockRight) dockRight.hidden = layout.rightVisible;
}

export function initPanels(): PanelLayout {
  const layout = loadLayout();
  applyLayout(layout);
  return layout;
}

export function wirePanels(onResize?: () => void): void {
  let layout = loadLayout();
  applyLayout(layout);

  const body = document.querySelector<HTMLElement>("#body-grid");
  const splitterLeft = document.querySelector<HTMLElement>("#splitter-left");
  const splitterRight = document.querySelector<HTMLElement>("#splitter-right");
  const toggleLeft = document.querySelector<HTMLButtonElement>("#toggle-left");
  const toggleRight = document.querySelector<HTMLButtonElement>("#toggle-right");
  const dockLeft = document.querySelector<HTMLButtonElement>("#dock-left");
  const dockRight = document.querySelector<HTMLButtonElement>("#dock-right");

  if (!body || !splitterLeft || !splitterRight || !toggleLeft || !toggleRight || !dockLeft || !dockRight) {
    return;
  }

  const showLeft = (): void => {
    layout = { ...layout, leftVisible: true };
    applyLayout(layout);
    saveLayout(layout);
    onResize?.();
  };

  const hideLeft = (): void => {
    layout = { ...layout, leftVisible: false };
    applyLayout(layout);
    saveLayout(layout);
    onResize?.();
  };

  const showRight = (): void => {
    layout = { ...layout, rightVisible: true };
    applyLayout(layout);
    saveLayout(layout);
    onResize?.();
  };

  const hideRight = (): void => {
    layout = { ...layout, rightVisible: false };
    applyLayout(layout);
    saveLayout(layout);
    onResize?.();
  };

  toggleLeft.addEventListener("click", () => hideLeft());
  toggleRight.addEventListener("click", () => hideRight());
  dockLeft.addEventListener("click", () => showLeft());
  dockRight.addEventListener("click", () => showRight());

  let dragSide: "left" | "right" | null = null;
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onPointerMove(event: PointerEvent): void {
    if (!dragSide) return;
    const delta = event.clientX - dragStartX;
    if (dragSide === "left") {
      layout = { ...layout, leftWidth: clamp(dragStartWidth + delta, MIN_WIDTH, MAX_WIDTH) };
    } else {
      layout = { ...layout, rightWidth: clamp(dragStartWidth - delta, MIN_WIDTH, MAX_WIDTH) };
    }
    applyLayout(layout);
    onResize?.();
  }

  function onPointerUp(): void {
    if (!dragSide) return;
    dragSide = null;
    document.body.classList.remove("panel-dragging");
    saveLayout(layout);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function startDrag(side: "left" | "right", event: PointerEvent): void {
    if (side === "left" && !layout.leftVisible) return;
    if (side === "right" && !layout.rightVisible) return;
    dragSide = side;
    dragStartX = event.clientX;
    dragStartWidth = side === "left" ? layout.leftWidth : layout.rightWidth;
    document.body.classList.add("panel-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  splitterLeft.addEventListener("pointerdown", (event) => startDrag("left", event));
  splitterRight.addEventListener("pointerdown", (event) => startDrag("right", event));
}
