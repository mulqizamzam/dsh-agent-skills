// End-to-end gate for /flow against the REAL host skill provider.
//
// The two existing gates each cover one half of the pipeline:
//   - flow-command.test.mjs  runs the real command with a HAND-BUILT catalog
//     stub (bodies stripped from disk by regex), so catalog resolution and the
//     host's renderSkillContent are only exercised on synthetic entries.
//   - skill-load.test.mjs   runs the real host FileSystemSkillProvider, but
//     never composes a workflow.
// This gate closes the seam: the EXACT provider config from cordis.patch.yml
// loads the skills, the real renderSkillContent renders each stage body, and
// every shipped workflow is composed end to end — selection, resolution,
// ordering, single steer, source metadata — through apply(ctx)'s real handler.
//
// If a stage body were rewritten, reordered, dropped, or double-steered, this
// gate fails; nothing else in the suite composes over the real loader.
//
// Note on scope: the provider is configured from this plugin's own manifest
// (customSkillDirs = this checkout), so a name collision with another mounted
// plugin (README Limitations, item 6: test-driven-development resolves to the
// dsh-superpowers copy in a live host) does not apply here — this gate proves
// the compose path, not host-wide name resolution.

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(PLUGIN_ROOT, 'cordis.patch.yml')
const HARNESS = '/home/administrator/deepseek-harness'
const PROVIDER_LIB = join(
  HARNESS, 'packages', 'skill', 'skill-filesystem', 'lib', 'index.js',
)

const require = createRequire(join(PLUGIN_ROOT, 'noop.js'))
const { isModelInvocable, renderSkillContent } = require('@deepseek-ai/dsh-skill')
const { parse: parseYaml } = require(
  join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'),
)

const { loadWorkflowDefinitions } = await import(
  pathToFileURL(join(PLUGIN_ROOT, 'lib', 'workflows.js')).href)
const { listSkillNames } = await import(
  pathToFileURL(join(PLUGIN_ROOT, 'lib', 'skill-catalog.js')).href)

let failures = 0
const check = (label, cond, detail) => {
  if (cond) console.log(`PASS ${label}`)
  else { failures += 1; console.log(`FAIL ${label} :: ${detail ?? ''}`) }
}

/**
 * Extract one stage section verbatim from the composed message.
 *
 * Substring checks cannot see a composer that appends junk after a stage body
 * (the body is still "included"), so the gate compares whole sections. The
 * section runs from its STAGE header to the next STAGE header or the trailing
 * "User request:" line, and must equal the expected lines exactly.
 */
function stageSection(message, header) {
  const lines = message.split('\n')
  const at = lines.indexOf(header)
  if (at === -1) return undefined
  const block = [lines[at]]
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^STAGE \d+ of \d+: /.test(lines[i]) || lines[i] === 'User request:') break
    block.push(lines[i])
  }
  return block
}

// One representative request per workflow. Each must route to its workflow
// deterministically (verified: feature=1 keyword, bugfix=2, investigation=3,
// migration=1, release=2, all others 0) — no tie-break reliance.
const CASES = [
  { workflow: 'feature', request: 'implement OAuth login' },
  { workflow: 'bugfix', request: 'fix the regression' },
  { workflow: 'investigation', request: 'investigate why CI is failing' },
  { workflow: 'migration', request: 'migrate the API from v1 to v2' },
  { workflow: 'release', request: 'deploy to production' },
]

async function providerConfig() {
  const raw = await readFile(MANIFEST, 'utf8')
  const doc = parseYaml(raw)
  const insert = doc?.[0]?.insert ?? []
  const row = insert.find((r) => r.name === '@deepseek-ai/dsh-skill-filesystem')
  if (row === undefined) throw new Error('cordis.patch.yml has no skill-filesystem insert row')
  return row.config
}

async function main() {
  // 1. The real host provider, configured from the shipped manifest.
  const config = await providerConfig()
  const { FileSystemSkillProvider } = await import(pathToFileURL(PROVIDER_LIB).href)
  const warnings = []
  const abort = new AbortController()
  const provider = new FileSystemSkillProvider(
    { logger: { warn: (m) => warnings.push(String(m)) }, get: () => undefined },
    { invalidate: () => {}, signal: abort.signal },
    config,
  )

  let candidates = await provider.list({ cwd: PLUGIN_ROOT })
  if (!Array.isArray(candidates)) {
    check('provider.list returned candidates, not an observation', false,
      JSON.stringify(candidates).slice(0, 200))
    candidates = candidates?.candidates ?? []
  }
  const byName = new Map(candidates.map((c) => [c.name, c]))

  // 2. A catalog facade shaped exactly like the host registry's get(name).
  const skills = {
    get: async (name) => {
      const candidate = byName.get(name)
      return candidate === undefined ? undefined : provider.get(candidate, { cwd: PLUGIN_ROOT })
    },
    list: async () => candidates,
  }

  // 3. Every shipped stage skill must resolve through the real provider and
  //    pass the engine's model-invocable policy, or /flow fails the run.
  const definitions = loadWorkflowDefinitions({ skills: listSkillNames() })
  const stageSkills = new Set()
  for (const definition of definitions.values()) {
    for (const stage of definition.stages) stageSkills.add(stage.skill)
  }
  for (const name of [...stageSkills].sort()) {
    const skill = await skills.get(name)
    check(`stage skill "${name}" resolves through the host provider`, skill !== undefined)
    if (skill !== undefined) {
      check(`stage skill "${name}" is model-invocable`, isModelInvocable(skill))
    }
  }

  // 4. Compose every workflow through the real command handler.
  const mod = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'index.js')).href)
  for (const testCase of CASES) {
    const definition = definitions.get(testCase.workflow)
    if (definition === undefined) { failures += 1; console.log(`FAIL missing definition ${testCase.workflow}`); continue }

    const registered = []
    const steers = []
    mod.apply({
      commands: { register: (d) => { registered.push(d); return () => {} } },
      skills,
    })
    const flow = registered.find((r) => r.name === 'flow')
    if (flow === undefined) { failures += 1; console.log(`FAIL /flow not registered (${testCase.workflow})`); continue }

    const tag = `[${testCase.workflow}]`
    const result = await flow.handler({
      agent: { steer: (m) => steers.push(m), session: { header: { cwd: PLUGIN_ROOT } } },
      rawInput: testCase.request,
      signal: abort.signal,
      commandId: `live-${testCase.workflow}`,
      attachments: [],
    })

    check(`${tag} result.kind === success`, result?.kind === 'success', `got ${result?.kind} ${result?.text ?? ''}`)
    check(`${tag} exactly one steer`, steers.length === 1, `got ${steers.length}`)
    const message = steers[0]?.content?.[0]?.text ?? ''
    check(`${tag} exact header prefix`,
      message.startsWith(`WORKFLOW\n========\n\nGoal:\n${testCase.request}\n\nSelected workflow:\n${definition.name} — ${definition.description}\n`),
      'header differs from the documented layout')
    check(`${tag} exact request tail`,
      message.endsWith(`User request:\n${testCase.request}`),
      'message does not end with the verbatim request')
    check(`${tag} steer source is plugin/instructions`,
      steers[0]?.source?.kind === 'plugin'
      && steers[0]?.source?.plugin === 'dsh-agent-skills'
      && steers[0]?.source?.form === 'instructions',
      JSON.stringify(steers[0]?.source))

    // Stage order and EXACT stage sections: header line, optional Purpose
    // line, blank, the host-rendered body verbatim, blank. Anything appended,
    // dropped, or reordered inside a section fails here.
    let cursor = -1
    for (const [index, stage] of definition.stages.entries()) {
      const header = `STAGE ${index + 1} of ${definition.stages.length}: ${stage.skill}`
      const section = stageSection(message, header)
      const skill = await skills.get(stage.skill)
      const body = skill === undefined ? undefined : renderSkillContent(skill)
      const expected = [
        header,
        ...(stage.purpose !== undefined ? [`Purpose: ${stage.purpose}`] : []),
        '',
        ...(body ?? ['<<BODY UNRESOLVED>>']).split('\n'),
        '',
      ]
      if (section === undefined) {
        check(`${tag} stage ${index + 1} present in order: ${stage.skill}`, false, 'header not found')
        continue
      }
      check(`${tag} stage ${index + 1} in order: ${stage.skill}`,
        message.indexOf(header) > cursor, `found at ${message.indexOf(header)}, previous at ${cursor}`)
      cursor = message.indexOf(header)
      const actual = section.join('\n')
      const wanted = expected.join('\n')
      const firstDiff = actual === wanted ? -1 : actual.split('\n').findIndex((line, i) => line !== expected[i])
      check(`${tag} stage ${index + 1} section exact (${stage.skill})`,
        actual === wanted,
        firstDiff === -1 ? `expected ${expected.length} lines, got ${section.length}` : `first differing line ${firstDiff + 1}: ${JSON.stringify((actual.split('\n')[firstDiff] ?? '').slice(0, 60))}`)
    }
    check(`${tag} no stage beyond definition order`,
      !message.includes(`STAGE ${definition.stages.length + 1} of`), 'unexpected extra stage section')
    check(`${tag} workflow rules carried`,
      definition.rules.every((rule) => message.includes(rule)), 'a rule string missing')
    check(`${tag} completion carried`,
      message.includes(`Definition of done for this workflow:\n${definition.completion}`),
      'completion missing')
  }

  // 5. Teardown before the summary: the provider owns filesystem watchers, so
  //    without abort+dispose the process never exits and the gate hangs.
  await abort.abort()
  await provider.dispose()

  check('no provider warnings', warnings.length === 0, warnings.slice(0, 3).join(' | '))

  console.log(`\nfailures=${failures}`)
  if (failures > 0) { console.log('flow live e2e gate FAIL'); process.exit(1) }
  console.log('flow live e2e gate PASS')
}

main().catch((error) => {
  console.log(`FAIL gate crashed :: ${error?.stack ?? error}`)
  process.exit(1)
})
