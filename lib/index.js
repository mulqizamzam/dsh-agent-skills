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

/**
 * Register one thin command that delegates to a canonical skill.
 */
function registerCommand(ctx, commandName, skillName) {
  ctx.commands.register({
    name: commandName,
    description: `Delegate to the ${skillName.replace(/-/g, ' ')} skill.`,
    input: { hint: 'Your request for this skill' },
    handler: async ({ agent, rawInput, signal }) => {
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
 */
export function registerFlowCommand(ctx, { loadEngine, reason }) {
  ctx.commands.register({
    name: 'flow',
    description: 'Run an engineering workflow (investigate, spec, plan, build, test, review, ship) by composing the matching skills.',
    input: { hint: 'What you want done, e.g. "implement OAuth login"' },
    handler: async ({ agent, rawInput, signal }) => {
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

/** Commands this plugin registers itself; a config key may not claim one. */
const RESERVED_COMMANDS = new Set(['flow'])

/**
 * Register the nine skill aliases plus the /flow workflow command.
 */
export function apply(ctx, config = {}) {
  // A config key arrives through the profile patch, so it is checked rather
  // than trusted. Two rules keep one bad key from taking the whole activation
  // down with it:
  //   1. `flow` is reserved. registerFlowCommand registers it below, and the
  //      host throws on a duplicate command name
  //      (packages/interaction/commands/src/index.ts:93-95), which would lose
  //      the nine aliases too — the exact isolation the comment below claims.
  //   2. Keys must match the host command-name grammar, so a malformed key
  //      fails here naming itself instead of throwing inside the registry.
  for (const key of Object.keys(config)) {
    if (!COMMAND_NAME.test(key)) {
      throw new Error(`dsh-agent-skills: config key "${key}" is not a command name (expected ${String(COMMAND_NAME)})`)
    }
  }
  const map = { ...COMMAND_SKILL_MAP, ...config }
  for (const [commandName, skillName] of Object.entries(map)) {
    if (RESERVED_COMMANDS.has(commandName)) continue
    registerCommand(ctx, commandName, skillName)
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
    registerFlowCommand(ctx, { loadEngine, reason: error.message })
    return
  }
  registerFlowCommand(ctx, { loadEngine })
}
