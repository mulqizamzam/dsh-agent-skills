// Behavioral test for dsh-agent-skills command routing.
//
// Verifies that each of the nine registered slash commands:
//   1. Resolves to the correct canonical skill (skill lookup succeeds)
//   2. Calls agent.steer() exactly once with source.kind === 'skill-invocation'
//   3. Returns { kind: 'success' }
//
// This is the last piece needed to prove the commands actually wire to the
// skills, beyond the structural gate which only checks syntax and catalog
// presence. Without it, a command could be registered but pointing to a
// non-existent skill.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const req = createRequire(import.meta.url)
const { renderSkillContent, isUserInvocable } = req('@deepseek-ai/dsh-skill')
const { createUserMessage } = req('@deepseek-ai/dsh-llm')

const PLUGIN_DIR = path.resolve(fileURLToPath(import.meta.url), '../..')
process.chdir(PLUGIN_DIR)

// Command name → canonical skill name (copy from lib/index.js)
const COMMAND_SKILL_MAP = {
  spec: 'spec-driven-development',
  plan: 'planning-and-task-breakdown',
  build: 'incremental-implementation',
  test: 'test-driven-development',
  constraints: 'constraint-driven-development',
  review: 'code-review-and-quality',
  webperf: 'performance-optimization',
  'code-simplify': 'code-simplification',
  ship: 'shipping-and-launch',
}

// Build a minimal catalog that satisfies ctx.skills.get by name.
// Each skill entry must include `invocation.userInvocable: true` or
// isUserInvocable() will throw (packages/skill/skill/lib/index.js:46).
function buildMockCatalog(skillName) {
  const entries = new Map()
  for (const [cmd, can] of Object.entries(COMMAND_SKILL_MAP)) {
    if (can === skillName) {
      entries.set(can, {
        name: can,
        provider: 'agent-skills',
        description: 'mock',
        invocation: { modelInvocable: true, userInvocable: true },
        content: '# Mock skill\n',
      })
    }
  }
  return {
    get: async (name) => entries.get(name),
    list: async () => [...entries.values()],
  }
}

// Load the module fresh per case to avoid state bleed from any prior run.
async function loadModule() {
  const modPath = path.join(PLUGIN_DIR, 'lib', 'index.js')
  const mod = await import(modPath + '?t=' + Date.now())
  return mod
}

let failures = 0

for (const [commandName, skillName] of Object.entries(COMMAND_SKILL_MAP)) {
  const mod = await loadModule()
  const skills = buildMockCatalog(skillName)
  const registered = []
  const steers = []

  const ctx = {
    commands: {
      register(def) {
        registered.push(def)
      },
    },
    skills,
  }

  mod.apply(ctx)

  const def = registered.find(r => r.name === commandName)
  if (!def) {
    console.error(`FAIL ${commandName}: not registered`)
    failures++
    continue
  }

  const mockAgent = {
    steer(msg) {
      steers.push(msg)
    },
  }

  const result = await def.handler({
    agent: mockAgent,
    rawInput: '',
    signal: null,
  })

  if (result.kind !== 'success') {
    console.error(`FAIL ${commandName}: handler returned ${JSON.stringify(result)}`)
    failures++
    continue
  }

  if (steers.length !== 1) {
    console.error(`FAIL ${commandName}: expected 1 steer, got ${steers.length}`)
    failures++
    continue
  }

  const steerMsg = steers[0]
  if (steerMsg.source?.kind !== 'skill-invocation') {
    console.error(`FAIL ${commandName}: steer source.kind != skill-invocation: ${steerMsg.source?.kind}`)
    failures++
    continue
  }

  if (steerMsg.source?.name !== skillName) {
    console.error(`FAIL ${commandName}: steer source.name mismatch: ${steerMsg.source?.name} != ${skillName}`)
    failures++
    continue
  }

  console.log(`PASS ${commandName} -> ${skillName} (steer source=${steerMsg.source.kind}, name=${steerMsg.source.name})`)
}

// --- Command-map exhaustiveness validation ---

// Fail-closed: missing or unparseable autonomous-only.json must FAIL the test
let autonomousMap
try {
  const autoSrc = fs.readFileSync(
    path.join(PLUGIN_DIR, 'assets', 'skills', 'autonomous-only.json'),
    'utf8'
  )
  autonomousMap = JSON.parse(autoSrc)
} catch {
  console.error('FAIL autonomous-only.json: missing or unparseable — structural gate closed')
  failures++
}

// Build helper sets
const commandedSkills = new Set(Object.values(COMMAND_SKILL_MAP))
const allSkillDirs = new Set()
const skillDirEntries = fs.readdirSync(path.join(PLUGIN_DIR, 'assets', 'skills'), {
  withFileTypes: true,
})
for (const entry of skillDirEntries) {
  if (entry.isDirectory()) {
    const skillPath = path.join(PLUGIN_DIR, 'assets', 'skills', entry.name)
    if (fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
      allSkillDirs.add(entry.name)
    }
  }
}

// 1. Every command target in COMMAND_SKILL_MAP exists in assets/skills/
for (const [, canonical] of Object.entries(COMMAND_SKILL_MAP)) {
  if (allSkillDirs.has(canonical)) {
    console.log(`PASS command target "${canonical}" exists in assets/skills/`)
  } else {
    console.error(`FAIL command target "${canonical}" not found in assets/skills/`)
    failures++
  }
}

// 2. Every skill in assets/skills/ is EITHER a COMMAND_SKILL_MAP value
//    OR listed in autonomous-only.json (but NOT both)
// 3. NO skill appears in BOTH autonomous-only.json AND COMMAND_SKILL_MAP
// 4. Every entry in autonomous-only.json exists in assets/skills/
if (autonomousMap && Array.isArray(autonomousMap)) {
  const autonomousSet = new Set(autonomousMap)

  // Check every skill directory: must be in exactly one of the two sets
  for (const skillName of allSkillDirs) {
    const inCommands = commandedSkills.has(skillName)
    const inAutonomous = autonomousSet.has(skillName)

    if (inCommands && inAutonomous) {
      console.error(`FAIL skill "${skillName}" appears in BOTH COMMAND_SKILL_MAP and autonomous-only.json`)
      failures++
    } else if (!inCommands && !inAutonomous) {
      console.error(`FAIL skill "${skillName}" is NOT in COMMAND_SKILL_MAP and NOT in autonomous-only.json`)
      failures++
    } else if (inCommands && !inAutonomous) {
      console.log(`PASS skill "${skillName}" is a command target`)
    } else if (!inCommands && inAutonomous) {
      console.log(`PASS skill "${skillName}" is autonomous-only`)
    }
  }

  // Every entry in autonomous-only.json exists in assets/skills/
  for (const skill of autonomousMap) {
    if (allSkillDirs.has(skill)) {
      console.log(`PASS autonomous-only entry "${skill}" exists in assets/skills/`)
    } else {
      console.error(`FAIL autonomous-only entry "${skill}" not found in assets/skills/`)
      failures++
    }
  }
}

// If autonomous-only.json is missing or unparseable, the above loops are
// skipped (autonomousMap is falsy), and the "command targets exist" check
// (step 1) is the only validation that runs.

// --- Host-side registration validation ---
// Every gate used to be blind here: the host rejects an invalid command
// definition inside normalizeDefinition (packages/interaction/commands/src/
// index.ts:170-200), and that rejection happens at BOOT, not at handler time.
// An empty description would leave the plugin fiber INACTIVE with a silent
// cordis log line — all three gates stayed green. This block mounts the real
// host registry so that path is actually exercised.
{
  // Resolve the host command runtime from the harness checkout directly
  // (same convention as structural.test.mjs importing the host yaml parser):
  // this package is NOT a plugin runtime dependency, only a test fixture, so
  // it deliberately does not add a symlink to node_modules/@deepseek-ai.
  const HARNESS = '/home/administrator/deepseek-harness'
  const cmdMod = await import(path.join(HARNESS, 'packages/interaction/commands/lib/index.js'))
  const { Context } = req('@deepseek-ai/cordis')
  const CommandRuntime = cmdMod.default ?? cmdMod.CommandRuntime

  const ctx = new Context()
  await ctx.plugin(CommandRuntime)

  // 1. The definitions this plugin actually registers must be accepted.
  const mod = await loadModule()
  let thrownOnRealRegistry = null
  const realCtx = {
    commands: { register: (d) => ctx.commands.register(d) },
    skills: buildMockCatalog('spec-driven-development'),
  }
  try { mod.apply(realCtx) } catch (e) { thrownOnRealRegistry = e }
  if (thrownOnRealRegistry === null) {
    console.log('PASS real host registry accepts all 9 shipped command definitions')
  } else {
    console.error(`FAIL real host registry rejected a shipped definition: ${thrownOnRealRegistry.message}`)
    failures++
  }

  // 2. The host must REJECT an empty description — proving the gate above is
  //    not vacuous (a checker that cannot fail is not a checker).
  let rejectedEmpty = null
  try {
    ctx.commands.register({ name: 'probe-empty', description: '', handler: () => ({ kind: 'success' }) })
  } catch (e) { rejectedEmpty = e }
  if (rejectedEmpty !== null) {
    console.log(`PASS real host registry rejects empty description ("${rejectedEmpty.message}")`)
  } else {
    console.error('FAIL real host registry accepted an empty description — validation path unproven')
    failures++
  }

  // 3. The host must REJECT a command name outside its grammar.
  let rejectedName = null
  try {
    ctx.commands.register({ name: 'Bad Name', description: 'x', handler: () => ({ kind: 'success' }) })
  } catch (e) { rejectedName = e }
  if (rejectedName !== null) {
    console.log(`PASS real host registry rejects invalid command name ("${rejectedName.message}")`)
  } else {
    console.error('FAIL real host registry accepted an invalid command name')
    failures++
  }
}

console.log(`\nfailures=${failures}`)
if (failures > 0) process.exit(1)
process.exit(0)
