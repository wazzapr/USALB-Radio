// Enzonic entrypoint for the USALB Radio server.
// Enzonic starts the repository from this file. The actual radio API server
// lives in artifacts/api-server and is built/run through the pnpm workspace.

import { spawnSync, spawn } from "node:child_process";

const run = (args) => {
  const result = spawnSync("corepack", args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

console.log("[USALB] Installing radio-server workspace dependencies...");
run(["pnpm", "install", "--frozen-lockfile", "--filter", "@workspace/api-server..."]);

console.log("[USALB] Building radio server...");
run(["pnpm", "--filter", "@workspace/api-server", "build"]);

console.log("[USALB] Starting radio server...");
const child = spawn(
  "corepack",
  ["pnpm", "--filter", "@workspace/api-server", "start"],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error("[USALB] Radio server failed to start:", error);
  process.exit(1);
});
