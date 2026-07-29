/** Convert a desired on-screen stroke (CSS px) to SVG viewBox/user units. */
export function strokeWidthForViewBox(
  viewBoxSpan: number,
  displaySpanPx: number,
  screenPixels = 1,
): number {
  if (displaySpanPx <= 0 || viewBoxSpan <= 0) return screenPixels;
  return (viewBoxSpan / displaySpanPx) * screenPixels;
}
