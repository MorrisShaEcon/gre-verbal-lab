/// <reference types="vite/client" />

declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_CATALOG_BUILD_MODE?: "open" | "personal" | "development";
}
