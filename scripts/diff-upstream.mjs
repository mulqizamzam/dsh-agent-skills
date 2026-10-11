/**
 * Diff-upstream script for Task 7: provenance frontmatter + upstream drift check.
 *
 * For each skill with source: upstream, diff the local body (text after closing ---)
 * against the upstream file at the recorded upstream-sha.
 *
 * Exit 0 if zero drift, exit 1 if any drift, exit 2 if any recorded
 * upstream-sha could not be resolved (a broken/shallow cache — reported
 * separately because it is a broken check, not drift).
 * Prints per-skill summary: OK, DRIFTED, or MISSING-UPSTREAM.
 * Fail closed on clone failure or malformed frontmatter.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// --- Configuration ---
// Derived from this script's own location: process.cwd() made the script
// crash with a raw readdir stack trace when run from anywhere else.
const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'https://github.com/addyosmani/agent-skills';
const CACHE_DIR = path.join(PLUGIN_ROOT, 'upstream-cache');
const SKILLS_DIR = path.join(PLUGIN_ROOT, 'assets', 'skills');

// Exit codes: 0 clean, 1 real drift, 2 unresolvable upstream (kept distinct —
// a shallow cache reporting MISSING-UPSTREAM for everything is a broken
// check, not drift).
const EXIT_OK = 0;
const EXIT_DRIFTED = 1;
const EXIT_MISSING_UPSTREAM = 2;

// --- Simple YAML frontmatter parser (spec 1.2 compatible) ---
// Returns { frontmatter: {key: value}, body: string }
// Handles: ---\nkey: value\n---\nbody
function parseFrontmatter(mdContent) {
  // The file starts with ---\n and ends the second ---\n
  // Find the opening --- (at start) and closing ---
  
  // Check if content starts with ---
  if (!mdContent.startsWith('---')) {
    return { frontmatter: {}, body: mdContent.trim() };
  }

  // Find the closing ---
  // After the first ---\n, look for the next --- 
  const firstNewlineAfterOpening = mdContent.indexOf('\n', 3); // past the opening ---\n
  if (firstNewlineAfterOpening < 0) return { frontmatter: {}, body: mdContent.trim() };

  const closingDelimPos = mdContent.indexOf('---', firstNewlineAfterOpening + 1);
  if (closingDelimPos < 0) return { frontmatter: {}, body: mdContent.trim() };

  // Extract frontmatter text (between the --- markers)
  const fmText = mdContent.substring(3, closingDelimPos); // past the opening ---\n
  const fmLines = fmText.split('\n');
  const frontmatter = {};
  let body = mdContent.substring(closingDelimPos + 3).trim(); // past the closing ---\n

  // Parse simple YAML key: value pairs (no nesting, no lists)
  for (const line of fmLines) {
    // Skip empty lines
    if (!line || line.trim() === '') continue;
    
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < line.length - 1) {
      const key = line.substring(0, colonIdx).trim();
      let value = line.substring(colonIdx + 1).trim();
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      // Skip inline list markers like [-] or [ ]
      if (value === '' || value === '-' || value === '') continue;
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

// --- Clone upstream repo (cached) ---
// The clone is FULL history, never --depth 1: the frontmatter records the
// upstream sha each body was ported from, and a shallow clone cannot resolve
// any non-tip sha — with --depth 1 every upstream skill was permanently
// MISSING-UPSTREAM (verified: 0 of 25 recorded shas resolvable). A plain
// `git fetch origin` does not deepen an existing shallow clone either, so the
// cache is explicitly unshallowed when needed.
function cloneUpstream() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      execSync(`git clone ${REPO_URL} ${CACHE_DIR}`, { stdio: 'pipe' });
      return true;
    }
    // A vendored/offline cache may have no remote at all; that is not fatal
    // as long as the recorded shas resolve (the per-skill check decides).
    let hasRemote = true;
    try {
      execSync('git remote get-url origin', { cwd: CACHE_DIR, stdio: 'pipe' });
    } catch {
      hasRemote = false;
    }
    if (hasRemote) {
      execSync('git fetch origin', { cwd: CACHE_DIR, stdio: 'pipe' });
    }
    if (fs.existsSync(path.join(CACHE_DIR, '.git', 'shallow'))) {
      try {
        execSync('git fetch --unshallow origin', { cwd: CACHE_DIR, stdio: 'pipe' });
      } catch {
        // Offline: leave the cache as-is. Unresolvable shas are reported
        // per-skill as MISSING-UPSTREAM, not as a FATAL clone failure.
      }
    }
    return true;
  } catch (e) {
    console.error(`FATAL: Could not clone/update upstream repo: ${e.message}`);
    process.exit(1);
  }
}

// --- Get upstream file content at a specific sha ---
function getUpstreamContentAtSha(sha, upstreamPath) {
  try {
    const content = execSync(`git show ${sha}:${upstreamPath}`, {
      cwd: CACHE_DIR,
      stdio: 'pipe'
    }).toString();
    return content;
  } catch (e) {
    return null;
  }
}

// --- Main logic ---
function main() {
  // Ensure upstream cache exists
  cloneUpstream();

  // Read all skill files
  let skillDirs;
  try {
    skillDirs = fs.readdirSync(SKILLS_DIR);
  } catch (e) {
    console.error(`FATAL: Cannot read skills directory ${SKILLS_DIR}: ${e.message}`);
    process.exit(1);
  }
  const skills = [];

  for (const dir of skillDirs) {
    const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);
      skills.push({
        name: dir,
        path: skillPath,
        content,
        frontmatter,
        body,
      });
    }
  }

  // Process each skill
  let drifted = [];
  const missingUpstream = [];
  const results = [];

  for (const skill of skills) {
    const source = skill.frontmatter.source;

    if (source === 'upstream') {
      const upstreamPath = skill.frontmatter['upstream-path'];
      const upstreamSha = skill.frontmatter['upstream-sha'];

      // Validate frontmatter keys
      if (!upstreamPath) {
        console.error(`FATAL: skill "${skill.name}" has source: upstream but missing upstream-path`);
        process.exit(1);
      }
      if (!upstreamSha) {
        console.error(`FATAL: skill "${skill.name}" has source: upstream but missing upstream-sha`);
        process.exit(1);
      }

      // Try to get the upstream content at the recorded sha
      let upstreamContent;
      try {
        upstreamContent = getUpstreamContentAtSha(upstreamSha, upstreamPath);
      } catch (e) {
        upstreamContent = null;
      }

      if (upstreamContent === null) {
        results.push(`${skill.name}: MISSING-UPSTREAM`);
        missingUpstream.push(skill.name);
        continue;
      }

      // Parse the upstream frontmatter to get the body
      const upstreamFm = parseFrontmatter(upstreamContent);
      const upstreamBody = upstreamFm.body;

      // Compare: local body vs upstream body
      // Normalize both for comparison: trim and collapse whitespace
      const localNorm = skill.body.replace(/\s+/g, ' ').trim();
      const upstreamNorm = upstreamBody.replace(/\s+/g, ' ').trim();

      if (localNorm === upstreamNorm) {
        results.push(`${skill.name}: OK`);
      } else {
        results.push(`${skill.name}: DRIFTED`);
        drifted.push(skill.name);
      }
    } else if (source === 'original') {
      // Original skills: no upstream to compare, just OK
      results.push(`${skill.name}: OK`);
    } else {
      // Malformed frontmatter or unknown source
      console.error(`FATAL: skill "${skill.name}" has malformed or missing source key`);
      process.exit(1);
    }
  }

  // Print per-skill one-line summaries
  console.log('---');
  for (const r of results) {
    console.log(r);
  }
  console.log('---');

  // Exit codes
  if (drifted.length > 0) {
    console.error(`\n${drifted.length} skill(s) DRIFTED from the recorded upstream sha: ${drifted.join(', ')}`);
    process.exit(EXIT_DRIFTED);
  }
  if (missingUpstream.length > 0) {
    console.error(`\n${missingUpstream.length} skill(s) MISSING-UPSTREAM: ${missingUpstream.join(', ')}`);
    console.error('The recorded upstream-sha could not be resolved in the cache. A shallow clone is the usual cause.');
    process.exit(EXIT_MISSING_UPSTREAM);
  }
  process.exit(EXIT_OK);
}

main();