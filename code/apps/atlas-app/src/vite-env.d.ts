/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET?: "pages" | "local-only" | "hosted";
  readonly VITE_PMTILES_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
