/**
 * Diff-upstream script for Task 7: provenance frontmatter + upstream drift check.
 * 
 * For each skill with source: upstream, diff the local body (text after closing ---)
 * against the upstream file at the recorded upstream-sha.
 * 
 * Exit 0 if zero drift, exit 1 if any drift.
 * Prints per-skill summary: OK, DRIFTED, or MISSING-UPSTREAM.
 * Fail closed on clone failure or malformed frontmatter.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// --- Configuration ---
const REPO_URL = 'https://github.com/addyosmani/agent-skills';
const CACHE_DIR = path.join(process.cwd(), 'upstream-cache');
const SKILLS_DIR = path.join(process.cwd(), 'assets', 'skills');

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
function cloneUpstream() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      execSync(`git clone --depth 1 ${REPO_URL} ${CACHE_DIR}`, { stdio: 'pipe' });
    } else {
      // Update existing clone
      execSync('git fetch origin', { cwd: CACHE_DIR, stdio: 'pipe' });
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
  const skillDirs = fs.readdirSync(SKILLS_DIR);
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
  let anyDrift = false;
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
        anyDrift = true;
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
        anyDrift = true;
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
  if (anyDrift) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();