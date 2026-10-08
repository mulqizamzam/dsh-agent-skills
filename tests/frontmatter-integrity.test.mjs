// Frontmatter-integrity gate for dsh-agent-skills.
//
// The other gates check consistency, name/description shape, and body-vs-upstream
// equality. None of them notices corrupted BYTES: during task 7, 27 files were
// damaged (double-escaped descriptions, a frontmatter that lost its newlines,
// 16 bodies carrying a second provenance block) and structural + readme:check +
// diff:upstream all stayed green. This gate is what looks at the bytes.
//
// Uses the HOST's exact YAML parser, not a regex. Exits 1 on any violation.

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const HARNESS = '/home/administrator/deepseek-harness'

// The host's exact parser — same module structural.test.mjs loads.
const require = createRequire(import.meta.url)
const { parse: parseYaml } = require(
  join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
)

let failures = 0
const fail = (msg) => { failures++; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

// Host grammar, transcribed from skill-filesystem parseFrontmatter: first line
// must be exactly '---', the fence closes on the next line starting '---'.
function splitFrontmatter(text) {
  const firstLine = text.split('\n')[0].replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const fmRaw = text.slice(4, end)
  const closeLineEnd = text.indexOf('\n', end + 1)
  const body = closeLineEnd === -1 ? '' : text.slice(closeLineEnd + 1)
  return { fmRaw, body }
}

async function main() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  if (dirs.length === 0) { fail('no skill directories found'); return finish() }

  for (const dir of dirs) {
    const file = join(SKILLS_DIR, dir, 'SKILL.md')
    let bytes
    try { bytes = await stat(file) } catch { fail(`${dir}: SKILL.md missing`); continue }
    const text = await readFile(file, 'utf8')

    // 1. Frontmatter parses with the host's parser. Duplicate keys throw.
    const split = splitFrontmatter(text)
    if (split === undefined) { fail(`${dir}: no parseable frontmatter fence`); continue }
    let fm
    try { fm = parseYaml(split.fmRaw) }
    catch (e) { fail(`${dir}: YAML: ${String(e.message).split('\n')[0]}`); continue }
    if (fm === null || typeof fm !== 'object') { fail(`${dir}: frontmatter is not a mapping`); continue }

    // 2. Duplicate keys, counted explicitly so the message names the defect.
    const keyLines = split.fmRaw.split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l))
    if (keyLines.length !== new Set(Object.keys(fm)).size) { fail(`${dir}: duplicate frontmatter keys`); continue }

    // 3. Double-escaping: description must not contain literal \n or \\.
    const desc = fm.description
    if (typeof desc !== 'string') { fail(`${dir}: description missing or not a string`); continue }
    if (desc.includes('\\n') || desc.includes('\\\\')) { fail(`${dir}: description carries a literal backslash sequence`); continue }

    // 4. Exactly one frontmatter block: body must not carry another ---,
    //    and provenance keys belong in the frontmatter, not down in the body.
    if (split.body.split('\n').some((l) => l.trim() === '---')) { fail(`${dir}: body contains a second --- delimiter`); continue }
    const bodyProv = split.body.split('\n').filter((l) => /^(source|upstream-path|upstream-sha):/.test(l))
    if (bodyProv.length > 0) { fail(`${dir}: provenance key in body: ${bodyProv[0]}`); continue }

    // 5. Byte-level. Exactly one trailing newline. Frontmatter must remain
    //    line-structured: collapsed frontmatter (no line breaks) or a missing
    //    newline before the closing fence both damage the file.
    if (!text.endsWith('\n')) { fail(`${dir}: no final newline`); continue }
    if (text.endsWith('\n\n')) { fail(`${dir}: trailing double newline`); continue }
    const fmLines = split.fmRaw.split('\n')
    if (fmLines.length < 2) { fail(`${dir}: frontmatter has no line breaks (collapsed)`); continue }
    if (fmLines.some((l) => l.trimStart().startsWith('---'))) { fail(`${dir}: frontmatter not newline-terminated before closing fence`); continue }

    pass(`${dir}: ${desc.length}ch desc, ${bytes.size}B body`)
  }
  return finish()
}

function finish() {
  if (failures > 0) {
    process.stderr.write(`\n${failures} frontmatter-integrity failure(s)\n`)
    process.exit(1)
  }
  process.stdout.write('frontmatter-integrity gate PASS\n')
  process.exit(0)
}

await main()
