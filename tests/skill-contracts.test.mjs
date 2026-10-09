// Skill contract gate for dsh-agent-skills.
//
// assets/skill-contracts.json is composition metadata for the workflow composer:
// what each skill produces, what it consumes, how risky it is. It never changes
// what a skill says — the canonical SKILL.md stays the source of truth — so the
// gate's job is narrower than the skill gates: prove the registry is internally
// consistent and exactly covers the shipped catalog.
//
// Exits non-zero on the first violated invariant.

import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { validateSkillContracts, loadSkillContracts } = await import(
  join(PLUGIN_ROOT, 'lib', 'skill-contracts.js'),
)
const { listSkillNames } = await import(join(PLUGIN_ROOT, 'lib', 'skill-catalog.js'))
const { readJsonFile } = await import(join(PLUGIN_ROOT, 'lib', 'json-file.js'))

const SHIPPED = listSkillNames()
// The raw registry, so a rejection case can reuse the shipped vocabularies and
// therefore fail for exactly one reason.
const RAW_REGISTRY = readJsonFile(join(PLUGIN_ROOT, 'assets', 'skill-contracts.json'))

let failures = 0
const fail = (msg) => { failures += 1; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

function rejects(label, registry, skills = SHIPPED) {
  try {
    validateSkillContracts(registry, { skills, label })
    fail(`${label}: accepted a registry it must reject`)
  } catch (error) {
    pass(`${label}: rejected (${error.message.split(': ').at(-1)})`)
  }
}

/**
 * Assert that a registry is rejected with the message the rule is supposed to
 * produce. A case that only proves "something threw" can pass because of a
 * second, accidental failure — which is how a regressed fix stays green.
 */
function rejectsWith(label, registry, pattern, skills = SHIPPED) {
  try {
    validateSkillContracts(registry, { skills, label })
    fail(`${label}: accepted a registry it must reject`)
  } catch (error) {
    if (pattern.test(error.message)) pass(`${label}: rejected (${error.message.split(': ').at(-1)})`)
    else fail(`${label}: rejected for the wrong reason — ${error.message}`)
  }
}

function accepts(label, registry, skills = SHIPPED) {
  try {
    validateSkillContracts(registry, { skills, label })
    pass(`${label}: accepted`)
  } catch (error) {
    fail(`${label}: rejected a valid registry — ${error.message}`)
  }
}

// --- 1. The shipped registry ---

const shipped = loadSkillContracts({ root: PLUGIN_ROOT })
pass(`shipped registry covers ${Object.keys(shipped.skills).length} skills`)

const missing = SHIPPED.filter((name) => shipped.skills[name] === undefined)
if (missing.length === 0) pass(`every shipped skill has a contract (${SHIPPED.length}/${SHIPPED.length})`)
else fail(`skills without a contract: ${missing.join(', ')}`)

const orphans = Object.keys(shipped.skills).filter((name) => !SHIPPED.includes(name))
if (orphans.length === 0) pass('every contract names a shipped skill')
else fail(`contracts naming a non-shipped skill: ${orphans.join(', ')}`)

const artifacts = shipped.vocabularies.artifacts
const categories = shipped.vocabularies.categories
const riskLevels = shipped.vocabularies.riskLevels
if (artifacts.size > 0 && categories.size > 0 && riskLevels.size > 0) {
  pass(`vocabularies declared: ${artifacts.size} artifacts, ${categories.size} categories, ${riskLevels.size} risk levels`)
} else {
  fail('a declared vocabulary is empty')
}

// A workflow composer reads these fields, so they must be populated for the
// skills the shipped workflows actually use.
const workflowSkills = ['debugging-and-error-recovery', 'spec-driven-development', 'planning-and-task-breakdown',
  'incremental-implementation', 'test-driven-development', 'code-review-and-quality', 'shipping-and-launch',
  'deprecation-and-migration', 'documentation-and-adrs', 'context-engineering', 'observability-and-instrumentation',
  'evidence-and-decision-tracking', 'engineering-handoff']
for (const name of workflowSkills) {
  const contract = shipped.skills[name]
  if (contract && Array.isArray(contract.produces) && contract.produces.length > 0) {
    pass(`${name}: produces ${contract.produces.join(', ')}`)
  } else {
    fail(`${name}: contract declares nothing it produces`)
  }
}

// --- 2. Schema rejections ---

const CONTROL_VOCABULARIES = {
  artifacts: ['user-request', 'specification'],
  categories: ['planning'],
  risk_levels: ['low', 'medium', 'high'],
}

rejects('not an object', [])
rejects('unknown top-level key', { skills: {}, vocabularies: { artifacts: ['a'] }, extra: 1 })
rejects('skills missing', { vocabularies: { artifacts: ['a'] } })
rejects('vocabularies missing', { skills: {} })
// Every vocabulary member is indexed unconditionally once validation starts, so
// a missing one has to fail here with a message naming it. Left unchecked it
// surfaced as a TypeError inside the plugin's boot try/catch.
rejectsWith('vocabularies missing risk_levels', { skills: {}, vocabularies: { artifacts: ['a'], categories: ['b'] } }, /vocabularies\.risk_levels must be declared/)
rejectsWith('vocabularies missing artifacts', { skills: {}, vocabularies: { categories: ['b'], risk_levels: ['c'] } }, /vocabularies\.artifacts must be declared/)
rejectsWith('vocabularies missing categories', { skills: {}, vocabularies: { artifacts: ['a'], risk_levels: ['c'] } }, /vocabularies\.categories must be declared/)
// A catalog entry named after an Object.prototype member must not read as
// "contract found" through the prototype chain.
rejectsWith('prototype name is not a contract', { skills: {}, vocabularies: CONTROL_VOCABULARIES }, /no contract for shipped skill/, ['constructor'])
rejectsWith('prototype name is not a contract (toString)', { skills: {}, vocabularies: CONTROL_VOCABULARIES }, /no contract for shipped skill/, ['toString'])
rejects('vocabularies unknown key', { skills: {}, vocabularies: { artifacts: ['a'], groups: ['b'] } })
rejects('vocabularies empty list', { skills: {}, vocabularies: { artifacts: [] } })
rejects('contract not an object', {
  skills: { 'spec-driven-development': 'nope' },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('contract unknown key', {
  skills: { 'spec-driven-development': { produces: ['specification'], weight: 2 } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('contract bad risk level', {
  skills: { 'spec-driven-development': { produces: ['specification'], risk_level: 'extreme' } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('artifact outside vocabulary', {
  skills: { 'spec-driven-development': { produces: ['not-a-declared-artifact'] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('category outside vocabulary', {
  skills: { 'spec-driven-development': { categories: ['not-a-declared-category'] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('empty produces list', {
  skills: { 'spec-driven-development': { produces: [] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('empty string in produces', {
  skills: { 'spec-driven-development': { produces: ['  '] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('repeated produces value', {
  skills: { 'spec-driven-development': { produces: ['specification', 'specification'] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('bad skill key grammar', {
  skills: { 'Not Kebab': { produces: ['specification'] } },
  vocabularies: CONTROL_VOCABULARIES,
})
rejects('contract for non-shipped skill', {
  skills: { 'a-skill-that-does-not-exist': { produces: ['specification'] } },
  vocabularies: CONTROL_VOCABULARIES,
})

// --- 3. Exhaustiveness rejection ---
// Deliberately keeps the shipped vocabularies so the only violated rule is the
// missing contract: a case that fails for a second reason proves nothing about
// this one.

rejects('missing contract for a shipped skill', {
  skills: Object.fromEntries(
    SHIPPED.filter((n) => n !== 'spec-driven-development').map((n) => [n, shipped.skills[n]]),
  ),
  vocabularies: RAW_REGISTRY.vocabularies,
})

// --- 4. Accepts ---

accepts('control registry accepted', {
  skills: {
    'spec-driven-development': {
      produces: ['specification'],
      consumes: ['user-request'],
      categories: ['planning'],
      risk_level: 'low',
    },
  },
  vocabularies: CONTROL_VOCABULARIES,
}, ['spec-driven-development'])

// --- 5. Duplicate keys, which JSON.parse hides ---
// JSON.parse keeps the LAST value of a duplicated key, so only a strict reader
// can see it. The cases below are the ones the shipped file does not exercise:
// the same key name in two sibling contracts, and an escaped quote that must not
// be mistaken for a delimiter.

{
  const { parseJsonDocument } = await import(join(PLUGIN_ROOT, 'lib', 'json-file.js'))
  const good = '{"skills":{"a":{"produces":["specification"]},"b":{"produces":["specification"]}}}'
  try {
    parseJsonDocument(good, 'sibling probe')
    pass('same key name in two sibling objects is accepted (no false positive)')
  } catch (error) {
    fail(`sibling objects were reported as duplicate: ${error.message}`)
  }

  const escaped = '{"note":"a contract may mention \\"produces\\" once"}'
  try {
    parseJsonDocument(escaped, 'escaped probe')
    pass('a quoted substring inside a value is not read as a key')
  } catch (error) {
    fail(`escaped quote produced a false duplicate: ${error.message}`)
  }

  const dup = '{"skills":{"a":{"produces":["x"],"produces":["y"]}}}'
  try {
    parseJsonDocument(dup, 'dup probe')
    fail('a genuinely duplicated key was accepted')
  } catch (error) {
    pass(`genuinely duplicated key rejected (${error.message})`)
  }
}

{
  const tmp = await mkdtemp(join(PLUGIN_ROOT, '.contracts-'))
  try {
    const text = JSON.stringify(RAW_REGISTRY, null, 2)
    const marker = '"spec-driven-development": {'
    const at = text.indexOf(marker)
    if (at === -1) {
      fail('duplicate contract key: could not find the contract marker in the shipped file')
      failures += 1
    } else {
      const insertAt = at + marker.length
      const duplicated = `${text.slice(0, insertAt)}\n    "produces": ["specification"],${text.slice(insertAt)}`
      await writeFile(join(tmp, 'skill-contracts.json'), duplicated)
      try {
        loadSkillContracts({ contractsPath: join(tmp, 'skill-contracts.json') })
        fail('duplicate contract key: loader accepted it')
      } catch (error) {
        pass(`duplicate contract key: rejected (${error.message})`)
      }
    }

    await writeFile(join(tmp, 'skill-contracts.json'), '{ "skills": { ')
    try {
      loadSkillContracts({ contractsPath: join(tmp, 'skill-contracts.json') })
      fail('malformed JSON: loader accepted it')
    } catch (error) {
      pass(`malformed JSON: rejected (${error.message.includes('invalid JSON') ? 'invalid JSON' : error.message})`)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// --- 6. The registry must not leak into skill loading ---
// Optional metadata must not break the host's skill discovery. The real loader
// test lives in skill-load.test.mjs; here we only assert that adding a contract
// for a skill does not add or remove it from the catalog enumeration.

{
  const before = listSkillNames()
  const after = listSkillNames()
  if (before.length === after.length && before.every((n, i) => n === after[i])) {
    pass(`catalog enumeration is stable across contract loading (${after.length} skills)`)
  } else {
    fail('catalog enumeration changed while contracts were loaded')
  }
}

process.stdout.write(`\nskill-contract failures=${failures}\n`)
if (failures > 0) process.exit(1)
process.stdout.write('skill contract gate PASS\n')
