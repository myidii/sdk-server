import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// One source, two outputs: dist/index.js (ESM) and dist/index.cjs (CommonJS), each with its own types.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  // The user-agent carries the real package version.
  define: { __VERSION__: JSON.stringify(version) },
  platform: "node",
});
