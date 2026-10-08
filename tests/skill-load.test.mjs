// End-to-end load test for the shipped skill catalog.
//
// The structural gate (structural.test.mjs) TRANSCRIBES the host's frontmatter
// parser; it never runs host code. This test closes that gap for the real
// loader: it constructs the host's own FileSystemSkillProvider from
// @deepseek-ai/dsh-skill-filesystem, configured with the EXACT config shipped
// in cordis.patch.yml (providerName / includeDefaultRoots / customSkillDirs,
// read from the manifest rather than copied here), and asserts that every
// shipped SKILL.md survives discovery and body load.
//
// Without it, a skill could parse cleanly in the structural gate and still be
// dropped by the host at load time, and nothing in the suite would notice.
//
// It also runs a mutation check against the same provider. Three decoy files
// (no frontmatter, a name that fails the host kebab-case grammar, and
// frontmatter missing description) must be dropped while an intact copy still
// loads, and a fourth decoy whose directory name differs from its frontmatter
// name must load under the FRONTMATTER name, because that mismatch is owned by
// the structural gate, not by the loader. A loader that accepts the first three
// would make every green result above worthless, so the gate proves it can fail
// before it is trusted to prove a pass.
//
// MANDATE: do not delete or weaken the mutation probe to make this test faster
// or simpler. Any gate claiming "the host drops broken skills" is only evidence
// while it also shows the host dropping one. A weakened probe costs one line
// of saved code against every future silent-drop the suite can no longer catch,
// and this repo has already caught one (the quoted-YAML-description bug at
// ff6b93f). See README, Limitations item 2.

import { readFile, mkdtemp, writeFile, mkdir, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const MANIFEST = join(PLUGIN_ROOT, 'cordis.patch.yml')
const HARNESS = '/home/administrator/deepseek-harness'
const PROVIDER_LIB = join(
  HARNESS, 'packages', 'skill', 'skill-filesystem', 'lib', 'index.js',
)

const require = createRequire(import.meta.url)
const { parse: parseYaml } = require(
  join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
)

let failures = 0
const fail = (msg) => { failures += 1; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

function check(cond, msg) {
  if (cond) pass(msg)
  else fail(msg)
  return cond
}

// Minimal host context: the provider touches ctx.logger.warn and ctx.get('fs')
// (an absent fs service makes it fall back to node:fs, which is what a profile
// without ctx.fs does). Anything else it uses is caught internally and logged,
// so a stub that only implements those two members is enough to exercise the
// real load path.
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

// Frontmatter split identical in behavior to the host's parseSkillFile:
// body = everything after the closing fence, trimmed.
function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (m === null) return undefined
  return { header: m[1], body: m[2].trim() }
}

async function providerConfig() {
  const raw = await readFile(MANIFEST, 'utf8')
  const doc = parseYaml(raw)
  const insert = doc?.[0]?.insert ?? []
  const row = insert.find((r) => r.name === '@deepseek-ai/dsh-skill-filesystem')
  if (row === undefined) throw new Error('cordis.patch.yml has no skill-filesystem insert row')
  return { ...row.config, manifestName: row.name }
}

async function main() {
  // 1. The manifest still points the provider at this checkout's skills dir.
  const config = await providerConfig()
  check(config.providerName === 'agent-skills', 'manifest providerName is agent-skills')
  check(config.includeDefaultRoots === false, 'manifest keeps includeDefaultRoots false')
  const custom = config.customSkillDirs ?? []
  check(custom.includes(SKILLS_DIR), `manifest customSkillDirs includes ${SKILLS_DIR}`)

  // 2. Drive the REAL host provider over the shipped config.
  const { FileSystemSkillProvider } = await import(pathToFileURL(PROVIDER_LIB).href)
  const warnings = []
  const { control, abort } = makeControl()
  const ctx = makeCtx(warnings)
  const provider = new FileSystemSkillProvider(ctx, control, config)

  let candidates = await provider.list({ cwd: PLUGIN_ROOT })
  if (!Array.isArray(candidates)) {
    // A SkillProviderObservation means the watcher was incomplete; report it
    // rather than silently treating it as a list with a different shape.
    fail(`provider.list returned an observation, not candidates: ${JSON.stringify(candidates)}`)
    candidates = candidates?.candidates ?? []
  }

  const onDisk = new Set(
    (await (await import('node:fs/promises')).readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  )

  check(candidates.length === onDisk.size,
    `host provider discovered ${candidates.length}/${onDisk.size} shipped skills`)
  const names = new Set(candidates.map((c) => c.name))
  for (const dir of onDisk) {
    if (!names.has(dir)) fail(`host provider dropped skill "${dir}"`)
  }

  // 3. Load bodies through the provider, including the skill under test.
  let loaded = 0
  const byName = new Map()
  for (const candidate of candidates) {
    const skill = await provider.get(candidate, { cwd: PLUGIN_ROOT })
    if (skill === undefined) { fail(`provider.get returned undefined for "${candidate.name}"`); continue }
    loaded += 1
    byName.set(skill.name, skill)
    if (skill.content === undefined || skill.content.length === 0) {
      fail(`skill "${skill.name}" loaded with an empty body`)
    }
    const disk = splitFrontmatter(await readFile(join(SKILLS_DIR, candidate.name, 'SKILL.md'), 'utf8'))
    if (disk === undefined) { fail(`${candidate.name}: could not split frontmatter on disk`); continue }
    if (skill.content !== disk.body) {
      fail(`${candidate.name}: loaded body differs from disk (${skill.content.length} vs ${disk.body.length} chars)`)
    }
    // Compare against the YAML-parsed value, never the raw line: a description
    // may legitimately be a quoted scalar (git-workflow-and-versioning is), and
    // regexing the line back would compare the quotes, not the description.
    let diskDescription
    try { diskDescription = parseYaml(disk.header).description } catch { diskDescription = undefined }
    if (skill.description !== diskDescription) {
      fail(`${candidate.name}: loaded description differs from disk (${JSON.stringify(skill.description)} vs ${JSON.stringify(diskDescription)})`)
    }
  }
  check(loaded === candidates.length, `host provider loaded bodies for ${loaded}/${candidates.length} skills`)
  check(byName.has('testing-strategy'), 'skill "testing-strategy" is in the host-loaded catalog')

  const target = byName.get('testing-strategy')
  if (target !== undefined) {
    check(/\bUse when\b/.test(target.description),
      'testing-strategy description carries its "Use when" trigger clause')
    check(target.description.length <= 400,
      `testing-strategy description within the 400-char budget (${target.description.length})`)
    check(target.invocation?.modelInvocable === true || target.invocation?.userInvocable === true,
      'testing-strategy carries a usable invocation policy')
    check(/## 7\. Final Assessment/.test(target.content),
      'testing-strategy body still carries the full output contract')
    check(target.resourceBase?.path === join(SKILLS_DIR, 'testing-strategy'),
      'testing-strategy resourceBase resolves to its own directory')
  }

  // 4. Mutation check: the same host code must DROP broken files. Without this,
  // every green assertion above would be unfalsifiable.
  const tmpRoot = await mkdtemp(join(PLUGIN_ROOT, '.skill-load-'))
  try {
    const goodDir = join(tmpRoot, 'mutation-good')
    await mkdir(goodDir)
    const original = await readFile(join(SKILLS_DIR, 'testing-strategy', 'SKILL.md'), 'utf8')
    await writeFile(join(goodDir, 'SKILL.md'), original)

    const noFrontmatter = join(tmpRoot, 'mutation-plain')
    await mkdir(noFrontmatter)
    await writeFile(join(noFrontmatter, 'SKILL.md'), '# no frontmatter here\n')

    const badName = join(tmpRoot, 'mutation-badname')
    await mkdir(badName)
    await writeFile(join(badName, 'SKILL.md'),
      '---\nname: Not A Valid Name\ndescription: decoy\n---\nbody\n')

    const missingDescription = join(tmpRoot, 'mutation-nodesc')
    await mkdir(missingDescription)
    await writeFile(join(missingDescription, 'SKILL.md'), '---\nname: decoy-nodesc\n---\nbody\n')

    // Directory name differing from the frontmatter name is a case the host
    // loader ACCEPTS on purpose: the name comes from the frontmatter, which is
    // why the control above (dir "mutation-good", name "testing-strategy")
    // works at all. Rejecting that mismatch is the structural gate's job
    // (structural.test.mjs fails when fm.name !== dir), not the loader's.
    // Pinning it here keeps the two rules from quietly swapping owners.
    const renamed = join(tmpRoot, 'mutation-dirname-mismatch')
    await mkdir(renamed)
    await writeFile(join(renamed, 'SKILL.md'),
      '---\nname: decoy-dirname\ndescription: decoy description\n---\nbody\n')

    const mutWarnings = []
    const mutCtx = makeCtx(mutWarnings)
    const mut = makeControl()
    const mutProvider = new FileSystemSkillProvider(mutCtx, mut.control, {
      providerName: 'mutation-probe',
      includeDefaultRoots: false,
      customSkillDirs: [tmpRoot],
    })
    let mutCandidates = await mutProvider.list({ cwd: tmpRoot })
    if (!Array.isArray(mutCandidates)) mutCandidates = mutCandidates?.candidates ?? []
    const mutNames = new Set(mutCandidates.map((c) => c.name))

    check(mutNames.has('testing-strategy'),
      'mutation probe: the intact copy still loads (control)')
    check(mutCandidates.length === 2,
      `mutation probe: host returned ${mutCandidates.length}/2 expected candidates (3 broken files must be dropped)`)
    check(!mutNames.has('no frontmatter here'),
      'mutation probe: file without frontmatter is dropped, not loaded')
    check(!mutNames.has('Not A Valid Name'),
      'mutation probe: name failing host kebab-case grammar is dropped')
    check(!mutNames.has('decoy-nodesc'),
      'mutation probe: frontmatter missing description is dropped')
    check(mutNames.has('decoy-dirname') && !mutNames.has('mutation-dirname-mismatch'),
      'mutation probe: name/dir mismatch loads under its frontmatter name (structural gate owns that rule)')
    check(mutWarnings.length >= 3,
      `mutation probe: host logged ${mutWarnings.length} warning(s) for the decoys`)

    await mut.abort.abort()
    await mutProvider.dispose()
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }

  // 5. Teardown: close watchers so the process can exit without hanging.
  await abort.abort()
  await provider.dispose()
  try { await stat(PROVIDER_LIB) } catch { fail(`provider lib missing: ${PROVIDER_LIB}`) }
  if (warnings.length > 0) {
    process.stderr.write(`NOTE host warnings during clean load: ${warnings.length}\n`)
    for (const w of warnings) process.stderr.write(`  ${w}\n`)
  }

  process.stdout.write(`\nskills loaded=${loaded} failures=${failures}\n`)
  if (failures > 0) {
    process.stderr.write(`\n${failures} skill-load failure(s)\n`)
    process.exit(1)
  }
  process.stdout.write('skill-load e2e PASS\n')
}

await main()
