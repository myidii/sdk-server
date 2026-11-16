// Tests @myidii/node the way developers get it: from the packed tarball, not from the source tree.
//
//   1. build and npm pack
//   2. check the tarball contents, then run publint and attw on it
//   3. install the tarball into throwaway projects in a temp dir and
//      - import it from Node ESM and require it from CommonJS, then exercise the client
//      - typecheck a TypeScript consumer with moduleResolution node16 (ESM and CJS files) and bundler
//
// Runs on whatever Node runs this script; CI repeats it on each supported version.
// Set KEEP_FIXTURES=1 to keep the temp dir for debugging.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node");
const bin = (name) => join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
const require = createRequire(join(pkgDir, "package.json"));
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const typeRoots = join(dirname(dirname(require.resolve("@types/node/package.json"))));
const vectors = join(pkgDir, "test", "fixtures", "webhook-vectors.json");

let failures = 0;
const step = (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    console.log("ok");
  } catch (err) {
    failures++;
    console.log("FAILED");
    console.error(err.stdout?.toString() || "", err.stderr?.toString() || "", err.stdout || err.stderr ? "" : err);
  }
};
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });

const tmp = mkdtempSync(join(tmpdir(), "myidii-packaging-"));
console.log(`Node ${process.version}, working in ${tmp}`);

try {
  run("npm", ["run", "build", "-w", "node"]);
  const [packed] = JSON.parse(run("npm", ["pack", "-w", "node", "--json", "--pack-destination", tmp]));
  const tarball = join(tmp, packed.filename);
  console.log(`packed ${packed.filename} (${packed.files.length} files)`);

  step("tarball has the built files and nothing else", () => {
    const files = packed.files.map((f) => f.path).sort();
    for (const f of ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"]) {
      if (!files.includes(f)) throw new Error(`missing ${f}`);
    }
    const stray = files.filter((f) => !/^(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/.+)$/.test(f));
    if (stray.length) throw new Error(`unexpected files: ${stray.join(", ")}`);
  });

  step("publint --strict", () => run(bin("publint"), ["run", tarball, "--strict"]));
  step("attw", () => run(bin("attw"), [tarball, "--format", "ascii"]));

  const fixture = (name, files) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    run("npm", ["install", tarball, "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock"], dir);
    return dir;
  };

  const smoke = readFileSync(new URL("./packaging-smoke.js", import.meta.url), "utf8");

  step("Node ESM: import", () => {
    const dir = fixture("esm", {
      "package.json": JSON.stringify({ name: "fixture-esm", private: true, type: "module" }),
      "index.js": `import assert from "node:assert/strict";\nimport { createHmac } from "node:crypto";\nimport { readFileSync } from "node:fs";\nimport Default, { Myidii, MyidiiError } from "@myidii/node";\n${smoke}\nawait smoke();\n`,
    });
    const out = run(process.execPath, ["index.js", vectors], dir);
    if (!out.includes("smoke ok")) throw new Error(out);
  });

  step("Node CJS: require", () => {
    const dir = fixture("cjs", {
      "package.json": JSON.stringify({ name: "fixture-cjs", private: true, type: "commonjs" }),
      "index.js": `const assert = require("node:assert/strict");\nconst { createHmac } = require("node:crypto");\nconst { readFileSync } = require("node:fs");\nconst sdk = require("@myidii/node");\nconst { Myidii, MyidiiError } = sdk;\nconst Default = sdk.default;\n${smoke}\nsmoke().catch((e) => { console.error(e); process.exit(1); });\n`,
    });
    const out = run(process.execPath, ["index.js", vectors], dir);
    if (!out.includes("smoke ok")) throw new Error(out);
  });

  const consumer = readFileSync(new URL("./packaging-consumer.ts", import.meta.url), "utf8");
  const tsconfig = (compilerOptions, include) =>
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, types: ["node"], typeRoots: [typeRoots], ...compilerOptions }, include });

  step('TypeScript: moduleResolution "node16" (ESM and CJS files)', () => {
    const dir = fixture("ts-node16", {
      "package.json": JSON.stringify({ name: "fixture-ts-node16", private: true, type: "commonjs" }),
      "tsconfig.json": tsconfig({ module: "node16", moduleResolution: "node16", target: "es2022" }, ["*.mts", "*.cts"]),
      "consumer.mts": consumer,
      "consumer.cts": consumer,
    });
    run(process.execPath, [tsc, "-p", "."], dir);
  });

  step('TypeScript: moduleResolution "bundler"', () => {
    const dir = fixture("ts-bundler", {
      "package.json": JSON.stringify({ name: "fixture-ts-bundler", private: true, type: "module" }),
      "tsconfig.json": tsconfig({ module: "esnext", moduleResolution: "bundler", target: "es2022" }, ["*.ts"]),
      "consumer.ts": consumer,
    });
    run(process.execPath, [tsc, "-p", "."], dir);
  });
} finally {
  if (process.env.KEEP_FIXTURES) console.log(`kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} packaging check(s) failed`);
  process.exit(1);
}
console.log("\nall packaging checks passed");
