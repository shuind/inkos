import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studioRoot = resolve(repoRoot, "packages", "studio");
const defaultProjectRoot = resolve(repoRoot, "my-novel");
const projectRoot = resolve(process.env.INKOS_PROJECT_ROOT ?? process.argv[2] ?? defaultProjectRoot);
const apiPort = process.env.INKOS_STUDIO_PORT ?? "4569";
const clientPort = process.env.INKOS_STUDIO_CLIENT_PORT ?? "4567";

if (!existsSync(projectRoot)) {
  console.error(`Project root does not exist: ${projectRoot}`);
  console.error("Create it first, or pass another path: pnpm studio C:\\path\\to\\project");
  process.exit(1);
}

const env = {
  ...process.env,
  INKOS_PROJECT_ROOT: projectRoot,
  INKOS_STUDIO_PORT: apiPort,
};

function spawnPnpm(args) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", ["pnpm", ...args].join(" ")], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
  }
  return spawn("pnpm", args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
}

const children = [
  spawnPnpm(["--filter", "@actalk/inkos-studio", "exec", "tsx", "watch", "--clear-screen=false", "src/api/index.ts"]),
  spawnPnpm(["--filter", "@actalk/inkos-studio", "exec", "vite", "--host", "0.0.0.0", "--port", clientPort]),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === "SIGTERM") return;
    console.error(`Studio dev process exited with code ${code ?? signal}.`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`InkOS Studio project: ${projectRoot}`);
console.log(`API: http://localhost:${apiPort}`);
console.log(`Studio: http://localhost:${clientPort}`);
