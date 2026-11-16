/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by tools/build-open-beta.mjs only. */
  readonly VITE_OPEN_BETA_VERSION?: string;
  readonly VITE_OPEN_BETA_BUILT?: string;
}
