// Derived counts — the single source of truth for "how much does this
// plugin ship?".
//
// The skill count used to live in six places (two test assertions, one shell
// status string, package.json, README, and lib/index.js). Adding a skill meant
// editing all six or `npm test` failed, which is the repo's most-documented
// pain. Both counts below are now computed from the artefacts themselves, so a
// new skill needs no edit outside its own directory.
//
// COMMAND_SKILL_MAP's size is a SEPARATE invariant from the skill count: a
// skill may ship with no slash command (it stays reachable by agent judgment),
// so the two numbers must never be derived from each other.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const INDEX_JS = join(PLUGIN_ROOT, 'lib', 'index.js')

// Same entry pattern the structural gate uses to read COMMAND_SKILL_MAP, kept
// here so both consumers agree on what "one command entry" looks like.
const MAP_BLOCK = /COMMAND_SKILL_MAP\s*=\s*\{([\s\S]*?)\n\}/
const MAP_ENTRY = /^\s*'?([a-z][a-z0-9_-]*)'?\s*:\s*'([a-z0-9-]+)'/gm

/**
 * Number of subdirectories of assets/skills/ that contain a SKILL.md.
 *
 * Deliberately counts files, not frontmatter: a skill directory whose SKILL.md
 * was deleted stops counting here, so the structural gate's own enumeration
 * (every subdirectory) and this one disagree and the gate fails closed.
 *
 * @returns {number} how many skills the plugin ships
 * @throws {Error} when assets/skills/ itself is unreadable — a missing root is
 *   a broken checkout, and returning 0 there would let a gate pass on absence.
 */
export function countSkills() {
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md'))) count += 1
  }
  return count
}

/**
 * Number of entries in COMMAND_SKILL_MAP in lib/index.js.
 *
 * No consumer yet: it ships in Task 1 so the pair of counters exists in one
 * place, and its first caller lands in Task 6, which asserts that the command
 * map and the skill catalog are exhaustive in both directions. It is not dead
 * code — the README's command-count line and that gate both read from here.
 *
 * Parses the source rather than importing it: lib/index.js pulls in
 * @deepseek-ai/dsh-skill and @deepseek-ai/dsh-llm, which only resolve from an
 * installed profile, so importing it would fail on a fresh clone.
 *
 * @returns {number} how many slash commands the plugin registers
 * @throws {Error} when the map cannot be found or parses to zero entries —
 *   returning 0 would hide a renamed or reformatted map behind a green count.
 */
export function countCommands() {
  const src = readFileSync(INDEX_JS, 'utf8')
  const block = src.match(MAP_BLOCK)
  if (block === null) {
    throw new Error('counts: COMMAND_SKILL_MAP not found in lib/index.js')
  }
  const entries = [...block[1].matchAll(MAP_ENTRY)]
  if (entries.length === 0) {
    throw new Error('counts: COMMAND_SKILL_MAP parsed to 0 entries')
  }
  return entries.length
}
