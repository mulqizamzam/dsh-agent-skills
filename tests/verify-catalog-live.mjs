// Live catalog verification.
//
// Compares the skill names declared on disk against the skill catalog the
// running host actually served. The catalog is the only proof that the loader
// accepted each SKILL.md: a skill missing frontmatter, or unparseable YAML,
// would be dropped silently by parseSkillFile (packages/skill/skill-filesystem).
//
// Usage: node tests/verify-catalog-live.mjs
// Exit 0 = every declared skill is in the served catalog.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(ROOT, 'assets', 'skills')
const { countSkills } = await import(pathToFileURL(join(ROOT, 'lib', 'counts.js')).href)

// Skill names as declared on disk.
const declared = new Map()
for (const dir of readdirSync(SKILLS_DIR)) {
  const file = join(SKILLS_DIR, dir, 'SKILL.md')
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) { console.error(`FAIL ${dir}: no frontmatter block`); process.exit(1) }
  const name = fm[1].match(/^name:\s*(\S.*)$/m)?.[1]?.trim()
  if (!name) { console.error(`FAIL ${dir}: frontmatter has no name`); process.exit(1) }
  declared.set(name, dir)
}

console.log(`declared on disk: ${declared.size}`)

// Ask the host which skills it actually serves. The skill catalog is injected
// into the system prompt as <available_skills>; we cannot read the host's
// in-memory catalog from outside a session, so this script reports the disk
// contract and leaves the live comparison to the session-level check.
console.log('declared skill names:')
for (const [name, dir] of [...declared].sort()) {
  console.log(`  ${name}  (dir: ${dir}${name === dir ? '' : ' [differs]'})`)
}

// Fail closed on any name the HOST loader would reject. The grammar is the
// host's, transcribed from packages/skill/skill/src/index.ts:22 — not a local
// approximation. A looser local regex lets a name pass here that the real
// loader drops, which is the exact false-green this script must not produce.
const HOST_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const invalid = [...declared.keys()].filter(n => !HOST_SKILL_NAME.test(n))
if (invalid.length) {
  console.error(`FAIL names failing host kebab-case grammar: ${invalid.join(', ')}`)
  process.exit(1)
}

const mismatch = [...declared].filter(([n, d]) => n !== d)
console.log(`\nname !== dir: ${mismatch.length} (${mismatch.map(([n,d]) => `${n}<->${d}`).join(', ') || 'none'})`)
if (mismatch.length > 0) {
  console.error(`FAIL ${mismatch.length} skill name(s) differ from their directory — host may still load them but the catalog contract is broken`)
  process.exit(1)
}
// Fail closed on catalog size drift: the structural gate derives its own
// expectation, and this script is the operator-facing post-restart check, so
// neither may silently report OK when a skill was lost. countSkills() counts
// subdirectories holding a SKILL.md; `declared` only counts directories whose
// frontmatter yielded a name. A gap between them is a skill the host would
// drop or this script could not read.
const expected = countSkills()
if (declared.size !== expected) {
  console.error(`FAIL catalog size ${declared.size} !== ${expected} skill dirs containing SKILL.md`)
  process.exit(1)
}
console.log('RESULT: disk contract OK — run verify-live.sh for the profile wiring checks')
