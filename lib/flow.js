// Workflow engine: selection, stage resolution, and optional-skill policy.
//
// This module holds the only workflow *behaviour* in the plugin. It deliberately
// knows nothing about cordis, commands, or messages: the host edges arrive as
// three injected callbacks, so the whole engine is exercisable in a unit test
// with a stub catalog.
//
// Two decisions worth stating:
//
//   1. A stage skill counts as available when the catalog returns it AND
//      isModelInvocable() is true. /flow does not ask the user to invoke these
//      skills, it hands them to the agent as instructions, so the model-facing
//      policy is the one that applies. (The one-skill slash commands use
//      isUserInvocable because there the user IS the one invoking.)
//   2. A missing required skill fails the whole command. Steering a workflow
//      whose middle stage is absent would put the agent in a state where it must
//      invent the missing guidance, which is exactly what this plugin exists to
//      prevent.

import { selectWorkflow, FALLBACK_WORKFLOW } from './flow-select.js'
import { composeWorkflowMessage } from './flow-compose.js'

/**
 * Build a workflow engine.
 *
 * @param {{ definitions: Map<string, object>, contracts?: Record<string, object>, resolveSkill: (name: string, invocation: object) => Promise<object | undefined>, renderSkill: (skill: object) => string, isModelInvocable: (skill: object) => boolean }} deps
 * @returns {{ select: (request: string) => object, run: (request: string, invocation?: object) => Promise<{ ok: true, message: string, plan: object } | { ok: false, error: string }> }}
 */
export function createFlowEngine(deps) {
  const { definitions, contracts = {}, resolveSkill, renderSkill, isModelInvocable } = deps

  if (!definitions || definitions.size === 0) {
    throw new Error('flow: no workflow definitions loaded')
  }
  if (!definitions.has(FALLBACK_WORKFLOW)) {
    throw new Error(`flow: fallback workflow "${FALLBACK_WORKFLOW}" is not defined`)
  }

  /**
   * Run one request through selection, resolution, and composition.
   *
   * @param {string} request raw user input, already trimmed by the caller
   * @param {{ scope?: unknown, signal?: AbortSignal | null, cwd?: string }} [invocation]
   * @returns {Promise<{ ok: true, message: string, plan: object } | { ok: false, error: string, workflow: string }>}
   */
  async function run(request, invocation = {}) {
    const selection = selectWorkflow(definitions.values(), request)
    const workflow = selection.workflow

    const stages = []
    const skipped = []
    for (const stage of workflow.stages) {
      const skill = await resolveSkill(stage.skill, invocation)
      const available = skill !== undefined && isModelInvocable(skill)
      if (available) {
        stages.push({ ...stage, rendered: renderSkill(skill) })
        continue
      }
      if (stage.required) {
        return {
          ok: false,
          workflow: workflow.name,
          error: `Workflow "${workflow.name}" requires the ${stage.skill} skill, which is not available in this session's skill catalog.`,
        }
      }
      if (workflow.on_optional_missing === 'error') {
        return {
          ok: false,
          workflow: workflow.name,
          error: `Workflow "${workflow.name}" is configured to fail when an optional skill is missing, and ${stage.skill} is not available.`,
        }
      }
      skipped.push(stage)
    }

    if (stages.length === 0) {
      // Unreachable through a valid definition (every workflow has at least one
      // required stage), but a policy combination that drops everything must
      // fail rather than steer an empty instruction.
      return {
        ok: false,
        workflow: workflow.name,
        error: `Workflow "${workflow.name}" resolved no available stages.`,
      }
    }

    const plan = { request, workflow, stages, skipped, selection }
    const message = composeWorkflowMessage(plan, { contracts })
    return { ok: true, message, plan }
  }

  return {
    select(request) {
      const selection = selectWorkflow(definitions.values(), request)
      return {
        workflow: selection.workflow.name,
        score: selection.score,
        matched: selection.matched,
        fallback: selection.fallback,
        considered: selection.considered,
      }
    },
    run,
  }
}
