/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Same-origin Zarr proxy path prefix; set to `off` to disable. */
  readonly VITE_ZARR_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
