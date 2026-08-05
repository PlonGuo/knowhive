// Sidecar dist builder (Phase F, Path C — see learnings/decisions/Bun-Compile-Native-Deps-Spike.md).
// Produces the packaged-app layout:
//   src-tauri/resources/server/index.js      one bundle, native packages external
//   src-tauri/resources/server/node_modules  real minimal install of the externals
//   src-tauri/binaries/bun-<target-triple>   the bun runtime Tauri ships as externalBin
//
// Native modules stay external because they must load from a real on-disk
// node_modules (dylibs resolve via @rpath relative to the .node's location, and
// sharp's platform package is a dynamic require bundlers can't see).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const NATIVE_EXTERNALS = ["onnxruntime-node", "sharp"];

// Dev-only observability. Marked external but deliberately NOT installed into the
// resources dir (step 2 only installs NATIVE_EXTERNALS), which makes "tracing never
// ships" a property of the build rather than a promise in a comment: the packaged
// bundle carries no Langfuse/OTel code at all. src/tracing.ts reaches these through
// dynamic import inside a branch that requires LANGFUSE_* keys, so the missing modules
// are unreachable in a packaged app — where those keys never exist.
const DEV_ONLY_EXTERNALS = [
  "@langfuse/tracing",
  "@langfuse/otel",
  "@langfuse/vercel-ai-sdk",
  "@langfuse/client",
  "@opentelemetry/sdk-node",
];

const serverDir = import.meta.dir;
const resourcesDir = join(serverDir, "../src-tauri/resources/server");
const binariesDir = join(serverDir, "../src-tauri/binaries");

// 1. Bundle all JS, leaving the native packages as runtime requires.
rmSync(resourcesDir, { recursive: true, force: true });
mkdirSync(resourcesDir, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(serverDir, "src/index.ts")],
  target: "bun",
  external: [...NATIVE_EXTERNALS, ...DEV_ONLY_EXTERNALS],
  outdir: resourcesDir,
});
if (!result.success) {
  console.error(result.logs.join("\n"));
  process.exit(1);
}

// 2. Install the externals (with their real transitive deps + dylibs) into the
// resources dir, pinning the exact versions the dev tree resolved.
const versionOf = (pkg: string): string =>
  JSON.parse(readFileSync(join(serverDir, "node_modules", pkg, "package.json"), "utf8")).version;

writeFileSync(
  join(resourcesDir, "package.json"),
  JSON.stringify(
    {
      name: "knowhive-sidecar-dist",
      private: true,
      dependencies: Object.fromEntries(NATIVE_EXTERNALS.map((p) => [p, versionOf(p)])),
      trustedDependencies: ["onnxruntime-node", "protobufjs", "sharp"],
    },
    null,
    2,
  ),
);
await $`bun install --production`.cwd(resourcesDir);

// onnxruntime-node ships binaries for every OS (~210MB); keep only the platform
// we're packaging for (this build script always targets the host platform).
const onnxBinDir = join(resourcesDir, "node_modules/onnxruntime-node/bin/napi-v6");
for (const os of ["darwin", "linux", "win32"]) {
  if (os !== process.platform) rmSync(join(onnxBinDir, os), { recursive: true, force: true });
}
const hostArchDir = join(onnxBinDir, process.platform);
for (const arch of ["arm64", "x64"]) {
  if (arch !== process.arch) rmSync(join(hostArchDir, arch), { recursive: true, force: true });
}

// 3. Ship the running bun runtime as the Tauri externalBin (name must carry the
// target triple; Tauri strips it at bundle time).
const triple = (await $`rustc -vV`.text()).match(/host: (\S+)/)?.[1];
if (!triple) {
  console.error("could not determine target triple from rustc");
  process.exit(1);
}
mkdirSync(binariesDir, { recursive: true });
cpSync(process.execPath, join(binariesDir, `bun-${triple}`));

console.log(`dist ready: ${resourcesDir} + binaries/bun-${triple} (bun ${Bun.version})`);
