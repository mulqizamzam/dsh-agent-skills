// Workflow definition gate for dsh-agent-skills.
//
// The /flow command reads its behaviour from assets/workflows/*.json. This gate
// proves the shipped definitions are valid AND that the validator can reject a
// broken one — a validator that has never failed is not evidence, so every
// rejection case below is paired with a control that the same check accepts a
// well-formed definition.
//
// Exits non-zero on the first violated invariant (fail-closed: a warning on
// stderr is invisible to CI that reads exit codes).

import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { validateWorkflowDefinition, loadWorkflowDefinitions } = await import(
  join(PLUGIN_ROOT, 'lib', 'workflows.js'),
)
const { listSkillNames } = await import(join(PLUGIN_ROOT, 'lib', 'skill-catalog.js'))

const SHIPPED = listSkillNames()

let failures = 0
const fail = (msg) => { failures += 1; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

/** Assert that a definition is rejected. */
function rejects(label, definition, context = {}) {
  try {
    validateWorkflowDefinition(definition, { skills: SHIPPED, label, ...context })
    fail(`${label}: accepted a definition it must reject`)
  } catch (error) {
    pass(`${label}: rejected (${error.message.split(': ').at(-1)})`)
  }
}

/** Assert that a definition is accepted. */
function accepts(label, definition, context = {}) {
  try {
    validateWorkflowDefinition(definition, { skills: SHIPPED, label, ...context })
    pass(`${label}: accepted`)
  } catch (error) {
    fail(`${label}: rejected a valid definition — ${error.message}`)
  }
}

const controlDefinition = {
  name: 'control-workflow',
  description: 'A well-formed definition used as the accept case.',
  match: { keywords: ['control'], priority: 1 },
  stages: [
    { skill: 'spec-driven-development', required: true, purpose: 'Pin the target.' },
    { skill: 'planning-and-task-breakdown', required: false },
  ],
  rules: ['Complete each stage.'],
  on_optional_missing: 'skip',
  completion: 'Done when done.',
}

// --- 1. The shipped catalog of definitions ---

{
  const definitions = loadWorkflowDefinitions({ root: PLUGIN_ROOT })
  pass(`shipped definitions loaded: ${[...definitions.keys()].join(', ')}`)
  for (const name of ['feature', 'bugfix', 'investigation', 'migration', 'release']) {
    if (definitions.has(name)) pass(`required workflow "${name}" is defined`)
    else fail(`required workflow "${name}" is missing`)
  }
  for (const definition of definitions.values()) {
    const required = definition.stages.filter((s) => s.required).length
    if (required === 0) fail(`workflow "${definition.name}" has no required stage`)
    else pass(`workflow "${definition.name}" has ${definition.stages.length} stages (${required} required)`)
    if (definition.match.keywords.length === 0) fail(`workflow "${definition.name}" has no keywords`)
  }
}

// --- 2. Structural rejections ---

rejects('not an object', [])
rejects('null definition', null)
rejects('unknown top-level key', { ...controlDefinition, extra: true })
rejects('missing name', { ...controlDefinition, name: undefined })
rejects('bad name grammar', { ...controlDefinition, name: 'Not_Kebab' })
rejects('empty description', { ...controlDefinition, description: '  ' })
rejects('missing description', { ...controlDefinition, description: undefined })
rejects('stages missing', { ...controlDefinition, stages: undefined })
rejects('stages empty', { ...controlDefinition, stages: [] })
rejects('stages not an array', { ...controlDefinition, stages: { skill: 'test-driven-development', required: true } })

rejects('stage not an object', { ...controlDefinition, stages: ['spec-driven-development'] })
rejects('stage unknown key', {
  ...controlDefinition,
  stages: [{ skill: 'spec-driven-development', required: true, order: 1 }],
})
rejects('stage missing required', {
  ...controlDefinition,
  stages: [{ skill: 'spec-driven-development' }],
})
rejects('stage required not boolean', {
  ...controlDefinition,
  stages: [{ skill: 'spec-driven-development', required: 'yes' }],
})
rejects('stage empty purpose', {
  ...controlDefinition,
  stages: [{ skill: 'spec-driven-development', required: true, purpose: '   ' }],
})
rejects('stage bad skill grammar', {
  ...controlDefinition,
  stages: [{ skill: 'Spec Driven Development', required: true }],
})

// --- 3. Duplicate stage definitions ---

rejects('duplicate stage skill', {
  ...controlDefinition,
  stages: [
    { skill: 'spec-driven-development', required: true },
    { skill: 'spec-driven-development', required: false },
  ],
})

// --- 4. Unknown skill reference ---

rejects('unknown skill reference', {
  ...controlDefinition,
  stages: [{ skill: 'a-skill-that-does-not-exist', required: true }],
})

// --- 5. Optional-missing policy ---

rejects('bad on_optional_missing', { ...controlDefinition, on_optional_missing: 'ignore' })
accepts('skip policy accepted', { ...controlDefinition, on_optional_missing: 'skip' })
accepts('error policy accepted', { ...controlDefinition, on_optional_missing: 'error' })

// --- 6. match block ---

rejects('match not an object', { ...controlDefinition, match: ['spec'] })
rejects('match keywords empty', { ...controlDefinition, match: { keywords: [] } })
rejects('match keyword with space', { ...controlDefinition, match: { keywords: ['do the thing'] } })
rejects('match repeated keyword', { ...controlDefinition, match: { keywords: ['a', 'a'] } })
rejects('match unknown key', { ...controlDefinition, match: { keywords: ['a'], weight: 2 } })
rejects('match priority not integer', { ...controlDefinition, match: { keywords: ['a'], priority: 1.5 } })
accepts('control definition accepted', controlDefinition)

// --- 7. Loading from disk, including the malformed cases JSON.parse hides ---

{
  const tmp = await mkdtemp(join(PLUGIN_ROOT, '.workflow-def-'))
  try {
    // 7a. Malformed JSON.
    await writeFile(join(tmp, 'broken.json'), '{ "name": "broken", ')
    try {
      loadWorkflowDefinitions({ workflowsDir: tmp })
      fail('malformed JSON: loader accepted it')
    } catch (error) {
      pass(`malformed JSON: rejected (${error.message.includes('invalid JSON') ? 'invalid JSON' : error.message})`)
    }

    // 7b. Duplicate key — JSON.parse keeps the last one, so only a strict
    //     reader can see it.
    await writeFile(join(tmp, 'broken.json'), JSON.stringify({
      name: 'broken',
      description: 'x',
      stages: [{ skill: 'spec-driven-development', required: true }],
    }, null, 2).replace('"description": "x",', '"description": "x",\n  "description": "y",'))
    try {
      loadWorkflowDefinitions({ workflowsDir: tmp })
      fail('duplicate key: loader accepted it')
    } catch (error) {
      pass(`duplicate key: rejected (${error.message})`)
    }

    // 7c. Name that does not match the file name.
    await writeFile(join(tmp, 'broken.json'), JSON.stringify({
      name: 'some-other-name',
      description: 'x',
      stages: [{ skill: 'spec-driven-development', required: true }],
    }))
    try {
      loadWorkflowDefinitions({ workflowsDir: tmp })
      fail('name/stem mismatch: loader accepted it')
    } catch (error) {
      pass(`name/stem mismatch: rejected (${error.message.split(': ').at(-1)})`)
    }

    // 7d. The same workflow name cannot arrive twice: a definition's name must
    //     equal its file stem, so a second file claiming an existing name is
    //     rejected on the stem rule.
    await rm(join(tmp, 'broken.json'))
    const sameDefinition = {
      name: 'twin',
      description: 'x',
      stages: [{ skill: 'spec-driven-development', required: true }],
    }
    await writeFile(join(tmp, 'twin.json'), JSON.stringify(sameDefinition))
    await writeFile(join(tmp, 'twin-copy.json'), JSON.stringify(sameDefinition))
    try {
      loadWorkflowDefinitions({ workflowsDir: tmp })
      fail('duplicate workflow name: loader accepted it')
    } catch (error) {
      pass(`duplicate workflow name: rejected (${error.message.split(': ').at(-1)})`)
    }
    await rm(join(tmp, 'twin-copy.json'))

    // 7e. An empty directory must fail, not load zero workflows silently.
    const empty = join(tmp, 'empty')
    await mkdir(empty, { recursive: true })
    try {
      loadWorkflowDefinitions({ workflowsDir: empty })
      fail('empty directory: loader accepted it')
    } catch (error) {
      pass(`empty directory: rejected (${error.message.split(': ').at(-1)})`)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// --- 8. The catalog enumeration the validator depends on ---

{
  if (SHIPPED.length > 0) pass(`skill catalog enumerates ${SHIPPED.length} shipped skills`)
  else fail('skill catalog enumeration returned nothing')
  if (SHIPPED.includes('spec-driven-development')) pass('catalog contains spec-driven-development')
  else fail('catalog is missing spec-driven-development')
  if (SHIPPED.includes('evidence-and-decision-tracking')) pass('catalog contains the new evidence skill')
  else fail('catalog is missing evidence-and-decision-tracking')
}

process.stdout.write(`\nworkflow-definition failures=${failures}\n`)
if (failures > 0) process.exit(1)
process.stdout.write('workflow definition gate PASS\n')
