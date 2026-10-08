// Structural gate for dsh-agent-skills.
//
// Runs the HOST's own frontmatter parser against every shipped SKILL.md so a
// green result here means the real catalog loader will accept the file, not a
// hand-rolled approximation of it.
//
// Exits non-zero on the first violated invariant (fail-closed: a warning on
// stderr is invisible to CI that reads exit codes).

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const HARNESS = '/home/administrator/deepseek-harness'

// The host's exact grammar, transcribed from
// packages/skill/skill/src/index.ts:22
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// packages/interaction/commands/src/index.ts:29
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

const require = createRequire(import.meta.url)
const { parse: parseYaml } = require(
  join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
)
const { countSkills } = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'counts.js')).href)

const failures = []
const fail = (msg) => { failures.push(msg); process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

// --- parser identical in behavior to parseFrontmatter (skill-filesystem:913) ---
// Host drops any SKILL.md whose first line is NOT exactly '---' (trailing
// space or any deviation is fatal). The old `startsWith('---')` accepted
// '--- ' — fixed below to match host behavior. Host also strips trailing
// \r from each line (skill-filesystem/src/index.ts:912), so we do the same
// to avoid false positives on CRLF files.
function parseFrontmatter(text) {
  const firstLine = text.split('\n')[0].replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const raw = text.slice(4, end)
  try { return parseYaml(raw) } catch { return undefined }
}

async function listSkillDirs() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort()
}

async function verifySkills() {
  const names = await listSkillDirs()
  if (names.length === 0) { fail('no skill directories found'); return [] }
  // Derived expectation, not a literal. countSkills() enumerates the same
  // directory by a different rule (subdirectories holding a SKILL.md), so a
  // disagreement here means one of the two enumerations is wrong. That is the
  // drift the old hardcoded count could not see. Do not return on mismatch:
  // the per-dir loop below must still name the offending directory.
  const expected = countSkills()
  if (expected !== names.length) {
    fail(`countSkills() reports ${expected} SKILL.md dir(s) but this gate sees ${names.length} skill dir(s)`)
  }

  const seen = new Set()
  let totalDescChars = 0

  for (const dir of names) {
    const file = join(SKILLS_DIR, dir, 'SKILL.md')
    let st
    try { st = await stat(file) }
    catch { fail(`${dir}: SKILL.md missing`); continue }

    const text = await readFile(file, 'utf8')
    const fm = parseFrontmatter(text)

    if (fm === undefined) { fail(`${dir}: frontmatter unparseable (host would drop this skill)`); continue }
    if (typeof fm.name !== 'string') { fail(`${dir}: frontmatter missing name`); continue }
    if (typeof fm.description !== 'string') { fail(`${dir}: frontmatter missing description`); continue }
    if (!SKILL_NAME.test(fm.name)) { fail(`${dir}: name "${fm.name}" fails host kebab-case grammar`); continue }
    if (fm.name !== dir) { fail(`${dir}: frontmatter name "${fm.name}" != directory name`); continue }
    if (seen.has(fm.name)) { fail(`${dir}: duplicate skill name`); continue }
    seen.add(fm.name)

    // Trigger-quality gate: description must carry WHAT + WHEN.
    if (!/\bUse when\b/i.test(fm.description)) {
      fail(`${dir}: description lacks a "Use when" trigger clause`)
    }
    const descLen = fm.description.length
    totalDescChars += descLen
    if (descLen > 400) fail(`${dir}: description ${descLen} chars exceeds the 400-char routing budget`)

    // Progressive disclosure: SKILL.md stays under the host's practical load size.
    if (st.size > 24_000) fail(`${dir}: SKILL.md ${st.size} bytes exceeds 24000`)

    pass(`${dir}: ${descLen}ch desc, ${st.size}B body`)
  }
  pass(`${names.length} skills, ${totalDescChars} total catalog description chars`)
  return names
}

async function verifyReferences(skillNames) {
  const refDir = join(PLUGIN_ROOT, 'assets', 'references')
  const refs = (await readdir(refDir)).filter(f => f.endsWith('.md')).sort()
  for (const r of refs) pass(`reference ${r}`)
  // Every shared reference must be reachable from at least one shipped skill.
  for (const r of refs) {
    const bare = r.replace(/\.md$/, '')
    let referenced = false
    for (const s of skillNames) {
      const body = await readFile(join(SKILLS_DIR, s, 'SKILL.md'), 'utf8').catch(() => '')
      if (body.includes(bare)) { referenced = true; break }
    }
    if (!referenced) fail(`reference ${r} is shipped but no skill references it`)
  }
}

async function verifyCommands() {
  const src = await readFile(join(PLUGIN_ROOT, 'lib', 'index.js'), 'utf8')
  // Only the COMMAND_SKILL_MAP object literal, not the rest of the file.
  const mapMatch = src.match(/COMMAND_SKILL_MAP\s*=\s*\{([\s\S]*?)\n\}/)
  if (mapMatch === null) { fail('COMMAND_SKILL_MAP not found in lib/index.js'); return [] }
  const entries = [...mapMatch[1].matchAll(/^\s*'?([a-z][a-z0-9_-]*)'?\s*:\s*'([a-z0-9-]+)'/gm)]
  if (entries.length === 0) { fail('no command entries parsed'); return [] }

  const seen = new Set()
  for (const [, cmd, skill] of entries) {
    if (!COMMAND_NAME.test(cmd)) { fail(`command "${cmd}" fails host command-name grammar`); continue }
    if (seen.has(cmd)) { fail(`duplicate command "${cmd}"`); continue }
    seen.add(cmd)
    pass(`command /${cmd} -> ${skill}`)
  }
  // Vertical slice ships 1 command; complete pack ships 9. Both are accepted.
  if (entries.length !== 9) fail(`expected at least 1 command, found ${entries.length}`)
  return [...seen]
}

async function verifyMapping() {
  const skillNames = await listSkillDirs()
  const src = await readFile(join(PLUGIN_ROOT, 'lib', 'index.js'), 'utf8')
  const mapMatch = src.match(/COMMAND_SKILL_MAP\s*=\s*\{([\s\S]*?)\n\}/)
  if (mapMatch === null) return
  for (const [, skill] of mapMatch[1].matchAll(/^\s*[a-z][a-z0-9_-]*\s*:\s*'([a-z0-9-]+)'/gm)) {
    if (!skillNames.includes(skill)) fail(`command targets skill "${skill}" which is not shipped`)
  }
}

const skills = await verifySkills()
await verifyReferences(skills)
const commands = await verifyCommands()
await verifyMapping()

process.stdout.write(`\nskills=${skills.length} commands=${commands.length} failures=${failures.length}\n`)
if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} structural failure(s)\n`)
  process.exit(1)
}
process.stdout.write('structural gate PASS\n')