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

let currentLayout = loadLayout();
let fullTabActive = false;
let layoutBeforeFullTab: PanelLayout | null = null;

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
  body.classList.toggle("full-tab", fullTabActive);

  const leftVisible = fullTabActive ? false : layout.leftVisible;
  const rightVisible = fullTabActive ? false : layout.rightVisible;
  body.classList.toggle("left-hidden", !leftVisible);
  body.classList.toggle("right-hidden", !rightVisible);

  const toggleLeft = document.querySelector<HTMLButtonElement>("#toggle-left");
  const toggleRight = document.querySelector<HTMLButtonElement>("#toggle-right");
  const dockLeft = document.querySelector<HTMLButtonElement>("#dock-left");
  const dockRight = document.querySelector<HTMLButtonElement>("#dock-right");

  if (toggleLeft) {
    toggleLeft.textContent = "◀";
    toggleLeft.title = "Hide controls panel";
    toggleLeft.hidden = fullTabActive || !layout.leftVisible;
  }
  if (toggleRight) {
    toggleRight.textContent = "▶";
    toggleRight.title = "Hide metadata panel";
    toggleRight.hidden = fullTabActive || !layout.rightVisible;
  }
  if (dockLeft) dockLeft.hidden = fullTabActive || layout.leftVisible;
  if (dockRight) dockRight.hidden = fullTabActive || layout.rightVisible;
}

export function initPanels(): PanelLayout {
  currentLayout = loadLayout();
  applyLayout(currentLayout);
  return currentLayout;
}

export function setFullTabMode(on: boolean, onResize?: () => void): void {
  if (on === fullTabActive) return;
  if (on) {
    layoutBeforeFullTab = { ...currentLayout };
    fullTabActive = true;
  } else {
    fullTabActive = false;
    if (layoutBeforeFullTab) {
      currentLayout = layoutBeforeFullTab;
      layoutBeforeFullTab = null;
    }
  }
  applyLayout(currentLayout);
  onResize?.();
}

export function isFullTabMode(): boolean {
  return fullTabActive;
}

export function wirePanels(onResize?: () => void): void {
  applyLayout(currentLayout);

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
    if (fullTabActive) return;
    currentLayout = { ...currentLayout, leftVisible: true };
    applyLayout(currentLayout);
    saveLayout(currentLayout);
    onResize?.();
  };

  const hideLeft = (): void => {
    if (fullTabActive) return;
    currentLayout = { ...currentLayout, leftVisible: false };
    applyLayout(currentLayout);
    saveLayout(currentLayout);
    onResize?.();
  };

  const showRight = (): void => {
    if (fullTabActive) return;
    currentLayout = { ...currentLayout, rightVisible: true };
    applyLayout(currentLayout);
    saveLayout(currentLayout);
    onResize?.();
  };

  const hideRight = (): void => {
    if (fullTabActive) return;
    currentLayout = { ...currentLayout, rightVisible: false };
    applyLayout(currentLayout);
    saveLayout(currentLayout);
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
    if (!dragSide || fullTabActive) return;
    const delta = event.clientX - dragStartX;
    if (dragSide === "left") {
      currentLayout = { ...currentLayout, leftWidth: clamp(dragStartWidth + delta, MIN_WIDTH, MAX_WIDTH) };
    } else {
      currentLayout = { ...currentLayout, rightWidth: clamp(dragStartWidth - delta, MIN_WIDTH, MAX_WIDTH) };
    }
    applyLayout(currentLayout);
    onResize?.();
  }

  function onPointerUp(): void {
    if (!dragSide) return;
    dragSide = null;
    document.body.classList.remove("panel-dragging");
    saveLayout(currentLayout);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function startDrag(side: "left" | "right", event: PointerEvent): void {
    if (fullTabActive) return;
    if (side === "left" && !currentLayout.leftVisible) return;
    if (side === "right" && !currentLayout.rightVisible) return;
    dragSide = side;
    dragStartX = event.clientX;
    dragStartWidth = side === "left" ? currentLayout.leftWidth : currentLayout.rightWidth;
    document.body.classList.add("panel-dragging");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  splitterLeft.addEventListener("pointerdown", (event) => startDrag("left", event));
  splitterRight.addEventListener("pointerdown", (event) => startDrag("right", event));
}
