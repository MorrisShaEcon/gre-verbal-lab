import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import {
  enforceBuildOutputCatalogBoundary,
  normalizeBuildVisibility,
} from "./scripts/lib/build-visibility.mjs";

export default defineConfig(({ command, mode }) => {
  const buildVisibility = command === "build" ? normalizeBuildVisibility(mode) : "development";
  const outputDirectory = `dist/${buildVisibility}`;
  return {
    base: "/gre-verbal-lab/",
    define: {
      "import.meta.env.VITE_CATALOG_BUILD_MODE": JSON.stringify(buildVisibility),
    },
    plugins: [
      react(),
      ...(command === "build" ? [{
        name: "catalog-visibility-boundary",
        async closeBundle() {
          await enforceBuildOutputCatalogBoundary(outputDirectory, buildVisibility);
        },
      }] : []),
    ],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
    test: {
      environment: "node",
      coverage: {
        provider: "v8",
      },
    },
  };
});
