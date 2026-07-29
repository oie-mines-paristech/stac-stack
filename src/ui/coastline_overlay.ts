import { warpCoastlinePaths } from "../coastline_warp.js";
import { createGeoPixelMapper, spatialCoordsMatchPlane } from "../spatial.js";
import type { SpatialCoords } from "../hover.js";
import type { ImagePlane } from "../render.js";
import type { DisplayTransform } from "../view_transform.js";
import { strokeWidthForViewBox } from "./svg_stroke.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const COASTLINE_STROKE_PX = 1;

export async function updateCoastlineOverlay(
  overlay: SVGSVGElement | null,
  canvas: HTMLCanvasElement,
  spatial: SpatialCoords | null,
  visible: boolean,
  plane?: ImagePlane | null,
  displayTransform?: DisplayTransform | null,
): Promise<void> {
  if (!overlay) return;

  const planeWidth = plane?.shape[plane.axes.x] ?? canvas.width;
  const planeHeight = plane?.shape[plane.axes.y] ?? canvas.height;
  const aligned = spatial && spatialCoordsMatchPlane(spatial, planeWidth, planeHeight);

  if (!visible || !aligned || !spatial?.xValues?.length || !spatial?.yValues?.length) {
    overlay.setAttribute("hidden", "");
    overlay.style.display = "none";
    return;
  }

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const regionX0 = displayTransform?.regionX0 ?? 0;
  const regionY0 = displayTransform?.regionY0 ?? 0;
  const regionWidth = displayTransform?.regionWidth ?? planeWidth;
  const regionHeight = displayTransform?.regionHeight ?? planeHeight;

  const downsampledView =
    regionX0 === 0 &&
    regionY0 === 0 &&
    regionWidth === planeWidth &&
    regionHeight === planeHeight &&
    (canvasWidth !== planeWidth || canvasHeight !== planeHeight);

  const mapper = downsampledView
    ? createGeoPixelMapper(
        spatial.xValues,
        spatial.yValues,
        spatial.flipY,
        canvasWidth,
        canvasHeight,
      )
    : (() => {
        const fullMapper = createGeoPixelMapper(
          spatial.xValues,
          spatial.yValues,
          spatial.flipY,
          planeWidth,
          planeHeight,
        );
        return {
          flipY: fullMapper.flipY,
          width: regionWidth,
          height: regionHeight,
          lonToPixel(lon: number): number {
            return fullMapper.lonToPixel(lon) - regionX0;
          },
          latToPixel(lat: number): number {
            return fullMapper.latToPixel(lat) - regionY0;
          },
        };
      })();

  const warpedPaths = await warpCoastlinePaths(mapper);

  overlay.removeAttribute("hidden");
  overlay.style.display = "block";
  overlay.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.classList.remove("flip-y");

  let group = overlay.querySelector<SVGGElement>("g.coastline-warped");
  if (!group) {
    group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "coastline-warped");
    overlay.appendChild(group);
  }

  group.replaceChildren(
    ...warpedPaths.map((warped) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", warped.d);
      path.setAttribute("class", "country");
      return path;
    }),
  );

  const stack = canvas.parentElement;
  let displayWidth = planeWidth;
  let displayHeight = planeHeight;
  if (stack) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w > 0 && h > 0) {
      displayWidth = w;
      displayHeight = h;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
    }
  }

  const strokeW = strokeWidthForViewBox(
    Math.max(canvasWidth, canvasHeight),
    Math.max(displayWidth, displayHeight),
    COASTLINE_STROKE_PX,
  );
  for (const path of group.querySelectorAll("path")) {
    path.setAttribute("stroke-width", String(strokeW));
  }
}
