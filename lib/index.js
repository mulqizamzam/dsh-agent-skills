// dsh-agent-skills — command registrar.
//
// Two kinds of command, both thin:
//
//   1. Nine skill aliases. Each is a deterministic alias for one canonical skill:
//      look it up by name, steer the agent with the rendered skill body plus the
//      user's raw input, return a CommandResult. No workflow logic lives here.
//
//   2. One workflow command, `/flow`. It composes a workflow out of existing
//      skills: the selector picks the workflow, the engine resolves each stage
//      through the same catalog lookup the aliases use, and one steering message
//      carries the ordered skill bodies. The workflow definitions live in
//      assets/workflows/, the composition metadata in assets/skill-contracts.json,
//      and neither is known to this file.
//
// In both cases the skill body is the single source of truth. The plugin never
// rewrites, summarizes, or reorders what a skill says.

import { renderSkillContent, isUserInvocable, isModelInvocable } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

import { listSkillNames } from './skill-catalog.js'
import { loadWorkflowDefinitions } from './workflows.js'
import { loadSkillContracts } from './skill-contracts.js'
import { createFlowEngine } from './flow.js'

export const name = 'dsh-agent-skills'
export const inject = ['skills', 'commands']

/** Command name → canonical skill name. */
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

// Workflow commands compose several skills, so they are not skill aliases and do
// not belong in the map above. The value carries the error text used when the
// workflow assets themselves fail to load.
/** Workflow command name → failure message shown when the workflow engine is unavailable. */
const WORKFLOW_COMMAND_MAP = {
  flow: 'The workflow definitions or skill contracts failed to load, so /flow is unavailable.',
}

const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'dsh-agent-skills', form: 'instructions' }

/** Message of a thrown value, for handlers that must never rethrow. */
function thrownMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register one thin command that delegates to a canonical skill.
 *
 * @returns {(() => void) | undefined} the host registry's disposer, so a
 *   re-apply can tear the previous registration down instead of colliding
 *   with it
 */
function registerCommand(ctx, commandName, skillName) {
  return ctx.commands.register({
    name: commandName,
    description: `Delegate to the ${skillName.replace(/-/g, ' ')} skill.`,
    input: { hint: 'Your request for this skill' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const skill = await ctx.skills.get(skillName, { scope: agent, signal, cwd: agent.session?.header?.cwd })
        if (skill === undefined) {
          return { kind: 'error', text: `Skill "${skillName}" not found in catalog.` }
        }
        if (!isUserInvocable(skill)) {
          return { kind: 'error', text: `Skill "${skillName}" is not user-invocable.` }
        }

        const userInput = rawInput.trim()
        const skillBody = renderSkillContent(skill)
        const text = userInput
          ? `${skillBody}\n\nUser request: ${userInput}`
          : skillBody

        agent.steer(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
        }))

        return { kind: 'success' }
      } catch (error) {
        // The orchestrator spec's failure contract: no exception escapes a
        // handler. A host-side throw (catalog lookup, render, steer) must come
        // back as this plugin's own error result, not a rejected promise the
        // host has to interpret as an internal failure.
        return { kind: 'error', text: `/${commandName} failed: ${thrownMessage(error)}` }
      }
    },
  })
}

/**
 * Register /flow, the one command that composes a workflow out of existing skills.
 *
 * Exported so the degraded path (workflow assets failed to load) can be tested
 * without corrupting a tracked file.
 *
 * @param {object} ctx host context
 * @param {{ loadEngine: () => object | undefined, reason?: string }} deps
 *   `loadEngine` returns the engine, or undefined when the workflow assets could
 *   not be loaded; `reason` is the load error, included in the failure text
 * @returns {(() => void) | undefined} the host registry's disposer
 */
export function registerFlowCommand(ctx, { loadEngine, reason }) {
  return ctx.commands.register({
    name: 'flow',
    description: 'Run an engineering workflow (investigate, spec, plan, build, test, review, ship) by composing the matching skills.',
    input: { hint: 'What you want done, e.g. "implement OAuth login"' },
    handler: async ({ agent, rawInput, signal }) => {
      try {
        const request = rawInput.trim()
        if (request === '') {
          return {
            kind: 'error',
            text: 'Usage: /flow <what you want done>, for example "/flow implement OAuth login".',
          }
        }

        const engine = loadEngine()
        if (engine === undefined) {
          // The nine alias commands do not depend on the workflow layer, so a
          // broken definition must not take them down with it. /flow stays
          // registered and says exactly why it cannot run.
          const detail = reason === undefined ? '' : ` Reason: ${reason}`
          return { kind: 'error', text: `${WORKFLOW_COMMAND_MAP.flow}${detail}` }
        }

        const outcome = await engine.run(request, {
          scope: agent,
          signal,
          cwd: agent.session?.header?.cwd,
        })

        if (!outcome.ok) {
          return { kind: 'error', text: outcome.error }
        }

        agent.steer(createUserMessage({
          content: [{ type: 'text', text: outcome.message }],
          source: PLUGIN_SOURCE,
        }))

        return { kind: 'success' }
      } catch (error) {
        // Same failure contract as the aliases: nothing escapes a handler.
        return { kind: 'error', text: `/flow failed: ${thrownMessage(error)}` }
      }
    },
  })
}

/**
 * Load and validate the workflow assets.
 *
 * Returns an engine builder rather than an engine: the engine needs the live
 * `ctx.skills` resolver, which only exists inside a handler invocation. Loading
 * here (once per plugin activation) means a malformed definition or a contract
 * gap is caught while the plugin boots instead of surfacing on a user's first
 * command — the same fail-closed rule the repo's static gates apply.
 */
function createEngineLoader(ctx) {
  const skills = listSkillNames()
  const definitions = loadWorkflowDefinitions({ skills })
  const contracts = loadSkillContracts({ skills })
  return () => createFlowEngine({
    definitions,
    contracts: contracts.skills,
    resolveSkill: (skillName, invocation) => ctx.skills.get(skillName, {
      scope: invocation.scope,
      signal: invocation.signal,
      cwd: invocation.cwd,
    }),
    renderSkill: renderSkillContent,
    isModelInvocable,
  })
}

/** Host grammar for a command name, transcribed from packages/interaction/commands/src/index.ts:28. */
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/

/** Host grammar for a skill name, transcribed from packages/skill/skill/src/index.ts:22. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Commands this plugin registers itself; a config key may not claim one. */
const RESERVED_COMMANDS = new Set(['flow'])

/**
 * Registrations made per host context, so a re-apply replaces them instead of
 * colliding with them. The host's command registry throws on a duplicate name
 * (packages/interaction/commands/src/index.ts:102-104), so a plain second
 * apply() on the same ctx would die mid-registration and leave the first
 * apply's commands behind — verified against the real registry.
 */
const registrationsByCtx = new WeakMap()

/**
 * Register the nine skill aliases plus the /flow workflow command.
 */
export function apply(ctx, config = {}) {
  // A profile patch carrying `config: null` means "no overrides", not a crash:
  // the default parameter only replaces undefined, so null is normalized here.
  const cfg = config ?? {}
  // A config key arrives through the profile patch, so it is checked rather
  // than trusted. Two rules keep one bad key from taking the whole activation
  // down with it:
  //   1. `flow` is reserved. registerFlowCommand registers it below, and the
  //      host throws on a duplicate command name
  //      (packages/interaction/commands/src/index.ts:93-95), which would lose
  //      the nine aliases too — the exact isolation the comment below claims.
  //   2. Keys must match the host command-name grammar, so a malformed key
  //      fails here naming itself instead of throwing inside the registry.
  for (const key of Object.keys(cfg)) {
    if (!COMMAND_NAME.test(key)) {
      throw new Error(`dsh-agent-skills: config key "${key}" is not a command name (expected ${String(COMMAND_NAME)})`)
    }
    // Values are checked with the same fail-naming-itself rule as keys: a
    // non-string value used to reach registerCommand and throw a raw
    // TypeError ("skillName.replace is not a function") that killed the whole
    // command surface — 0 of 10 commands on the real host registry. A value
    // that is merely not shipped is allowed: an alias may deliberately point
    // at a skill another plugin provides, and that fails at handler runtime
    // with the plugin's own error result.
    const value = cfg[key]
    if (typeof value !== 'string' || !SKILL_NAME.test(value)) {
      throw new Error(`dsh-agent-skills: config key "${key}" must map to a skill name (expected ${String(SKILL_NAME)}), got ${JSON.stringify(value)}`)
    }
  }
  const map = { ...COMMAND_SKILL_MAP, ...cfg }
  const prior = registrationsByCtx.get(ctx)
  if (prior !== undefined) {
    for (const dispose of prior) dispose()
  }
  const disposers = []
  registrationsByCtx.set(ctx, disposers)
  for (const [commandName, skillName] of Object.entries(map)) {
    if (RESERVED_COMMANDS.has(commandName)) continue
    const dispose = registerCommand(ctx, commandName, skillName)
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  // A broken workflow asset must not take the nine alias commands down with it:
  // they share nothing with the workflow layer. /flow stays registered and
  // reports the reason instead. `npm test` proves the shipped assets are valid,
  // so a green commit can never reach the degraded path.
  let loadEngine
  try {
    loadEngine = createEngineLoader(ctx)
  } catch (error) {
    loadEngine = () => undefined
    const dispose = registerFlowCommand(ctx, { loadEngine, reason: error.message })
    if (typeof dispose === 'function') disposers.push(dispose)
    return
  }
  const dispose = registerFlowCommand(ctx, { loadEngine })
  if (typeof dispose === 'function') disposers.push(dispose)
}
