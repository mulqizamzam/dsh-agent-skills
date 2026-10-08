// Deterministic workflow selector.
//
// Transparent rules on purpose: a keyword either appears as a whole word in the
// request or it does not. No stemming, no embeddings, no model call — that keeps
// the routing decision reproducible in a test and explainable to the person who
// typed the command.
//
// Scoring: how many of a workflow's distinct keywords appear as whole tokens.
// Highest score wins. Ties break on `match.priority` (higher first), then on the
// workflow name, so the result never depends on directory iteration order. A
// request matching nothing falls back to the investigation workflow: the most
// conservative generally applicable choice, because understanding the change
// before making it is never the wrong first move.

/** Workflow used when the request matches no keyword at all. */
export const FALLBACK_WORKFLOW = 'investigation'

const TOKEN = /[a-z0-9]+(?:-[a-z0-9]+)*/g

/**
 * Split a raw request into lowercase comparison tokens.
 *
 * @param {string} request raw user input
 * @returns {string[]} tokens in order of appearance, duplicates kept (they do
 *   not change the score but keep the function honest about its input)
 */
export function tokenizeRequest(request) {
  return [...String(request).toLowerCase().matchAll(TOKEN)].map((m) => m[0])
}

/**
 * Keywords of one workflow that appear as whole tokens in the request.
 *
 * @param {{ match: { keywords: string[] } }} definition validated workflow definition
 * @param {string[]} tokens tokens from {@link tokenizeRequest}
 * @returns {string[]} the matched keywords, in definition order
 */
export function matchedKeywords(definition, tokens) {
  const present = new Set(tokens)
  return definition.match.keywords.filter((keyword) => present.has(keyword))
}

/**
 * Score one workflow against a request.
 *
 * @param {{ match: { keywords: string[], priority: number } }} definition
 * @param {string[]} tokens
 * @returns {number} number of distinct matched keywords (priority is a
 *   tie-breaker, not part of the score)
 */
export function scoreWorkflow(definition, tokens) {
  return matchedKeywords(definition, tokens).length
}

/**
 * Pick the workflow for a request.
 *
 * @param {Iterable<object>} definitions validated workflow definitions
 * @param {string} request raw user input
 * @returns {{ workflow: object, score: number, matched: string[], fallback: boolean, considered: Array<{ name: string, score: number }> }}
 * @throws {Error} when no definition carries the fallback workflow's name
 */
export function selectWorkflow(definitions, request) {
  const tokens = tokenizeRequest(request)
  const ranked = []
  for (const definition of definitions) {
    const score = scoreWorkflow(definition, tokens)
    ranked.push({ definition, score, matched: matchedKeywords(definition, tokens) })
  }
  if (ranked.length === 0) throw new Error('selector: no workflow definitions available')

  const best = ranked.reduce((winner, candidate) => {
    if (candidate.score > winner.score) return candidate
    if (candidate.score < winner.score) return winner
    const a = candidate.definition
    const b = winner.definition
    if (a.match.priority !== b.match.priority) {
      return a.match.priority > b.match.priority ? candidate : winner
    }
    return a.name < b.name ? candidate : winner
  })

  const considered = ranked
    .map((entry) => ({ name: entry.definition.name, score: entry.score }))
    .sort((x, y) => (y.score - x.score) || x.name.localeCompare(y.name))

  const fallback = best.score === 0
  if (fallback) {
    const definition = ranked.find((entry) => entry.definition.name === FALLBACK_WORKFLOW)
    if (definition === undefined) {
      throw new Error(`selector: fallback workflow "${FALLBACK_WORKFLOW}" is not defined`)
    }
    return {
      workflow: definition.definition,
      score: 0,
      matched: [],
      fallback: true,
      considered,
    }
  }

  return {
    workflow: best.definition,
    score: best.score,
    matched: best.matched,
    fallback: false,
    considered,
  }
}
