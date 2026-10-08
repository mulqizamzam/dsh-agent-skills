// End-to-end handler test: exercises the ACTUAL apply(ctx) function with a
// mock ctx + mock agent, crossing the real serialization boundary (host
// lib index.js functions: renderSkillContent, isUserInvocable,
// createUserMessage).
//
// Three cases:
//   1. happy path   -> success + steering message with body + raw input
//   2. skill absent -> error
//   3. skill not user-invocable -> error

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require2 = createRequire(join(PLUGIN_ROOT, 'noop.js'))

const SKILL_PATH = join(PLUGIN_ROOT, 'assets', 'skills', 'spec-driven-development', 'SKILL.md')
const skillText = await readFile(SKILL_PATH, 'utf8')
const skillBody = skillText.replace(/^---[\s\S]*?\n---\n?/, '')

const userSkillDef = {
  name: 'spec-driven-development',
  description: 'spec test',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'agent-skills',
  provider: 'agent-skills',
  content: skillBody,
  path: SKILL_PATH,
}
const modelOnlySkillDef = {
  ...userSkillDef,
  invocation: { modelInvocable: true, userInvocable: false },
}

const failures = []
const check = (label, cond, detail) => {
  if (cond) { console.log(`PASS ${label}`) }
  else { console.log(`FAIL ${label} :: ${detail ?? ''}`); failures.push(label) }
}

// --- Case 1: happy path ---
{
  const steered = []
  const registered = []
  const fakeCtx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: { get: async (name) => (name === 'spec-driven-development' ? userSkillDef : undefined) },
  }
  const mod = await import(join(PLUGIN_ROOT, 'lib', 'index.js'))
  mod.apply(fakeCtx)
  check('case1: 9 commands registered', registered.length === 9, `got ${registered.length}`)
  check('case1: /spec exists', registered.some(r => r.name === 'spec'), 'missing')

  const fakeAgent = { steer: (m) => steered.push(m) }
  const res = await registered.find(r => r.name === 'spec').handler({
    agent: fakeAgent, rawInput: '  build a login flow  ',
    signal: new AbortController().signal, commandId: 'c1', attachments: [],
  })
  check('case1: result.kind === success', res.kind === 'success', `got ${res.kind} ${res.text ?? ''}`)
  check('case1: exactly 1 steer', steered.length === 1, `got ${steered.length}`)
  const t = steered[0]?.content?.[0]?.text ?? ''
  check('case1: wrapped in <skill_content>', t.includes('<skill_content'), 'missing wrapper')
  check('case1: skill body present', t.includes('Spec-Driven Development'), 'missing body')
  check('case1: raw input trimmed + appended', t.includes('User request: build a login flow'), `tail=${t.slice(-80)}`)
  check('case1: source is skill-invocation',
    steered[0]?.source?.kind === 'skill-invocation'
    && steered[0]?.source?.name === 'spec-driven-development'
    && steered[0]?.source?.form === 'instructions',
    JSON.stringify(steered[0]?.source))
}

// --- Case 2: skill not in catalog ---
{
  const registered = []
  const fakeCtx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: { get: async () => undefined },
  }
  const mod = await import(join(PLUGIN_ROOT, 'lib', 'index.js'))
  mod.apply(fakeCtx)
  const steered = []
  const res = await registered.find(r => r.name === 'spec').handler({
    agent: { steer: (m) => steered.push(m) }, rawInput: 'x',
    signal: new AbortController().signal, commandId: 'c2', attachments: [],
  })
  check('case2: kind === error', res.kind === 'error', `got ${res.kind}`)
  check('case2: mentions missing skill', /not found in catalog/.test(res.text ?? ''), `text=${res.text}`)
  check('case2: nothing steered', steered.length === 0, `got ${steered.length}`)
}

// --- Case 3: skill exists but not user-invocable ---
{
  const registered = []
  const fakeCtx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: { get: async () => modelOnlySkillDef },
  }
  const mod = await import(join(PLUGIN_ROOT, 'lib', 'index.js'))
  mod.apply(fakeCtx)
  const steered = []
  const res = await registered.find(r => r.name === 'spec').handler({
    agent: { steer: (m) => steered.push(m) }, rawInput: 'x',
    signal: new AbortController().signal, commandId: 'c3', attachments: [],
  })
  check('case3: kind === error', res.kind === 'error', `got ${res.kind}`)
  check('case3: says not user-invocable', /not user-invocable/.test(res.text ?? ''), `text=${res.text}`)
  check('case3: nothing steered', steered.length === 0, `got ${steered.length}`)
}

// --- Case 4: no raw input -> skill body only, no "User request:" tail ---
{
  const steered = []
  const registered = []
  const fakeCtx = {
    commands: { register: (d) => { registered.push(d); return () => {} } },
    skills: { get: async () => userSkillDef },
  }
  const mod = await import(join(PLUGIN_ROOT, 'lib', 'index.js'))
  mod.apply(fakeCtx)
  const res = await registered.find(r => r.name === 'ship').handler({
    agent: { steer: (m) => steered.push(m) }, rawInput: '   ',
    signal: new AbortController().signal, commandId: 'c4', attachments: [],
  })
  const t = steered[0]?.content?.[0]?.text ?? ''
  check('case4: success', res.kind === 'success', `got ${res.kind}`)
  check('case4: no User request tail', !t.includes('User request:'), 'unexpected tail')
  check('case4: body still present', t.includes('<skill_content'), 'missing body')
}

console.log(`\nfailures=${failures.length}`)
if (failures.length) { process.stderr.write(failures.join('\n') + '\n'); process.exit(1) }
console.log('e2e handler gate PASS')
