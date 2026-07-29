import { registerJpegxlCodec } from "@oie-minesparis-psl/jpegxl-zarr";
import { openDataset, openVariableArray } from "../src/store.js";
import { loadImagePlane } from "../src/render.js";

const URL =
  process.env.ZARR_URL ??
  "https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/";

async function probe(
  variable: string,
  timeIndex: number,
  mode: "rgb" | "scalar" = "scalar",
): Promise<void> {
  const dataset = await openDataset(URL);
  const variableMeta = dataset.schema.variables.find((item) => item.path === variable);
  if (!variableMeta) throw new Error(`Variable not found: ${variable}`);
  const arr = await openVariableArray(dataset.root, variableMeta);
  const selection: Record<string, number> = {};
  for (const axis of variableMeta.axes) {
    selection[axis.name] = axis.role === "time" ? timeIndex : 0;
  }
  const indices = variableMeta.axes.map((axis) => selection[axis.name] ?? 0);
  const plane = await loadImagePlane(arr, variableMeta, indices, mode);
  let finite = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of plane.data) {
    if (!Number.isFinite(value)) continue;
    finite++;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  console.log(
    `${variable} t=${timeIndex} mode=${mode}: finite=${finite} min/max=${min}/${max} shape=[${plane.shape.join(", ")}]`,
  );
}

async function main(): Promise<void> {
  registerJpegxlCodec();
  for (const timeIndex of [100, 2855]) {
    await probe("radiance", timeIndex, "scalar");
    await probe("radiance", timeIndex, "rgb");
  }
  await probe("raw_sensor", 100);
  const dataset = await openDataset(URL);
  const mask = dataset.schema.variables.find((item) => item.path === "mask");
  if (mask) {
    const arr = await openVariableArray(dataset.root, mask);
    const plane = await loadImagePlane(
      arr,
      mask,
      mask.axes.map(() => 0),
    );
    console.log(`mask shape=[${plane.shape.join(", ")}] samples=${plane.data.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
