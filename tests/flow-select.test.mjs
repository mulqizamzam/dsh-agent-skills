// Workflow selector gate for dsh-agent-skills.
//
// Routing is deterministic keyword scoring, so it can be tested exhaustively
// without a model. The table below is the contract: every request a user is
// likely to type must land on the workflow whose README description matches what
// they asked for.
//
// Also proves the selector can FAIL: an empty definition set throws rather than
// returning a default, and a tie must resolve by priority, never by luck.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { loadWorkflowDefinitions } = await import(join(PLUGIN_ROOT, 'lib', 'workflows.js'))
const { listSkillNames } = await import(join(PLUGIN_ROOT, 'lib', 'skill-catalog.js'))
const { selectWorkflow, tokenizeRequest, matchedKeywords, scoreWorkflow, FALLBACK_WORKFLOW } = await import(
  join(PLUGIN_ROOT, 'lib', 'flow-select.js'),
)

let failures = 0
const fail = (msg) => { failures += 1; process.stderr.write(`FAIL ${msg}\n`) }
const pass = (msg) => process.stdout.write(`PASS ${msg}\n`)

const DEFINITIONS = loadWorkflowDefinitions({
  root: PLUGIN_ROOT,
  skills: listSkillNames(),
})

/** request → expected workflow */
const ROUTING_TABLE = [
  // The five representative fixtures the feature brief names.
  ['Add a feature', 'feature'],
  ['Fix a regression', 'bugfix'],
  ['Investigate a failure', 'investigation'],
  ['Perform a migration', 'migration'],
  ['Prepare a release', 'release'],
  // The command examples from the README.
  ['implement OAuth login', 'feature'],
  ['add OAuth login', 'feature'],
  ['migrate the API from v1 to v2', 'migration'],
  ['upgrade the database driver', 'migration'],
  ['investigate why CI started failing', 'investigation'],
  ['prepare this feature for production', 'release'],
  ['fix the broken pagination on the search page', 'bugfix'],
  ['the build is failing after the dependency bump', 'investigation'],
  ['deploy the new worker to production', 'release'],
  ['create a settings page for the account', 'feature'],
  ['we need to implement the billing rework', 'feature'],
  // "go" and "live" were release keywords until 0.2.1. On a 1-1 tie the
  // priority rule let release (70) beat feature (60), so a request to
  // implement something that also said "go over the edge cases" was routed to
  // a workflow with no spec, planning, or implementation stage.
  ['implement dark mode and go over the edge cases', 'feature'],
  ['take the payments feature live', 'feature'],
]

for (const [request, expected] of ROUTING_TABLE) {
  const selection = selectWorkflow(DEFINITIONS.values(), request)
  if (selection.workflow.name === expected) {
    const matched = selection.matched.length > 0 ? `on ${selection.matched.join(', ')}` : 'by fallback'
    pass(`"/flow ${request}" → ${selection.workflow.name} (selected ${matched})`)
  } else {
    fail(`"/flow ${request}" → ${selection.workflow.name}, expected ${expected}`)
  }
}

// --- Conservative default for an ambiguous request ---

for (const request of ['make this better', 'do the thing', 'hmm', 'help']) {
  const selection = selectWorkflow(DEFINITIONS.values(), request)
  if (selection.workflow.name === FALLBACK_WORKFLOW && selection.fallback === true && selection.matched.length === 0) {
    pass(`"/flow ${request}" → ${FALLBACK_WORKFLOW} (conservative default, no keyword matched)`)
  } else {
    fail(`"/flow ${request}" → ${selection.workflow.name} (fallback=${selection.fallback})`)
  }
}

// --- Negative routing: an innocent request must not be hijacked by a
// --- generic keyword. The 0.2.1 defect class ("go" / "live") was closed by
// --- deleting two words with no rule behind the deletion; this table is the
// --- generalizing guard. The words these requests contain were dropped from
// --- the keyword lists for the same reason (measured misroutes: 14 of 17
// --- innocent probes landed on the wrong workflow on a single keyword hit).
// --- Any future keyword that re-routes one of them fails here.

const NEGATIVE_ROUTING_TABLE = [
  // request, workflow the request must NOT select
  ['move the config file to src/', 'migration'],
  ['port 8080 is already in use', 'migration'],
  ['the CSS transition looks janky', 'migration'],
  ['convert this array to a Set', 'migration'],
  ['remove the unused import in utils.js', 'migration'],
  ['does this library support node 20', 'feature'],
  ['the new behaviour is wrong', 'feature'],
  ['resolve the promise before returning', 'bugfix'],
  ['the correct answer is 42', 'bugfix'],
]

for (const [request, forbidden] of NEGATIVE_ROUTING_TABLE) {
  const selection = selectWorkflow(DEFINITIONS.values(), request)
  if (selection.workflow.name !== forbidden) {
    pass(`negative: "/flow ${request}" is not routed to ${forbidden} (chose ${selection.workflow.name})`)
  } else {
    fail(`negative: "/flow ${request}" was hijacked to ${forbidden} — a generic keyword is back in the routing table`)
  }
}

// --- Determinism ---

{
  const request = 'fix the broken pagination'
  const first = selectWorkflow(DEFINITIONS.values(), request)
  const second = selectWorkflow(DEFINITIONS.values(), request)
  if (first.workflow.name === second.workflow.name && first.score === second.score) {
    pass(`routing is deterministic for "${request}" (${first.workflow.name})`)
  } else {
    fail('routing is not deterministic')
  }
}

// --- Tie-break by priority, not by iteration order ---

{
  // "why" is an investigation keyword; "add" is a feature keyword. Both score 1,
  // so investigation must win on priority.
  const selection = selectWorkflow(DEFINITIONS.values(), 'why add this at all')
  if (selection.workflow.name === 'investigation') {
    pass('tie resolves by priority (investigation outranks feature)')
  } else {
    fail(`tie resolved to ${selection.workflow.name}, expected investigation`)
  }
}

// --- Tie-break by name when score AND priority are equal ---
// The shipped definitions carry distinct priorities (100/90/80/70/60), so this
// branch cannot be reached through them and went uncovered: inverting the
// comparison left every gate green. Synthetic definitions make it reachable.

{
  const base = {
    description: 'x',
    match: { keywords: ['zebra'], priority: 5 },
    stages: [],
    rules: [],
    on_optional_missing: 'skip',
  }
  const alpha = { ...base, name: 'alpha' }
  const beta = { ...base, name: 'beta' }
  const forward = selectWorkflow([alpha, beta], 'zebra')
  const backward = selectWorkflow([beta, alpha], 'zebra')
  if (forward.workflow.name === 'alpha' && backward.workflow.name === 'alpha') {
    pass('equal score and priority resolve on the lower name, independent of input order')
  } else {
    fail(`name tie-break chose ${forward.workflow.name}/${backward.workflow.name}, expected alpha/alpha`)
  }
}

// --- The selector must be able to fail ---

{
  try {
    selectWorkflow([], 'add a feature')
    fail('empty definition set: selector returned a result instead of failing')
  } catch (error) {
    pass(`empty definition set: rejected (${error.message.split(': ').at(-1)})`)
  }

  try {
    // A keyword that cannot match, so the selector reaches the fallback branch
    // and finds no workflow carrying the fallback name.
    selectWorkflow(
      [{ name: 'only-one', description: 'x', match: { keywords: ['zzz'], priority: 1 }, stages: [], rules: [], on_optional_missing: 'skip' }],
      'add a feature',
    )
    fail('missing fallback workflow: selector returned a result instead of failing')
  } catch (error) {
    pass(`missing fallback workflow: rejected (${error.message.split(': ').at(-1)})`)
  }
}

// --- Tokenizer and keyword matching ---

{
  const tokens = tokenizeRequest('Implement OAuth Login, please!')
  if (tokens.includes('implement') && tokens.includes('oauth') && tokens.includes('login') && tokens.includes('please')) {
    pass(`tokenizer is case- and punctuation-insensitive (${tokens.join(' ')})`)
  } else {
    fail(`tokenizer missed tokens: ${tokens.join(' ')}`)
  }

  const definition = DEFINITIONS.get('feature')
  const matched = matchedKeywords(definition, tokenizeRequest('implement a brand new thing'))
  if (matched.includes('implement') && !matched.includes('add')) {
    pass(`matchedKeywords reports the hits and not the misses (${matched.join(', ')})`)
  } else {
    fail(`matchedKeywords wrong: ${matched.join(', ')}`)
  }

  if (scoreWorkflow(definition, tokenizeRequest('implement')) === 1) {
    pass('scoreWorkflow counts one per distinct keyword')
  } else {
    fail('scoreWorkflow miscounted')
  }

  // A keyword that is a substring of a word must NOT match: "addition" does not
  // trigger the "add" keyword.
  if (scoreWorkflow(definition, tokenizeRequest('addition of a marker')) === 0) {
    pass('substring does not match ("addition" does not trigger "add")')
  } else {
    fail('substring matching is active — routing is no longer transparent')
  }
  // A hyphenated keyword is ONE token and never splits: dropping the
  // "(?:-[a-z0-9]+)*" group from TOKEN leaves every other gate green, so the
  // property is pinned here. No shipped keyword is hyphenated today; this
  // keeps a future one from silently changing routing.
  const hyphenTokens = tokenizeRequest('hot-fix now')
  const hyphenDefinition = {
    name: 'hyphen-probe',
    description: 'x',
    match: { keywords: ['hot-fix'], priority: 1 },
    stages: [],
    rules: [],
    on_optional_missing: 'skip',
  }
  if (hyphenTokens.join(' ') === 'hot-fix now'
    && scoreWorkflow(hyphenDefinition, tokenizeRequest('please hot-fix this')) === 1) {
    pass('a hyphenated keyword is one token and matches as a whole')
  } else {
    fail(`hyphen tokenization broke: tokens=${hyphenTokens.join(' ')} score=${scoreWorkflow(hyphenDefinition, tokenizeRequest('please hot-fix this'))}`)
  }
}

process.stdout.write(`\nflow-select failures=${failures}\n`)
if (failures > 0) process.exit(1)
process.stdout.write('workflow selector gate PASS\n')
