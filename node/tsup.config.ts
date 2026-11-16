import { defineConfig } from "tsup";

// One source, two outputs: dist/index.js (ESM) and dist/index.cjs (CommonJS), each with its own types.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
});
