#!/usr/bin/env node
// npm run skill:new <kebab-name> — scaffold a new skill with one command.
// Validates the name against the DSH loader grammar, refuses if the skill
// directory already exists, writes a minimal SKILL.md frontmatter skeleton,
// then runs the existing gen-readme.mjs to keep the README fresh.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const NAME_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// --------------- CLI entry ---------------

const args = process.argv.slice(2)
if (args.length !== 1) {
  console.error('Usage: node scripts/new-skill.mjs <kebab-name>')
  process.exit(1)
}

const name = args[0]

// 1. Validate grammar
if (!NAME_GRAMMAR.test(name)) {
  console.error(`ERROR: "${name}" does not match the DSH kebab-case grammar: /^[a-z0-9]+(?:-[a-z0-9]+)*$/`)
  process.exit(1)
}

// 2. Refuse if already exists
if (existsSync(join(SKILLS_DIR, name))) {
  console.error(`ERROR: assets/skills/${name}/ already exists`)
  process.exit(1)
}

// 3. Create the skill directory and SKILL.md
mkdirSync(join(SKILLS_DIR, name), { recursive: true })

const skillMdPath = join(SKILLS_DIR, name, 'SKILL.md')
const placeholderDescription = 'TODO: Use when necessary'
const skillMdContent = `---\nname: ${name}\ndescription: "${placeholderDescription}"\n---\n`
writeFileSync(skillMdPath, skillMdContent, 'utf8')

// 4. Regenerate README via the existing generator (final step)
const genResult = spawnSync('node', [join(PLUGIN_ROOT, 'scripts', 'gen-readme.mjs')], {
  stdio: 'inherit',
})

if (genResult.status !== 0) {
  process.exit(genResult.status || 1)
}

// 5. Print the list of files needing manual edit.
// The scaffold cannot finish the job: README documents TWO edits for a new
// skill, and the contract entry is the one left. Produces/consumes/categories/
// risk come from closed vocabularies, so a generated placeholder would either
// fail the vocabulary gate or ship as an empty contract nobody fills. Name the
// file and the gate that fails without it — "no manual edits required" used to
// be printed here while skill-contracts.test.mjs was already failing.
console.log('remaining manual edit: assets/skill-contracts.json — add one contract entry for the new skill (skill-contracts.test.mjs fails until you do)')