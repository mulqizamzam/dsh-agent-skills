// Workflow definitions: schema validation and loading.
//
// A workflow definition is DATA, not code. It names the skills a workflow runs,
// in order, and says which of them the workflow cannot run without. Everything
// the plugin does with a workflow — selecting it, resolving its skills, steering
// the agent — reads from the object this module returns, so adding a workflow is
// a new file, never a new branch in the command handler.
//
// Validation is deliberately strict about unknown keys: a typo in a field name
// would otherwise read as an absent optional field, which is the failure mode
// that hides for months.

import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonFile } from './json-file.js'

const PLUGIN_ROOT = join(fileURLToPath(import.meta.url), '..', '..')

/** Host grammar for a skill name, transcribed from packages/skill/skill/src/index.ts:22. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TOP_LEVEL_KEYS = new Set([
  'name', 'description', 'match', 'stages', 'rules', 'on_optional_missing', 'completion',
])
const STAGE_KEYS = new Set(['skill', 'required', 'purpose'])
const MATCH_KEYS = new Set(['keywords', 'priority'])
const OPTIONAL_POLICIES = new Set(['skip', 'error'])

/**
 * Validate one workflow definition object.
 *
 * @param {unknown} definition parsed JSON value
 * @param {{ label?: string, skills?: readonly string[] }} [context] `skills` is
 *   the shipped skill catalog; every stage must reference one of them
 * @returns {{ name: string, description: string, match: { keywords: string[], priority: number }, stages: Array<{ skill: string, required: boolean, purpose: string | undefined }>, rules: string[], on_optional_missing: string, completion: string | undefined }}
 * @throws {Error} naming the file and the violated rule
 */
export function validateWorkflowDefinition(definition, context = {}) {
  const label = context.label ?? 'workflow'
  const skills = context.skills
  const where = (detail) => `${label}: ${detail}`

  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error(where('definition must be a JSON object'))
  }
  for (const key of Object.keys(definition)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(where(`unknown key "${key}"`))
  }

  const { name, description, match, stages, rules, on_optional_missing, completion } = definition

  if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
    throw new Error(where(`name "${String(name)}" is not a kebab-case identifier`))
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(where('description must be a non-empty string'))
  }

  const keywords = []
  let priority = 0
  if (match !== undefined) {
    if (match === null || typeof match !== 'object' || Array.isArray(match)) {
      throw new Error(where('match must be an object'))
    }
    for (const key of Object.keys(match)) {
      if (!MATCH_KEYS.has(key)) throw new Error(where(`match has unknown key "${key}"`))
    }
    if (!Array.isArray(match.keywords) || match.keywords.length === 0) {
      throw new Error(where('match.keywords must be a non-empty array'))
    }
    for (const keyword of match.keywords) {
      if (typeof keyword !== 'string' || keyword.trim() === '' || /\s/.test(keyword)) {
        throw new Error(where(`match.keywords entry "${String(keyword)}" must be a single word`))
      }
      keywords.push(keyword.toLowerCase())
    }
    if (keywords.length !== new Set(keywords).size) {
      throw new Error(where('match.keywords repeats a keyword'))
    }
    if (match.priority !== undefined) {
      if (!Number.isInteger(match.priority)) throw new Error(where('match.priority must be an integer'))
      priority = match.priority
    }
  }

  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(where('stages must be a non-empty array'))
  }
  const seenSkills = new Set()
  const validatedStages = []
  for (const [index, stage] of stages.entries()) {
    const at = `stage ${index + 1}`
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) {
      throw new Error(where(`${at} must be an object`))
    }
    for (const key of Object.keys(stage)) {
      if (!STAGE_KEYS.has(key)) throw new Error(where(`${at} has unknown key "${key}"`))
    }
    const { skill, required, purpose } = stage
    if (typeof skill !== 'string' || !SKILL_NAME.test(skill)) {
      throw new Error(where(`${at}.skill "${String(skill)}" is not a kebab-case skill name`))
    }
    if (skills !== undefined && !skills.includes(skill)) {
      throw new Error(where(`${at}.skill "${skill}" is not a shipped skill`))
    }
    if (typeof required !== 'boolean') {
      throw new Error(where(`${at}.required must be a boolean, got ${JSON.stringify(required)}`))
    }
    if (purpose !== undefined && (typeof purpose !== 'string' || purpose.trim() === '')) {
      throw new Error(where(`${at}.purpose must be a non-empty string when present`))
    }
    if (seenSkills.has(skill)) {
      throw new Error(where(`${at} repeats skill "${skill}" — each skill may appear once`))
    }
    seenSkills.add(skill)
    validatedStages.push({ skill, required, purpose })
  }

  let validatedRules = []
  if (rules !== undefined) {
    if (!Array.isArray(rules)) throw new Error(where('rules must be an array'))
    for (const rule of rules) {
      if (typeof rule !== 'string' || rule.trim() === '') {
        throw new Error(where('every rule must be a non-empty string'))
      }
      validatedRules.push(rule)
    }
  }

  if (on_optional_missing !== undefined && !OPTIONAL_POLICIES.has(on_optional_missing)) {
    throw new Error(where(`on_optional_missing must be one of ${[...OPTIONAL_POLICIES].join(' | ')}, got "${String(on_optional_missing)}"`))
  }

  if (completion !== undefined && (typeof completion !== 'string' || completion.trim() === '')) {
    throw new Error(where('completion must be a non-empty string when present'))
  }

  return {
    name,
    description,
    match: { keywords, priority },
    stages: validatedStages,
    rules: validatedRules,
    on_optional_missing: on_optional_missing ?? 'skip',
    completion,
  }
}

/**
 * Read one workflow definition file.
 *
 * @param {string} path absolute path to `<name>.json`
 * @param {{ skills?: readonly string[] }} [context]
 * @returns {ReturnType<typeof validateWorkflowDefinition>}
 */
export function readWorkflowDefinition(path, context = {}) {
  const stem = basename(path).replace(/\.json$/, '')
  const label = `assets/workflows/${basename(path)}`
  const raw = readJsonFile(path, label)
  const definition = validateWorkflowDefinition(raw, { ...context, label })
  if (definition.name !== stem) {
    throw new Error(`${label}: name "${definition.name}" does not match the file name "${stem}"`)
  }
  return definition
}

/**
 * Load every workflow definition in a directory.
 *
 * @param {{ root?: string, workflowsDir?: string, skills?: readonly string[] }} [options]
 * @returns {Map<string, ReturnType<typeof validateWorkflowDefinition>>} keyed by workflow name,
 *   iterated in file-name order so callers never see a random order
 * @throws {Error} when the directory is missing, holds no definitions, or a file
 *   is invalid (including a name that does not match its file name, which is
 *   what keeps two files from declaring the same workflow)
 */
export function loadWorkflowDefinitions(options = {}) {
  const dir = options.workflowsDir ?? join(options.root ?? PLUGIN_ROOT, 'assets', 'workflows')
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`assets/workflows: cannot read ${dir} (${error.code ?? error.message})`)
  }
  const definitions = new Map()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const stem = entry.name.slice(0, -'.json'.length)
    // readWorkflowDefinition enforces name === stem, so the stem is the map key
    // and two files can never claim the same workflow name.
    definitions.set(stem, readWorkflowDefinition(join(dir, entry.name), { skills: options.skills }))
  }
  if (definitions.size === 0) {
    throw new Error(`assets/workflows: no workflow definitions found in ${dir}`)
  }
  return definitions
}
