import { coastlineLayout } from "../spatial.js";
import type { SpatialCoords } from "../hover.js";

const COASTLINE_HREF = "/coastlines.svg#positioner";
const SVG_NS = "http://www.w3.org/2000/svg";

export function updateCoastlineOverlay(
  overlay: SVGSVGElement | null,
  canvas: HTMLCanvasElement,
  spatial: SpatialCoords | null,
  visible: boolean,
): void {
  if (!overlay) return;

  if (!visible || !spatial?.xValues?.length || !spatial?.yValues?.length) {
    overlay.setAttribute("hidden", "");
    overlay.style.display = "none";
    return;
  }

  overlay.removeAttribute("hidden");
  overlay.style.display = "block";

  const layout = coastlineLayout({
    xValues: spatial.xValues,
    yValues: spatial.yValues,
    flipY: spatial.flipY,
  });

  overlay.setAttribute("viewBox", layout.viewBox);
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.classList.toggle("flip-y", layout.flipY);

  let group = overlay.querySelector<SVGGElement>("g.coastline-map");
  if (!group) {
    group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "coastline-map");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", COASTLINE_HREF);
    group.appendChild(use);
    overlay.appendChild(group);
  }

  group.setAttribute(
    "transform",
    layout.shiftX !== 0 ? `translate(${layout.shiftX}, 0)` : "",
  );

  // Keep overlay aligned with the displayed canvas box (native or zoom-to-fit).
  const stack = canvas.parentElement;
  if (stack) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w > 0 && h > 0) {
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
    }
  }
}
