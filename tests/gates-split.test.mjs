// Structural gate + host FileSystemSkillProvider asymmetry test
// ===============================================================
// This test verifies that the structural gate and the real host loader
// own different halves of the "name vs directory" rule:
//   - Structural gate REJECTS when fm.name !== dir
//   - Host FileSystemSkillProvider ACCEPTS when fm.name !== dir (uses frontmatter name)
// 
// If both gates ever agree (both accept or both reject), the test fails,
// because the asymmetry is the point of this gate.

import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import { FileSystemSkillProvider } from '/home/administrator/deepseek-harness/packages/skill/skill-filesystem/lib/index.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = '/home/administrator/deepseek-harness'
const require = createRequire(import.meta.url)
const { parse: parseYaml } = require(
  join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
)

// --- parseFrontmatter identical to structural.test.mjs:42-49 ---
function parseFrontmatter(text) {
  const firstLine = text.split('\n')[0].replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const raw = text.slice(4, end)
  try { return parseYaml(raw) } catch { return undefined }
}

// --- the structural gate's name-vs-directory rule (line 85 of structural.test.mjs) ---
// Rejected when: fm.name is a string, kebab-case, description present, AND fm.name !== dir
function structuralNameDirCheck(fm, dir) {
  if (typeof fm.name !== 'string') return false // not the rejection case
  const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  if (!SKILL_NAME.test(fm.name)) return false // not the rejection case
  if (typeof fm.description !== 'string') return false // not the rejection case
  return fm.name !== dir // TRUE when structural gate WOULD reject
}

async function main() {
  // 1. Create temp skill dir OUTSIDE assets/skills/ under plugin root
  const tmpRoot = await mkdtemp(join(PLUGIN_ROOT, '.gates-split-'))

  try {
    // Directory name: "foo", frontmatter name: "bar"
    const skillDir = join(tmpRoot, 'foo')
    await mkdir(skillDir)

    // SKILL.md with frontmatter name: bar, directory is foo
    const skillMd = `---\nname: bar\ndescription: Use when you need to split gates\n---\nbody\n`
    await writeFile(join(skillDir, 'SKILL.md'), skillMd)

    // 2. Structural gate validation: should REJECT (fm.name !== dir)
    const fm = parseFrontmatter(skillMd)
    const structuralRejects = structuralNameDirCheck(fm, 'foo') // fm.name="bar", dir="foo" → "bar" !== "foo" → true = rejects

    // 3. Host FileSystemSkillProvider: should ACCEPT (candidate comes back under name "bar")
    const warnings = []
    const { control, abort } = makeControl()
    const ctx = makeCtx(warnings)
    const provider = new FileSystemSkillProvider(ctx, control, {
      providerName: 'gates-split',
      includeDefaultRoots: false,
      customSkillDirs: [tmpRoot],
    })

    const candidates = await provider.list({ cwd: tmpRoot })
    const hostAccepts = Array.isArray(candidates) && candidates.some(c => c.name === 'bar')

    // 4. Assert asymmetry: one must reject, the other must accept
    //    If both reject → structural gate and host both reject → split broken
    //    If both accept → structural gate and host both accept → split broken
    const gatesAgree = structuralRejects !== hostAccepts // XOR: disagree when one rejects & one accepts; agree when both reject or both accept

    if (gatesAgree) {
      process.stderr.write(
        `FAIL two-gates-own-one-rule split has been broken: both gates ${structuralRejects ? 'reject' : 'accept'}; host ${hostAccepts ? 'accept' : 'reject'}\n`
      )
      process.exit(1)
    }

    // Asymmetry confirmed: structural rejects, host accepts
    process.stdout.write(
      `PASS structural gate rejects, host accepts (split intact)\n`
    )

  } finally {
    // 5. Clean up temp dir
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

// Host helper stubs (identical to skill-load.test.mjs:63-76)
function makeCtx(warnings) {
  return {
    logger: { warn: (msg) => warnings.push(String(msg)) },
    get: (key) => (key === 'fs' ? undefined : undefined),
  }
}

function makeControl() {
  const abort = new AbortController()
  return {
    control: { invalidate: () => {}, signal: abort.signal },
    abort,
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL ${err}\n`)
  process.exit(1)
})