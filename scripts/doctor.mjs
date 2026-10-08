#!/usr/bin/env node
// Doctor script for dsh-agent-skills.
// Checks each row of the README prerequisite table and prints PASS/FAIL.
// Exit 0 if every row passes, exit 1 otherwise.

import { spawnSync } from "child_process";
import { existsSync, lstatSync, readdirSync } from "fs";
import { resolve } from "path";

// ── Configuration ──────────────────────────────────────────────────
const HOST = "127.0.0.1";
const PORT = 13080;
const PROBE_TIMEOUT_MS = 10_000; // 10s max
const URL = `http://${HOST}:${PORT}/`;

// ── Helper: HTTP probe with short timeout ──────────────────────────
function checkDSHRunning() {
  const { stdout, status } = spawnSync("bash", ["-c", `curl -s -o /dev/null -w "%{http_code}" ${URL}`], {
    timeout: PROBE_TIMEOUT_MS,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const code = (stdout + "").trim();
  if (/^2\d{2}$/.test(code)) return "PASS";
  return "FAIL";
}

// ── Helper: node version ───────────────────────────────────────────
function checkNodeVersion() {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  if (major >= 20) return "PASS";
  return "FAIL";
}

// ── Helper: pnpm present ───────────────────────────────────────────
function checkPnpm() {
  const { status } = spawnSync("pnpm", ["--version"], { stdio: ["pipe", "pipe", "ignore"] });
  const code = (status + "").trim();
  if (code === "0") return "PASS";
  return "FAIL";
}

// ── Helper: bash works ─────────────────────────────────────────────
function checkBash() {
  const { status, stdout } = spawnSync("bash", ["-c", "echo hello"], { stdio: ["pipe", "pipe", "ignore"] });
  const out = (stdout + "").trim();
  if (out === "hello") return "PASS";
  return "FAIL";
}

// ── Helper: $DSH_HOME set ──────────────────────────────────────────
function checkDSHHome() {
  const envVal = process.env.DSH_HOME;
  if (envVal && envVal.length > 0) return "PASS";
  return "FAIL";
}

// ── Helper: harness source found via node_modules @deepseek-ai/ ────
function checkHarnessSource() {
  const deepseekAi = resolve(process.cwd(), "node_modules/@deepseek-ai");
  if (!existsSync(deepseekAi)) return "FAIL";

  const entries = readdirSync(deepseekAi);
  let foundAnySymlink = false;

  for (const name of entries) {
    const fullPath = resolve(deepseekAi, name);
    try {
      const lstat = lstatSync(fullPath);
      if (lstat.isSymbolicLink()) {
        foundAnySymlink = true;
        // Read the symlink target using the `readlink` command
        const { stdout } = spawnSync("readlink", [fullPath], { stdio: "pipe" });
        const target = (stdout + "").trim();
        // Resolve target relative to the symlink's parent (workspace root)
        // The @deepseek-ai dir is at <project>/node_modules/@deepseek-ai
        // Its parent is <project>/node_modules, and the parent of that is <project>
        const absTarget = target.startsWith("/")
          ? target
          : resolve(resolve(deepseekAi, ".."), target);
        if (!existsSync(absTarget)) {
          return "FAIL"; // symlink target does not exist
        }
      }
    } catch {
      // not readable, skip
    }
  }

  if (!foundAnySymlink) return "FAIL"; // no symlinks at all

  return "PASS";
}

// ── Helper: pathIsAbsolute ─────────────────────────────────────────
function pathIsAbsolute(p) {
  return p.startsWith("/");
}

// ── Main ────────────────────────────────────────────────────────────
function main() {
  const rows = [
    { id: 1, label: "DSH running", fn: checkDSHRunning },
    { id: 2, label: "Node >= 20", fn: checkNodeVersion },
    { id: 3, label: "pnpm present", fn: checkPnpm },
    { id: 4, label: "bash works", fn: checkBash },
    { id: 5, label: "$DSH_HOME set", fn: checkDSHHome },
    { id: 6, label: "harness source found", fn: checkHarnessSource },
  ];

  let allPass = true;
  for (const row of rows) {
    const result = row.fn();
    const status = result;
    console.log(`${row.id}. ${row.label}: ${status}`);
    if (status !== "PASS") allPass = false;
  }

  console.log(allPass ? "\nAll rows PASS" : "\nSome rows FAIL");
  process.exit(allPass ? 0 : 1);
}

main();