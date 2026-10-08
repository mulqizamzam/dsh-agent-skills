#!/usr/bin/env node
// Regenerate the two README regions that describe the shipped catalog.
//
// The skill count and the 27-row table used to be maintained by hand in six
// places, so every added skill needed edits scattered across the repo. Both
// regions are now derived from assets/skills/ and the only human-maintained
// input is GROUPS below, which records how the table is organised.
//
// Generated regions (markers are literal HTML comments in README.md):
//   <!-- BEGIN:SKILL-COUNT --> ... <!-- END:SKILL-COUNT -->
//   <!-- BEGIN:SKILL-TABLE --> ... <!-- END:SKILL-TABLE -->
//
// Usage:
//   node scripts/gen-readme.mjs           rewrite README.md in place
//   node scripts/gen-readme.mjs --check   exit 1 if README.md is stale
//
// Idempotent: running it twice on an unchanged catalog writes nothing.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const README = join(PLUGIN_ROOT, 'README.md')
const SKILLS_DIR = join(PLUGIN_ROOT, 'assets', 'skills')

// The host's own YAML parser (yaml@2.9.0, spec 1.2) — the same one behind
// parseFrontmatter in packages/skill/skill-filesystem. Reimplementing the
// split here would let a scalar this script reads differently from the scalar
// the loader reads, which is exactly the drift the structural gate exists for.
const HARNESS = process.env.DSH_HARNESS ?? '/home/administrator/deepseek-harness'
const require = createRequire(import.meta.url)
let parseYaml
try {
  ;({ parse: parseYaml } = require(join(HARNESS, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml')))
} catch (error) {
  console.error(`FAIL cannot load the host YAML parser from ${HARNESS} (${error.code ?? error.message})`)
  console.error('     set DSH_HARNESS to the harness checkout if it lives elsewhere')
  process.exit(1)
}

const { countSkills } = await import(new URL('../lib/counts.js', import.meta.url).href)

/**
 * Table grouping. Order is data, not prose: it lives here so README's wording
 * can never be the source of truth for how skills are organised. Key = the
 * bold heading rendered above each table; value = skill names in row order.
 * A skill absent from every group still gets a row under "Not yet grouped",
 * so a newly scaffolded skill never vanishes from the README.
 */
const GROUPS = {
  'Planning & thinking': [
    'spec-driven-development',
    'planning-and-task-breakdown',
    'idea-refine',
    'interview-me',
    'doubt-driven-development',
    'context-engineering',
  ],
  'Building': [
    'incremental-implementation',
    'test-driven-development',
    'api-and-interface-design',
    'frontend-ui-engineering',
    'source-driven-development',
  ],
  'Quality': [
    'code-review-and-quality',
    'code-simplification',
    'constraint-driven-development',
    'testing-strategy',
  ],
  'Version control': [
    'git-workflow-and-versioning',
  ],
  'Operating & shipping': [
    'ci-cd-and-automation',
    'observability-and-instrumentation',
    'performance-optimization',
    'shipping-and-launch',
    'browser-testing-with-devtools',
  ],
  'Maintaining': [
    'deprecation-and-migration',
    'security-and-hardening',
    'debugging-and-error-recovery',
  ],
  'Meta & documentation': [
    'using-agent-skills',
    'documentation-and-adrs',
    'writing-repository-readme',
  ],
}

const TABLE_HEADER = '| Skill | When the agent reaches for it |'
const TABLE_RULE = '|-------|-------------------------------|'

/** Read every shipped skill's frontmatter name and description. */
function readSkills() {
  const skills = new Map()
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(SKILLS_DIR, entry.name, 'SKILL.md')
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      // countSkills() counts directories that still hold a SKILL.md, so this
      // directory does not contribute to the count either; structural.test.mjs
      // reports the missing file by name.
      continue
    }
    const fence = raw.match(/^---\n([\s\S]*?)\n---/)
    if (fence === null) throw new Error(`gen-readme: ${entry.name}/SKILL.md has no frontmatter block`)
    const fm = parseYaml(fence[1])
    if (fm === null || typeof fm !== 'object') {
      throw new Error(`gen-readme: ${entry.name}/SKILL.md frontmatter is not a mapping`)
    }
    if (typeof fm.name !== 'string' || fm.name.length === 0) {
      throw new Error(`gen-readme: ${entry.name}/SKILL.md frontmatter has no name`)
    }
    if (typeof fm.description !== 'string' || fm.description.length === 0) {
      throw new Error(`gen-readme: ${entry.name}/SKILL.md frontmatter has no description`)
    }
    if (skills.has(fm.name)) throw new Error(`gen-readme: duplicate skill name "${fm.name}"`)
    // A description folded across lines would break the row into two; the host
    // loader keeps the newline, but markdown tables cannot.
    skills.set(fm.name, { dir: entry.name, description: fm.description.replace(/\s+/g, ' ').trim() })
  }
  return skills
}

/** Render the whole table body, grouped in GROUPS order. */
function buildTable(skills) {
  const lines = []
  const grouped = new Set()

  for (const [group, names] of Object.entries(GROUPS)) {
    const rows = []
    for (const name of names) {
      const skill = skills.get(name)
      if (skill === undefined) {
        throw new Error(`gen-readme: group "${group}" lists skill "${name}" which is not in assets/skills/`)
      }
      rows.push(`| \`${name}\` | ${skill.description} |`)
      grouped.add(name)
    }
    if (rows.length === 0) continue
    lines.push(`**${group}**`, TABLE_HEADER, TABLE_RULE, ...rows, '')
  }

  const ungrouped = [...skills.keys()].filter((name) => !grouped.has(name)).sort()
  if (ungrouped.length > 0) {
    lines.push('**Not yet grouped**', TABLE_HEADER, TABLE_RULE)
    for (const name of ungrouped) {
      lines.push(`| \`${name}\` | ${skills.get(name).description} |`)
    }
    lines.push('')
  }

  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines.join('\n')
}

/** Replace one marked region. Function form so `$` in prose stays literal. */
function replaceRegion(text, region, body) {
  const pattern = new RegExp(`<!-- BEGIN:${region} -->[\\s\\S]*?<!-- END:${region} -->`)
  if (!pattern.test(text)) {
    throw new Error(`gen-readme: README.md has no <!-- BEGIN:${region} --> / <!-- END:${region} --> pair`)
  }
  return text.replace(pattern, () => `<!-- BEGIN:${region} -->\n${body}\n<!-- END:${region} -->`)
}

function regionOf(text, region) {
  const match = text.match(new RegExp(`<!-- BEGIN:${region} -->[\\s\\S]*?<!-- END:${region} -->`))
  return match === null ? null : match[0]
}

/**
 * Fail if the skill count is written by hand anywhere outside a marker region.
 *
 * The two generated regions are the only places a count belongs. A bare number in
 * prose looks right until a skill is added, at which point it is silently wrong
 * and no other gate notices: structural.test.mjs derives its own expectation,
 * readme:check compares only the marked regions, and diff-upstream reads bodies.
 * This check is what makes that drift loud.
 *
 * Only `--check` enforces it. The rewrite mode cannot fix hand-written prose, so
 * reporting there would block an operator who never introduced the problem.
 */
function findBareCount(text, count) {
  const withoutRegions = text
    .replace(/<!-- BEGIN:SKILL-COUNT -->[\s\S]*?<!-- END:SKILL-COUNT -->/g, '')
    .replace(/<!-- BEGIN:SKILL-TABLE -->[\s\S]*?<!-- END:SKILL-TABLE -->/g, '')
  const pattern = new RegExp(`\\b${count}\\b`)
  // Report the offending line's content, not its number: stripping the regions
  // above renumbers the file, so a line number computed here would be wrong.
  for (const line of withoutRegions.split('\n')) {
    if (pattern.test(line)) return line.trim()
  }
  return null
}

const check = process.argv.includes('--check')

// Everything below throws on a broken catalog. Caught here so the gate prints
// one FAIL line and exits 1 instead of a stack trace: npm test reads the exit
// code, and an uncaught exception buries the reason in Node's own prefix.
try {
  const current = readFileSync(README, 'utf8')
  const skills = readSkills()

  const expectedCount = countSkills()
  if (skills.size !== expectedCount) {
    throw new Error(`gen-readme: read ${skills.size} skills but countSkills() reports ${expectedCount}`)
  }

  // Checked before the staleness comparison so a hand-written count is reported
  // as itself, not buried under "count/table does not match".
  if (check) {
    const bare = findBareCount(current, expectedCount)
    if (bare !== null) {
      console.error(`FAIL README.md writes the skill count (${expectedCount}) outside a marker region:`)
      console.error(`     ${bare}`)
      console.error('     the count belongs only inside BEGIN/END:SKILL-COUNT or BEGIN/END:SKILL-TABLE;')
      console.error('     reword the sentence, or let the region carry the number')
      process.exit(1)
    }
  }

  const expected = replaceRegion(
    replaceRegion(current, 'SKILL-COUNT', `## All ${expectedCount} skills`),
    'SKILL-TABLE',
    buildTable(skills),
  )

  if (current === expected) {
    console.log(check
      ? `README.md up to date (${expectedCount} skills)`
      : `README.md already up to date (${expectedCount} skills, nothing written)`)
    process.exit(0)
  }

  if (check) {
    const stale = ['SKILL-COUNT', 'SKILL-TABLE'].filter((r) => regionOf(current, r) !== regionOf(expected, r))
    console.error(`FAIL README.md is stale: ${stale.join(', ') || 'outside the generated regions'}`)
    console.error(`     count/table in README does not match assets/skills/ (${expectedCount} skills)`)
    console.error('     run: npm run readme:gen')
    process.exit(1)
  }

  writeFileSync(README, expected)
  console.log(`README.md updated (${expectedCount} skills)`)
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exit(1)
}
