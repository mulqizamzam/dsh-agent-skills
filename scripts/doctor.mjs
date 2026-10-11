#!/usr/bin/env node
// Doctor script for dsh-agent-skills.
// Checks each row of the README prerequisite table and prints PASS/FAIL.
// Exit 0 if every row passes, exit 1 otherwise.

import { spawnSync } from "child_process";
import { existsSync, lstatSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// ── Configuration ──────────────────────────────────────────────────
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 13080;
const PROBE_TIMEOUT_MS = 10_000; // 10s max
const URL = `http://${HOST}:${PORT}/`;

// The four host packages README install step 2 links into this checkout.
// Requiring ALL of them, not "at least one symlink resolves": an install
// missing cordis used to PASS this row, and the plugin fails to load at boot.
const REQUIRED_HOST_PACKAGES = ["cordis", "dsh-agent", "dsh-llm", "dsh-skill"];

// ── Helper: HTTP probe with short timeout ──────────────────────────
function checkDSHRunning() {
  const { stdout, error } = spawnSync("bash", ["-c", `curl -s -o /dev/null -w "%{http_code}" ${URL}`], {
    timeout: PROBE_TIMEOUT_MS,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (error !== undefined) {
    // A missing curl is a missing tool, not a dead host; reporting 000 here
    // sent the operator hunting a host problem that was never the problem.
    return "FAIL (curl tidak tersedia)";
  }
  const code = (stdout + "").trim();
  // This row answers "is the host serving?", not "is the GUI authorized?".
  // A DSH host with the web GUI's auth enabled answers 401 to an
  // unauthenticated curl, which proves the server is up; only a transport
  // failure (curl prints 000) means the host is down. Requiring 2xx here
  // misreported a secured install as dead.
  if (/^[1-5][0-9][0-9]$/.test(code)) return "PASS";
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
// Derived from this script's own location, not process.cwd(): running the
// doctor from scripts/ used to report a correct install as broken.
function checkHarnessSource() {
  const deepseekAi = join(PLUGIN_ROOT, "node_modules", "@deepseek-ai");
  if (!existsSync(deepseekAi)) return "FAIL (node_modules/@deepseek-ai tidak ada)";

  for (const name of REQUIRED_HOST_PACKAGES) {
    const fullPath = join(deepseekAi, name);
    try {
      const lstat = lstatSync(fullPath);
      if (!lstat.isSymbolicLink()) return `FAIL (${name} bukan symlink)`;
      const { stdout } = spawnSync("readlink", [fullPath], { stdio: "pipe" });
      const target = (stdout + "").trim();
      // The shipped links are absolute; a relative target is resolved by the
      // OS against the symlink's own directory (node_modules/@deepseek-ai/).
      const absTarget = target.startsWith("/") ? target : resolve(deepseekAi, target);
      if (!existsSync(absTarget)) return `FAIL (symlink ${name} menunjuk ke path yang tidak ada)`;
    } catch (error) {
      return `FAIL (${error?.code === 'ENOENT' ? 'tidak ada' : 'tidak bisa dibaca'}: ${name})`;
    }
  }

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