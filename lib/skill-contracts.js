// Skill contracts: composition metadata, not skill content.
//
// The native DSH skill registry stays the single source of truth for loading a
// skill. This registry only answers the question the workflow composer needs:
// what does this skill hand to the next one, what does it need to have been
// handed, how risky is it, and where does it sit in the lifecycle. Nothing here
// can change what a skill says.
//
// Every shipped skill carries exactly one contract, and every contract names a
// shipped skill. That exhaustiveness rule is what keeps the registry honest: a
// skill with no contract would silently lose its place in every workflow graph.
//
// The vocabularies are closed on purpose. A free-form `produces` list is where
// "spec" and "specification" appear three months later and nobody notices.

import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonFile } from './json-file.js'
import { listSkillNames } from './skill-catalog.js'

const PLUGIN_ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const CONTRACTS_PATH = join(PLUGIN_ROOT, 'assets', 'skill-contracts.json')

/** Host grammar for a skill name, transcribed from packages/skill/skill/src/index.ts:22. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const TOP_LEVEL_KEYS = new Set(['skills', 'vocabularies'])
const CONTRACT_KEYS = new Set(['produces', 'consumes', 'categories', 'risk_level'])
const LIST_KEYS = new Set(['produces', 'consumes', 'categories'])

/**
 * Validate the contract registry.
 *
 * @param {unknown} registry parsed JSON value
 * @param {{ label?: string, skills?: readonly string[] }} [context] `skills` is
 *   the shipped skill catalog the registry must cover exactly
 * @returns {{ skills: Record<string, { produces: string[], consumes: string[], categories: string[], risk_level: string }>, vocabularies: { artifacts: Set<string>, categories: Set<string>, risk_levels: Set<string> } }}
 * @throws {Error} naming the file and the violated rule
 */
export function validateSkillContracts(registry, context = {}) {
  const label = context.label ?? 'assets/skill-contracts.json'
  const where = (detail) => `${label}: ${detail}`

  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error(where('registry must be a JSON object'))
  }
  for (const key of Object.keys(registry)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(where(`unknown key "${key}"`))
  }

  const { skills, vocabularies } = registry
  if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) {
    throw new Error(where('skills must be a JSON object (required)'))
  }
  if (vocabularies === undefined) {
    // Without a declared vocabulary there is nothing to check the artifact names
    // against, so the check would silently accept any spelling. Requiring it is
    // what makes the vocabulary closed.
    throw new Error(where('vocabularies must be declared (required)'))
  }

  const vocabulary = loadVocabularies(vocabularies, where)
  const validated = {}

  for (const [name, contract] of Object.entries(skills)) {
    if (!SKILL_NAME.test(name)) throw new Error(where(`skill key "${name}" is not a kebab-case skill name`))
    if (context.skills !== undefined && !context.skills.includes(name)) {
      throw new Error(where(`skill "${name}" is not a shipped skill`))
    }
    if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
      throw new Error(where(`contract for "${name}" must be a JSON object`))
    }
    for (const key of Object.keys(contract)) {
      if (!CONTRACT_KEYS.has(key)) throw new Error(where(`contract for "${name}" has unknown key "${key}"`))
    }

    const entry = {}
    for (const key of LIST_KEYS) {
      const value = contract[key]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(where(`contract for "${name}" declares no value for ${key}`))
      }
      const list = []
      for (const item of value) {
        if (typeof item !== 'string' || item.trim() === '') {
          throw new Error(where(`contract for "${name}" has an empty ${key} entry`))
        }
        list.push(item)
      }
      if (list.length !== new Set(list).size) {
        throw new Error(where(`contract for "${name}" repeats a value in ${key}`))
      }
      entry[key] = list
    }

    if (contract.risk_level !== undefined) {
      const level = contract.risk_level
      if (typeof level !== 'string' || !vocabulary.riskLevels.has(level)) {
        throw new Error(where(`contract for "${name}" has risk_level "${String(level)}" outside the declared vocabulary`))
      }
      entry.risk_level = level
    }

    for (const key of ['produces', 'consumes']) {
      for (const artifact of entry[key] ?? []) {
        if (!vocabulary.artifacts.has(artifact)) {
          throw new Error(where(`contract for "${name}" uses artifact "${artifact}" outside the declared vocabulary`))
        }
      }
    }
    for (const category of entry.categories ?? []) {
      if (!vocabulary.categories.has(category)) {
        throw new Error(where(`contract for "${name}" uses category "${category}" outside the declared vocabulary`))
      }
    }

    validated[name] = entry
  }

  if (context.skills !== undefined) {
    const missing = context.skills.filter((name) => validated[name] === undefined)
    if (missing.length > 0) {
      throw new Error(where(`no contract for shipped skill(s): ${missing.join(', ')}`))
    }
  }

  return { skills: validated, vocabularies: vocabulary }
}

function loadVocabularies(vocabularies, where) {
  if (vocabularies === null || typeof vocabularies !== 'object' || Array.isArray(vocabularies)) {
    throw new Error(where('vocabularies must be a JSON object'))
  }
  for (const key of Object.keys(vocabularies)) {
    if (key !== 'artifacts' && key !== 'categories' && key !== 'risk_levels') {
      throw new Error(where(`vocabularies has unknown key "${key}"`))
    }
  }
  return toVocabulary(vocabularies, where)
}

function toVocabulary(raw, where) {
  const sets = {}
  for (const [key, value] of Object.entries(raw)) {
    const name = key === 'risk_levels' ? 'riskLevels' : key
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(where(`vocabularies.${key} must be a non-empty array`))
    }
    const set = new Set()
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') throw new Error(where(`vocabularies.${key} has an empty entry`))
      set.add(item)
    }
    sets[name] = set
  }
  return sets
}

/**
 * Read the shipped contract registry.
 *
 * @param {{ root?: string, contractsPath?: string, skills?: readonly string[] }} [options]
 * @returns {ReturnType<typeof validateSkillContracts>}
 * @throws {Error} when the file is missing, invalid, or does not cover the catalog
 */
export function loadSkillContracts(options = {}) {
  const path = options.contractsPath ?? join(options.root ?? PLUGIN_ROOT, 'assets', 'skill-contracts.json')
  const label = `assets/${basename(path)}`
  const raw = readJsonFile(path, label)
  return validateSkillContracts(raw, {
    label,
    skills: options.skills ?? listSkillNames({ root: options.root ?? PLUGIN_ROOT }),
  })
}
