// Single enumeration of the shipped skill catalog.
//
// Both the workflow-definition validator and the skill-contract validator need
// "which skills actually exist", and each one deriving its own list is how the
// two drift apart. This module owns the list; `counts.js` keeps its count.
//
// Enumerates the same rule countSkills() documents: a subdirectory of
// assets/skills/ that holds a SKILL.md. A skill directory whose SKILL.md went
// missing stops being listed, so a definition pointing at it fails the "unknown
// skill reference" check rather than resolving against a directory with no body.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')

/**
 * Names of the skill directories that hold a SKILL.md.
 *
 * @param {{ root?: string, skillsDir?: string }} [options] override the plugin root
 *   (used by tests to validate fixtures against a synthetic catalog)
 * @returns {string[]} sorted skill names
 * @throws {Error} when the skills directory itself cannot be read — a missing
 *   root would otherwise read as an empty catalog and let every reference check
 *   pass on absence
 */
export function listSkillNames(options = {}) {
  const skillsDir = options.skillsDir ?? join(options.root ?? PLUGIN_ROOT, 'assets', 'skills')
  let entries
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`skill catalog: cannot read ${skillsDir} (${error.code ?? error.message})`)
  }
  const names = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!existsSync(join(skillsDir, entry.name, 'SKILL.md'))) continue
    names.push(entry.name)
  }
  return names.sort()
}
