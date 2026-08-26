/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin Zarr proxy path prefix; set to `off` to disable. */
  readonly VITE_ZARR_PROXY?: string;
  /** JPEG-XL WASM worker pool size; 0 = main thread. Default 4. */
  readonly VITE_JXL_WORKER_POOL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
