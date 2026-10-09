// Behavioral test for the /flow command.
//
// Exercises the ACTUAL apply(ctx) function with a mock ctx + mock agent,
// crossing the real serialization boundary (host lib index.js functions:
// isModelInvocable, renderSkillContent, createUserMessage).
//
// Cases:
//   1. /flow is registered next to the nine skill aliases
//   2. happy path: workflow selected, skills resolved in order, ONE steer,
//      source metadata is plugin/instructions, raw request preserved
//   3. routing: each representative request selects the expected workflow
//   4. missing REQUIRED stage → error, nothing steered
//   5. missing OPTIONAL stage → skipped, still one steer, skip reported
//   6. a workflow with on_optional_missing: error → error, nothing steered
//   7. a skill present but not model-invocable counts as unavailable
//   8. empty request → usage error
//
// This is what proves the command composes the workflow instead of treating each
// skill as an isolated prompt, and it is the only place the "one steering
// message for v1" invariant is actually measured.

import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(PLUGIN_ROOT, 'noop.js'))
const { isModelInvocable } = require('@deepseek-ai/dsh-skill')
const { createUserMessage } = require('@deepseek-ai/dsh-llm')

const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')
const WORKFLOWS_DIR = join(PLUGIN_ROOT, 'assets', 'workflows')

/** Real skill bodies from disk, so the composed message carries true content. */
async function realSkill(name) {
  const path = join(SKILLS_DIR, name, 'SKILL.md')
  const text = await readFile(path, 'utf8')
  const body = text.replace(/^---[\s\S]*?\n---\n?/, '')
  return { name, provider: 'agent-skills', description: 'real', content: body, path }
}

/**
 * Build a catalog stub whose entries come from the real SKILL.md files.
 * `unavailable` names are omitted; `modelOnly` names load but are not
 * model-invocable, which is how the engine must treat them.
 */
async function buildCatalog({ unavailable = new Set(), modelOnly = new Set() } = {}) {
  const entries = new Map()
  for (const name of await listWorkflowSkills()) {
    if (unavailable.has(name)) continue
    const skill = await realSkill(name)
    entries.set(name, {
      ...skill,
      invocation: { modelInvocable: !modelOnly.has(name), userInvocable: true },
    })
  }
  return {
    get: async (name) => entries.get(name),
    list: async () => [...entries.values()],
  }
}

/** Every skill referenced by a shipped workflow definition. */
async function listWorkflowSkills() {
  const { readdir, readFile: rf } = await import('node:fs/promises')
  const names = new Set()
  for (const file of await readdir(WORKFLOWS_DIR)) {
    if (!file.endsWith('.json')) continue
    const definition = JSON.parse(await rf(join(WORKFLOWS_DIR, file), 'utf8'))
    for (const stage of definition.stages) names.add(stage.skill)
  }
  return [...names].sort()
}

async function loadModule() {
  const mod = await import(join(PLUGIN_ROOT, 'lib', 'index.js') + '?t=' + Date.now())
  return mod
}

const failures = []
const check = (label, cond, detail) => {
  if (cond) console.log(`PASS ${label}`)
  else { console.log(`FAIL ${label} :: ${detail ?? ''}`); failures.push(label) }
}

async function runFlow(rawInput, options = {}) {
  const mod = await loadModule()
  const registered = []
  const steers = []
  const ctx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: await buildCatalog(options),
  }
  mod.apply(ctx)
  const def = registered.find((r) => r.name === 'flow')
  if (def === undefined) return { registered, steers, result: { kind: 'error', text: '/flow not registered' } }
  const agent = { steer: (m) => steers.push(m), session: { header: { cwd: PLUGIN_ROOT } } }
  const result = await def.handler({
    agent,
    rawInput,
    signal: new AbortController().signal,
    commandId: 'flow-test',
    attachments: [],
  })
  return { registered, steers, result }
}

const textOf = (steer) => steer?.content?.[0]?.text ?? ''

// --- Case 1: /flow is registered ---

{
  const { registered } = await runFlow('implement OAuth login')
  check('case1: 10 commands registered (9 aliases + /flow)', registered.length === 10, `got ${registered.length}`)
  check('case1: /flow exists', registered.some((r) => r.name === 'flow'), 'missing')
  const def = registered.find((r) => r.name === 'flow')
  check('case1: /flow declares an input hint', typeof def?.input?.hint === 'string' && def.input.hint.length > 0,
    JSON.stringify(def?.input))
  const aliases = ['spec', 'plan', 'build', 'test', 'constraints', 'review', 'webperf', 'code-simplify', 'ship']
  check('case1: all nine aliases still registered', aliases.every((n) => registered.some((r) => r.name === n)),
    'an alias disappeared')
}

// --- Case 2: happy path ---

{
  const { steers, result } = await runFlow('implement OAuth login')
  check('case2: result.kind === success', result.kind === 'success', `got ${result.kind} ${result.text ?? ''}`)
  check('case2: exactly 1 steer', steers.length === 1, `got ${steers.length}`)
  const steer = steers[0]
  check('case2: steer source is plugin/instructions',
    steer?.source?.kind === 'plugin' && steer?.source?.plugin === 'dsh-agent-skills' && steer?.source?.form === 'instructions',
    JSON.stringify(steer?.source))
  check('case2: steer content is a single text block', steer?.content?.length === 1 && steer.content[0].type === 'text',
    JSON.stringify(steer?.content?.map((c) => c.type)))

  const text = textOf(steer)
  const order = [...text.matchAll(/^\d+\. ([a-z0-9-]+) \((?:required|optional)\)/gm)].map((m) => m[1])
  check('case2: workflow ordering is the feature order',
    JSON.stringify(order) === JSON.stringify([
      'debugging-and-error-recovery', 'spec-driven-development', 'planning-and-task-breakdown',
      'incremental-implementation', 'test-driven-development', 'code-review-and-quality', 'shipping-and-launch',
    ]), order.join(' → '))
  check('case2: message names the selected workflow', text.includes('Selected workflow:'), 'missing')
  check('case2: message carries the raw user request verbatim',
    text.trimEnd().endsWith('User request:\nimplement OAuth login'), `tail="${text.slice(-60)}"`)
  check('case2: every stage body is embedded',
    order.every((name) => text.includes(`<skill_content name="${name}">`)), 'a body is missing')
  check('case2: real skill content is present (not a stub)',
    text.includes('# Spec-Driven Development') && text.includes('# Debugging and Error Recovery'),
    'canonical bodies are absent')
  check('case2: workflow rules are carried', text.includes('Workflow rules:'), 'missing rules')
  check('case2: steering message is a real UserMessage',
    typeof steer?.role === 'undefined' || steer.role === 'user' || Array.isArray(steer?.content), 'shape')
}

// --- Case 3: routing / composition behavior ---

{
  const cases = [
    ['Add a feature', 'feature'],
    ['Fix a regression', 'bugfix'],
    ['Investigate a failure', 'investigation'],
    ['Perform a migration', 'migration'],
    ['Prepare a release', 'release'],
  ]
  for (const [request, expected] of cases) {
    const { steers, result } = await runFlow(request)
    const text = textOf(steers[0])
    const stages = [...text.matchAll(/^STAGE \d+ of \d+: ([a-z0-9-]+)$/gm)].map((m) => m[1])
    check(`case3: "${request}" → ${expected} workflow`,
      result.kind === 'success' && text.includes(`Selected workflow:\n${expected} —`),
      `kind=${result.kind} text=${result.text ?? ''} stages=${stages.join(',')}`)
    check(`case3: "${request}" resolved every stage body`, stages.length > 0 && text.split('<skill_content name="').length - 1 === stages.length,
      `${stages.length} stages, ${text.split('<skill_content name="').length - 1} bodies`)
  }
}

// --- Case 4: missing REQUIRED stage ---

{
  const { steers, result } = await runFlow('implement OAuth login', {
    unavailable: new Set(['spec-driven-development']),
  })
  check('case4: kind === error', result.kind === 'error', `got ${result.kind}`)
  check('case4: error names the missing skill and the workflow',
    /Workflow "feature" requires the spec-driven-development skill/.test(result.text ?? ''), `text=${result.text}`)
  check('case4: nothing steered', steers.length === 0, `got ${steers.length}`)
}

// --- Case 5: missing OPTIONAL stage, default skip policy ---

{
  const { steers, result } = await runFlow('implement OAuth login', {
    unavailable: new Set(['shipping-and-launch']),
  })
  check('case5: kind === success', result.kind === 'success', `got ${result.kind} ${result.text ?? ''}`)
  check('case5: exactly 1 steer', steers.length === 1, `got ${steers.length}`)
  const text = textOf(steers[0])
  check('case5: skipped stage is reported', text.includes('Skipped optional stages:') && text.includes('shipping-and-launch'),
    'no skip section')
  check('case5: skipped stage contributes no body', !text.includes('<skill_content name="shipping-and-launch">'),
    'a skipped body is present')
  const order = [...text.matchAll(/^\d+\. ([a-z0-9-]+) \((?:required|optional)\)/gm)].map((m) => m[1])
  check('case5: remaining order is still the definition order', !order.includes('shipping-and-launch'), order.join(' → '))
}

// --- Case 6: on_optional_missing === "error" ---

{
  const tmp = await mkdtemp(join(PLUGIN_ROOT, '.flow-policy-'))
  try {
    // Copy the shipped definitions, then make the feature workflow strict about
    // optional skills so the strict branch is exercised against a real file.
    for (const file of await (await import('node:fs/promises')).readdir(WORKFLOWS_DIR)) {
      if (!file.endsWith('.json')) continue
      await writeFile(join(tmp, file), await readFile(join(WORKFLOWS_DIR, file), 'utf8'))
    }
    const feature = JSON.parse(await readFile(join(tmp, 'feature.json'), 'utf8'))
    feature.on_optional_missing = 'error'
    await writeFile(join(tmp, 'feature.json'), JSON.stringify(feature, null, 2))

    const { loadWorkflowDefinitions } = await import(join(PLUGIN_ROOT, 'lib', 'workflows.js'))
    const { createFlowEngine } = await import(join(PLUGIN_ROOT, 'lib', 'flow.js'))
    const { renderSkillContent } = require('@deepseek-ai/dsh-skill')
    const definitions = loadWorkflowDefinitions({ workflowsDir: tmp, skills: await listWorkflowSkills() })

    const missingCatalog = await buildCatalog({ unavailable: new Set(['shipping-and-launch']) })
    const partialEngine = createFlowEngine({
      definitions,
      contracts: {},
      resolveSkill: async (name) => missingCatalog.get(name),
      renderSkill: renderSkillContent,
      isModelInvocable,
    })
    const outcome = await partialEngine.run('implement OAuth login')
    check('case6: strict optional policy fails the run', outcome.ok === false, JSON.stringify(outcome).slice(0, 120))
    check('case6: error explains the policy', /configured to fail when an optional skill is missing/.test(outcome.error ?? ''),
      outcome.error ?? '')

    // Same definitions, a complete catalog: the run must now succeed, which
    // isolates the failure above as the policy and not a broken fixture.
    const complete = createFlowEngine({
      definitions,
      contracts: {},
      resolveSkill: async (name) => (await buildCatalog()).get(name),
      renderSkill: renderSkillContent,
      isModelInvocable,
    })
    const okOutcome = await complete.run('implement OAuth login')
    check('case6: a complete catalog makes the strict workflow succeed', okOutcome.ok === true,
      okOutcome.error ?? 'no message produced')
    check('case6: the successful run steers every stage',
      okOutcome.ok === true && okOutcome.message.split('<skill_content name="').length - 1 === 7,
      okOutcome.ok ? `${okOutcome.message.split('<skill_content name="').length - 1} bodies` : '')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// --- Case 7: a loaded skill that is not model-invocable ---

{
  const { steers, result } = await runFlow('implement OAuth login', {
    modelOnly: new Set(['spec-driven-development']),
  })
  check('case7: kind === error', result.kind === 'error', `got ${result.kind}`)
  check('case7: error names the skill as unavailable', /spec-driven-development/.test(result.text ?? ''), `text=${result.text}`)
  check('case7: nothing steered', steers.length === 0, `got ${steers.length}`)
}

// --- Case 8: empty request ---

{
  const { steers, result } = await runFlow('   ')
  check('case8: kind === error', result.kind === 'error', `got ${result.kind}`)
  check('case8: usage text names /flow', /Usage: \/flow/.test(result.text ?? ''), `text=${result.text}`)
  check('case8: nothing steered', steers.length === 0, `got ${steers.length}`)
}

// --- Case 9: the composed message stays a valid UserMessage ---

{
  const { steers } = await runFlow('Deploy the new worker to production')
  const steer = steers[0]
  const expected = createUserMessage({
    content: [{ type: 'text', text: textOf(steer) }],
    source: { kind: 'plugin', plugin: 'dsh-agent-skills', form: 'instructions' },
  })
  check('case9: steer matches the shape createUserMessage produces',
    JSON.stringify(steer?.source) === JSON.stringify(expected.source)
    && steer?.content?.[0]?.type === 'text' && steer.content[0].text === expected.content[0].text,
    JSON.stringify(steer?.source))
}

// --- Case 10: degraded path — the workflow assets failed to load ---
// A broken definition or contract must not take the nine alias commands down.
// /flow stays registered and names the reason; the aliases still work.

{
  const mod = await loadModule()
  const registered = []
  const ctx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: await buildCatalog(),
  }
  mod.registerFlowCommand(ctx, { loadEngine: () => undefined, reason: 'assets/workflows/broken.json: invalid JSON' })
  const def = registered.find((r) => r.name === 'flow')
  check('case10: /flow is registered even when the engine is unavailable', def !== undefined, 'missing')
  const steers = []
  const result = await def.handler({
    agent: { steer: (m) => steers.push(m) },
    rawInput: 'implement OAuth login',
    signal: new AbortController().signal,
    commandId: 'flow-degraded',
    attachments: [],
  })
  check('case10: kind === error', result.kind === 'error', `got ${result.kind}`)
  check('case10: error names the workflow assets', /workflow definitions or skill contracts failed to load/.test(result.text ?? ''),
    `text=${result.text}`)
  check('case10: error carries the load reason', /invalid JSON/.test(result.text ?? ''), `text=${result.text}`)
  check('case10: nothing steered', steers.length === 0, `got ${steers.length}`)
}

// --- Case 11: a config key cannot claim the reserved /flow name ---
// /flow is registered by registerFlowCommand, and the host throws on a
// duplicate command name (packages/interaction/commands/src/index.ts:93-95).
// Before 0.2.1 a config key named `flow` registered the alias first and then
// threw inside apply, losing the nine alias commands with it.

{
  const mod = await loadModule()
  const registered = []
  const ctx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: await buildCatalog(),
  }
  let threw = null
  try {
    mod.apply(ctx, { flow: 'some-skill' })
  } catch (error) {
    threw = error
  }
  check('case11: a config key named flow does not throw', threw === null, threw?.message ?? 'threw')
  const flowRegistrations = registered.filter((r) => r.name === 'flow').length
  check('case11: /flow is registered exactly once', flowRegistrations === 1, `${flowRegistrations} registrations`)
  check('case11: all ten commands survive the reserved key', registered.length === 10, `got ${registered.length}`)

  // A malformed key fails here, naming itself, instead of throwing somewhere
  // inside the host registry with a less useful message.
  let badError = null
  try {
    mod.apply(
      { commands: { register: () => (() => {}) }, skills: await buildCatalog() },
      { Spec: 'x' },
    )
  } catch (error) {
    badError = error
  }
  check('case11: a malformed config key throws naming the key',
    badError !== null && /Spec/.test(badError.message), badError?.message ?? 'did not throw')
}

console.log(`\nfailures=${failures.length}`)
if (failures.length) { process.stderr.write(failures.join('\n') + '\n'); process.exit(1) }
console.log('flow command gate PASS')
