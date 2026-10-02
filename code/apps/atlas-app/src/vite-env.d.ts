/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET?: "pages" | "local-only" | "hosted";
  readonly VITE_PMTILES_PATH?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_HASH?: string;
  /** "1" only in a build for the e2e suite: keeps window.__atlasdraw__. */
  readonly VITE_E2E_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
