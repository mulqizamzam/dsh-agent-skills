// Workflow composer gate for dsh-agent-skills.
//
// The composer decides what the agent actually reads. Two properties matter and
// both are falsifiable:
//
//   1. The skill bodies arrive VERBATIM. If the composer ever rewrites,
//      summarizes, or reorders a skill, this gate fails.
//   2. The workflow structure is visible: order, which stages are required, what
//      was skipped, and the raw user request, preserved exactly.
//
// The composer is pure, so no host and no filesystem are involved here.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { loadWorkflowDefinitions } = await import(join(PLUGIN_ROOT, 'lib', 'workflows.js'))
const { listSkillNames } = await import(join(PLUGIN_ROOT, 'lib', 'skill-catalog.js'))
const { loadSkillContracts } = await import(join(PLUGIN_ROOT, 'lib', 'skill-contracts.js'))
const { composeWorkflowMessage } = await import(join(PLUGIN_ROOT, 'lib', 'flow-compose.js'))
const { selectWorkflow } = await import(join(PLUGIN_ROOT, 'lib', 'flow-select.js'))

let failures = 0
const fail = (msg) => { failures += 1; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

const DEFINITIONS = loadWorkflowDefinitions({ root: PLUGIN_ROOT, skills: listSkillNames() })
const CONTRACTS = loadSkillContracts({ root: PLUGIN_ROOT }).skills

// A stand-in for the host's renderSkillContent: deterministic and obviously
// ASCII-visible, so a rewritten body is impossible to miss.
const renderSkill = (skill) => `<skill_content name="${skill.name}">\n<skill_instructions>\nBODY OF ${skill.name}\n</skill_instructions>\n</skill_content>`

function buildPlan(request, { missing = new Set() } = {}) {
  const selection = selectWorkflow(DEFINITIONS.values(), request)
  const workflow = selection.workflow
  const stages = []
  const skipped = []
  for (const stage of workflow.stages) {
    const skill = { name: stage.skill }
    if (!missing.has(stage.skill)) stages.push({ ...stage, rendered: renderSkill(skill) })
    else skipped.push(stage)
  }
  return { request, workflow, stages, skipped, selection }
}

const REQUEST = 'implement OAuth login'
const plan = buildPlan(REQUEST)
const message = composeWorkflowMessage(plan, { contracts: CONTRACTS })

// --- 1. Header ---

for (const needle of ['WORKFLOW', 'Goal:', 'Selected workflow:', 'Execution order:', 'Workflow rules:', 'Definition of done']) {
  if (message.includes(needle)) pass(`header carries "${needle}"`)
  else fail(`header is missing "${needle}"`)
}
if (message.includes('feature — Standard workflow')) pass('header names the selected workflow and its description')
else fail('header does not name the selected workflow')

// --- 2. Ordering ---

{
  const order = workflowOrder(message)
  const expected = plan.stages.map((s) => s.skill)
  if (JSON.stringify(order) === JSON.stringify(expected)) {
    pass(`execution order matches the definition (${expected.join(' → ')})`)
  } else {
    fail(`execution order ${order.join(' → ')} != definition ${expected.join(' → ')}`)
  }

  const stageHeaders = [...message.matchAll(/^STAGE (\d+) of (\d+): (.+)$/gm)]
  if (stageHeaders.length === plan.stages.length) {
    pass(`message carries one stage block per selected skill (${stageHeaders.length})`)
  } else {
    fail(`expected ${plan.stages.length} stage blocks, found ${stageHeaders.length}`)
  }
  const inOrder = stageHeaders.every((m, i) => Number(m[1]) === i + 1 && m[3] === plan.stages[i].skill)
  if (inOrder) pass('stage blocks are numbered 1..N in definition order')
  else fail('stage blocks are misnumbered or out of order')

  // Stage bodies must appear in the same order they are declared.
  const positions = plan.stages.map((s) => message.indexOf(`BODY OF ${s.skill}`))
  if (positions.every((p) => p > -1) && positions.every((p, i) => i === 0 || p > positions[i - 1])) {
    pass('skill bodies appear in workflow order')
  } else {
    fail(`skill bodies are out of order: ${positions.join(', ')}`)
  }
}

// --- 3. Skill content is verbatim ---

{
  let verbatim = true
  for (const stage of plan.stages) {
    if (!message.includes(stage.rendered)) verbatim = false
  }
  if (verbatim) pass('every stage body is embedded verbatim (no rewriting, no summarizing)')
  else fail('a stage body was altered by the composer')

  const wrapperCount = [...message.matchAll(/<skill_content name="/g)].length
  if (wrapperCount === plan.stages.length) {
    pass(`exactly ${wrapperCount} <skill_content> wrappers — no duplicated or hand-built bodies`)
  } else {
    fail(`expected ${plan.stages.length} wrappers, found ${wrapperCount}`)
  }

  // The composer must not re-emit frontmatter it was never given. The one `---`
  // line it does add is a horizontal rule between header and stages, not a
  // fence, so the assertion targets the frontmatter shape specifically.
  if (!message.includes('---\nname:') && !message.includes('upstream-sha:') && !message.includes('upstream-path:')) {
    pass('composer adds no frontmatter of its own (only the single horizontal rule)')
  } else {
    fail('composer emitted something that looks like frontmatter')
  }
}

// --- 4. Required vs optional, and the raw request ---

{
  if (message.includes('2. spec-driven-development (required)')) pass('required stages are marked required')
  else fail('required marking missing for spec-driven-development')
  if (message.includes('7. shipping-and-launch (optional)')) pass('optional stages are marked optional')
  else fail('optional marking missing for shipping-and-launch')
  if (!message.includes('Skipped optional stages')) pass('no skipped section when every stage resolved')
  else fail('skipped section present although nothing was skipped')

  const tail = message.trimEnd()
  if (tail.endsWith(`User request:\n${REQUEST}`)) pass('raw user request is preserved verbatim at the end')
  else fail(`message does not end with the raw request; tail="${tail.slice(-80)}"`)
  if (message.startsWith('WORKFLOW\n========')) pass('message begins with the workflow banner')
  else fail('message does not begin with the workflow banner')
}

// --- 5. Contract annotations ---

{
  if (message.includes('Artifacts: produces specification; consumes user-request.')) {
    pass('stage annotations come from the skill contracts')
  } else {
    fail('contract annotations missing for spec-driven-development')
  }
  if (message.includes('Risk level: high')) {
    pass('high-risk stages are called out (deprecation-migration / shipping)')
  } else {
    fail('no high-risk annotation although a high-risk stage is present')
  }
}

// --- 6. Optional stages that could not resolve ---

{
  const missing = new Set(['debugging-and-error-recovery', 'shipping-and-launch'])
  const partialPlan = buildPlan(REQUEST, { missing })
  const partialMessage = composeWorkflowMessage(partialPlan, { contracts: CONTRACTS })

  if (partialMessage.includes('Skipped optional stages:')) pass('skipped optional stages are listed')
  else fail('skipped optional stages are not listed')
  if (partialMessage.includes('debugging-and-error-recovery') && partialMessage.includes('shipping-and-launch')) {
    pass('the skipped section names each missing optional skill')
  } else {
    fail('the skipped section does not name the missing skills')
  }
  if (partialMessage.includes('Do not claim their output')) {
    pass('the skipped section forbids claiming the skipped output')
  } else {
    fail('the skipped section does not forbid claiming the skipped output')
  }
  if (partialMessage.includes(`BODY OF ${[...missing][0]}`)) {
    fail('a skipped stage body was still embedded')
  } else {
    pass('skipped stages contribute no body')
  }
}

// --- 7. Other workflows still compose ---

for (const request of ['Fix a regression', 'Investigate a failure', 'Perform a migration', 'Prepare a release']) {
  const otherPlan = buildPlan(request)
  const otherMessage = composeWorkflowMessage(otherPlan, { contracts: CONTRACTS })
  if (otherMessage.includes('WORKFLOW') && otherMessage.includes(otherPlan.workflow.name)) {
    pass(`"/flow ${request}" composes the ${otherPlan.workflow.name} workflow (${otherPlan.stages.length} stages)`)
  } else {
    fail(`"/flow ${request}" did not compose a usable message`)
  }
}

function workflowOrder(text) {
  const block = text.slice(text.indexOf('Execution order:'), text.indexOf('Workflow rules:'))
  return [...block.matchAll(/^\d+\. ([a-z0-9-]+)/gm)].map((m) => m[1])
}

process.stdout.write(`\nflow-compose failures=${failures}\n`)
if (failures > 0) process.exit(1)
process.stdout.write('workflow composer gate PASS\n')
