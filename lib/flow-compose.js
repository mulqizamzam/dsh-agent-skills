// Workflow message composer.
//
// Pure text assembly: no host imports, no filesystem, no clock. Everything it
// needs arrives as arguments, which is what makes the composed message testable
// without a running DSH and what keeps the /flow handler free of formatting
// logic.
//
// The one rule that governs this file: never rewrite a skill. Each stage's body
// is whatever the caller's renderSkill returns — in production the host's
// renderSkillContent, so the model sees the same <skill_content> block it would
// see from the `skill` tool or from the one-skill slash commands. Anything this
// composer adds is a header around that block, never a substitute for it.

const SECTION_RULE = '---'

/**
 * Compose the single steering message for a workflow plan.
 *
 * @param {{ request: string, workflow: object, stages: Array<{ skill: string, purpose?: string, rendered: string }>, skipped?: Array<{ skill: string, purpose?: string }>, selection?: { matched?: string[], fallback?: boolean, score?: number } }} plan
 * @param {{ contracts?: Record<string, object> }} [options] contract registry for
 *   per-stage `produces` / `consumes` / `risk_level` annotations
 * @returns {string} the complete model-facing message
 */
export function composeWorkflowMessage(plan, options = {}) {
  const { request, workflow, stages } = plan
  const contracts = options.contracts ?? {}
  const skipped = plan.skipped ?? []
  const selection = plan.selection ?? {}

  const lines = []
  lines.push('WORKFLOW')
  lines.push('========')
  lines.push('')
  lines.push('Goal:')
  lines.push(request)
  lines.push('')
  lines.push('Selected workflow:')
  lines.push(`${workflow.name} — ${workflow.description}`)
  lines.push('')
  lines.push(`Workflow selection: ${describeSelection(selection)}`)
  lines.push('')
  lines.push('Execution order:')
  for (const [index, stage] of stages.entries()) {
    const requirement = stage.required === false ? 'optional' : 'required'
    const purpose = stage.purpose ? ` — ${stage.purpose}` : ''
    lines.push(`${index + 1}. ${stage.skill} (${requirement})${purpose}`)
    lines.push(...contractAnnotation(stage.skill, ownContract(contracts, stage.skill)))
  }
  lines.push('')

  if (skipped.length > 0) {
    lines.push('Skipped optional stages:')
    for (const stage of skipped) {
      const purpose = stage.purpose ? ` — ${stage.purpose}` : ''
      lines.push(`- ${stage.skill}${purpose}`)
    }
    lines.push('')
    lines.push('Skipped stages were not available in this session. Do not claim their output; report them as not done.')
    lines.push('')
  }

  if (workflow.rules.length > 0) {
    lines.push('Workflow rules:')
    for (const rule of workflow.rules) lines.push(`- ${rule}`)
    lines.push('')
  }

  if (workflow.completion !== undefined) {
    lines.push('Definition of done for this workflow:')
    lines.push(workflow.completion)
    lines.push('')
  }

  lines.push(SECTION_RULE)
  lines.push('')

  for (const [index, stage] of stages.entries()) {
    lines.push(`STAGE ${index + 1} of ${stages.length}: ${stage.skill}`)
    if (stage.purpose !== undefined) {
      lines.push(`Purpose: ${stage.purpose}`)
    }
    lines.push('')
    lines.push(stage.rendered)
    lines.push('')
  }

  lines.push(`User request:`)
  lines.push(request)

  return lines.join('\n')
}

function describeSelection(selection) {
  if (selection.fallback === true) {
    return 'no workflow keyword matched this request, so the conservative default was chosen'
  }
  const matched = selection.matched ?? []
  if (matched.length === 0) return 'chosen by request classification'
  return `matched on ${matched.join(', ')}`
}

/**
 * Look up a stage's contract by own property only. A skill named after an
 * Object.prototype member ("constructor") would otherwise inherit a function
 * and read as a contract with no artifacts at all.
 */
function ownContract(contracts, skill) {
  return Object.hasOwn(contracts, skill) ? contracts[skill] : undefined
}

function contractAnnotation(skill, contract) {
  if (contract === undefined) return []
  const notes = []
  if (contract.produces?.length > 0) notes.push(`produces ${contract.produces.join(', ')}`)
  if (contract.consumes?.length > 0) notes.push(`consumes ${contract.consumes.join(', ')}`)
  if (notes.length === 0) return []
  const line = `   Artifacts: ${notes.join('; ')}.`
  // Worded differently per level on purpose: a high-risk stage failing genuinely
  // blocks the workflow, while a medium-risk finding blocks only until it is
  // resolved. One shared sentence would overstate the second case.
  if (contract.risk_level === 'high') {
    return [line, '   Risk level: high — a failure here blocks the workflow and is not stepped over.']
  }
  if (contract.risk_level === 'medium') {
    return [line, '   Risk level: medium — anything it raises blocks the next stage until resolved.']
  }
  return [line]
}
