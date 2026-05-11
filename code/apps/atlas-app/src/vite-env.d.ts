/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET?: "pages" | "local-only" | "hosted";
  readonly VITE_PMTILES_PATH?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
