// dsh-agent-skills — command registrar.
//
// Nine thin slash commands, each a deterministic alias for one canonical skill.
// The command handler does exactly three things:
//   1. Look up the canonical skill by name via ctx.skills.get()
//   2. If found and user-invocable, steer the agent with the rendered skill
//      body plus the user's raw input
//   3. Return a CommandResult (success or error)
//
// No workflow logic lives here. The skill body is the single source of truth.

import { renderSkillContent, isUserInvocable } from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

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
 * Register all nine lifecycle commands.
 */

export function apply(ctx, config = {}) {
  const map = { ...COMMAND_SKILL_MAP, ...config }
  for (const [commandName, skillName] of Object.entries(map)) {
    registerCommand(ctx, commandName, skillName)
  }
}
