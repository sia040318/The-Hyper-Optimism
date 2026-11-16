/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUDY_API_URL?: string;
  readonly VITE_STUDY_PASSCODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
