// Catalog verification — the DISK contract.
//
// What this script actually does (and all it claims to do): for every skill
// directory on disk it reads the frontmatter with the host's OWN YAML parser,
// checks the name against the host's kebab-case grammar, checks name===dir,
// and checks the total against countSkills(). A file the host loader would
// reject fails here by name.
//
// It does NOT read the running host's in-memory catalog — nothing outside a
// host session can. The earlier header promised that comparison and admitted
// in a comment that it was deferred to a check that exists nowhere; the honest
// statement of scope is this disk contract. (The extraction is the host's
// YAML parser, not a regex: a quoted `name: "beta"` or a trailing
// `name: beta # comment` reads as beta here, exactly as the loader reads it,
// and CRLF files are legal because the host strips \r.)

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(ROOT, 'assets', 'skills')
const { countSkills } = await import(pathToFileURL(join(ROOT, 'lib', 'counts.js')).href)

// The host's own YAML parser, the same one structural.test.mjs and
// gen-readme.mjs use — a local regex approximation is how a quoted scalar
// false-fails.
const HARNESS = process.env.DSH_HARNESS ?? '/home/administrator/deepseek-harness'
const require = createRequire(import.meta.url)
let parseYaml
try {
  ;({ parse: parseYaml } = require(join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml')))
} catch (error) {
  console.error(`FAIL cannot load the host YAML parser from ${HARNESS} (${error.code ?? error.message})`)
  console.error('     set DSH_HARNESS to the harness checkout if it lives elsewhere')
  process.exit(1)
}

// Skill names as declared on disk.
const declared = new Map()
for (const dir of readdirSync(SKILLS_DIR)) {
  const file = join(SKILLS_DIR, dir, 'SKILL.md')
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  // The host strips \r, so a CRLF file is legal; a regex over the raw text
  // would reject it while the loader accepts it.
  const fm = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)
  if (!fm) { console.error(`FAIL ${dir}: no frontmatter block`); process.exit(1) }
  let name
  try {
    const parsed = parseYaml(fm[1])
    name = typeof parsed?.name === 'string' ? parsed.name.trim() : ''
  } catch (error) {
    console.error(`FAIL ${dir}: frontmatter is not parseable YAML (${error.message})`)
    process.exit(1)
  }
  if (!name) { console.error(`FAIL ${dir}: frontmatter has no name`); process.exit(1) }
  declared.set(name, dir)
}

console.log(`declared on disk: ${declared.size}`)

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
