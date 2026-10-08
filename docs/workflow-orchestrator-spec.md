# Engineering Workflow Orchestrator v1 — implementation spec

Status: implemented (this file is the decision record written before the code).

## Goals

- A new slash command `/flow <user request>` that composes an engineering
  workflow out of the **existing** canonical skills and steers the agent once.
- Workflow definitions live outside the command handler, in `assets/workflows/`.
- Machine-readable composition metadata for skills, in `assets/skill-contracts.json`.
- Two new reusable skills (`evidence-and-decision-tracking`, `engineering-handoff`)
  that are ordinary skills first and workflow stages second.
- Deterministic, testable selection and composition. No ML, no daemon, no
  autonomous multi-turn loop.

## Non-goals

- No autonomous multi-turn orchestration. v1 emits **one** steering message; the
  agent, not the plugin runtime, executes the stages. Nothing in the installed
  DSH API surface promises a multi-turn stage machine, and inventing one would be
  a speculative DSH API.
- No second skill-discovery system. The native DSH skill registry stays
  authoritative for loading; contracts only describe composition.
- No rewrite of skill bodies. `renderSkillContent()` output is embedded verbatim.
- No new runtime dependency (see "JSON, not YAML").

## Architecture

```
user request (rawInput)
  → /flow command (lib/index.js)                 thin: validate, delegate, steer
  → flow engine (lib/flow.js)                    resolve + policy
  → selector (lib/flow-select.js)                deterministic keyword scoring
  → workflow definitions (assets/workflows/*.json)
  → skill contracts (assets/skill-contracts.json)
  → composer (lib/flow-compose.js)               pure text assembly
  → one agent.steer() with source {kind:'plugin', plugin:'dsh-agent-skills', form:'instructions'}
```

Module boundaries mirror `lib/index.js` + `lib/counts.js`: one file, one job, no
global state, no class hierarchy.

| Module | Responsibility |
|---|---|
| `lib/json-file.js` | Read a JSON file and reject duplicate keys (JSON.parse silently keeps the last one) |
| `lib/skill-catalog.js` | Single enumeration of shipped skill directory names |
| `lib/counts.js` | Derived counts, unchanged semantics (`countSkills`, `countCommands`, `countWorkflowCommands`) |
| `lib/workflows.js` | Workflow definition schema validation + directory loading |
| `lib/skill-contracts.js` | Contract schema validation + loading |
| `lib/flow-select.js` | Request classification → workflow |
| `lib/flow-compose.js` | Pure assembly of the steering message |
| `lib/flow.js` | Engine: selection, stage resolution, optional-skill policy |
| `lib/index.js` | Command registrar: the 9 aliases (unchanged) + `/flow` |

## JSON, not YAML

The host parses YAML with `yaml@2.9.0` from its own `node_modules`. That package
is **not resolvable from this plugin** (verified: `require.resolve('yaml')` from
the plugin root is `MODULE_NOT_FOUND`), and adding it as a dependency is out of
scope. The repo's tests already depend on a checkout-absolute harness path, which
must never become a runtime import. Definitions and contracts are therefore
JSON: parsed by Node itself, no parser to drift, deterministic.

Duplicate keys are the one thing JSON.parse hides, so `lib/json-file.js` detects
them with a `JSON.parse` reviver keyed on the holder object (not a regex scan).

## Data model

`assets/workflows/<name>.json`:

```json
{
  "name": "feature",
  "description": "...",
  "match": { "keywords": ["add", "implement"], "priority": 60 },
  "stages": [
    { "skill": "debugging-and-error-recovery", "required": false, "purpose": "..." }
  ],
  "rules": ["..."],
  "on_optional_missing": "skip",
  "completion": "..."
}
```

| Field | Required | Rule |
|---|---|---|
| `name` | yes | kebab-case, equal to the file stem |
| `description` | yes | non-empty |
| `match` | no | `{ keywords: string[] (non-empty), priority: int }`; unknown keys rejected |
| `stages` | yes | ≥1, each `{ skill, required, purpose? }`; unknown keys rejected; `skill` must be a shipped skill; no skill twice |
| `rules` | no | non-empty strings |
| `on_optional_missing` | no | `"skip"` (default) \| `"error"` |
| `completion` | no | non-empty |

`assets/skill-contracts.json`:

```json
{
  "skills": {
    "spec-driven-development": {
      "produces": ["specification"],
      "consumes": ["user-request"],
      "categories": ["planning"],
      "risk_level": "low"
    }
  },
  "vocabularies": {
    "artifacts": ["user-request", "..."],
    "categories": ["planning", "..."],
    "risk_levels": ["low", "medium", "high"]
  }
}
```

Every shipped skill has exactly one contract entry (same exhaustiveness rule the
repo already enforces for `autonomous-only.json`). Every artifact, category and
risk level comes from the declared vocabulary, so a typo fails at load.

Deliberately **not** in the schema: `prerequisites`, `recommended_after`,
`recommended_before`. Nothing validates or renders them, and a field nothing
reads is a field nobody keeps correct. Ordering lives in the workflow definition,
which is the only place order is meaningful.

## Command behavior

`/flow <request>`:

1. Empty request → `{kind:'error'}` with usage text.
2. Select the workflow (deterministic).
3. Resolve every stage skill through `ctx.skills.get` (same lookup the other
   commands use). A stage is *available* when the catalog returns it **and**
   `isModelInvocable(skill)` is true — a plugin-injected workflow is instructions
   for the agent, so the model-facing policy is the one that applies.
4. Missing **required** stage → `{kind:'error'}` naming the skill and the
   workflow. Nothing is steered.
5. Missing **optional** stage → workflow's `on_optional_missing`: `"skip"`
   (default) drops it and names it under `Skipped`; `"error"` fails the command.
6. Compose one message and call `agent.steer()` exactly once.
7. Return `{kind:'success'}`.

The workflow engine is loaded and validated **once** at `apply()` time. A malformed
definition or contract registry leaves the engine unavailable: the nine alias
commands (which share nothing with the workflow layer) still register, and `/flow`
stays registered while reporting which file and which rule failed. The alternative
— throwing during plugin activation — was rejected because it would take nine
working commands down for a typo in a file they never read. The fail-closed layer
is `npm test`, which validates every shipped asset on each commit, so a green
checkout cannot reach the degraded path.

## Selector

Score = number of distinct keywords of the definition that appear as whole tokens
in the lowercased request. Highest score wins; ties break on `match.priority`
(higher first), then workflow name (ascending). No keyword hit anywhere →
`investigation`, the most conservative generally applicable workflow: understand
before changing. `FALLBACK_WORKFLOW` is a named constant in `lib/flow-select.js`,
validated against the loaded definitions.

Priorities: investigation 100, bugfix 90, migration 80, release 70, feature 60.
Investigation outranks the rest because "why did X break" must never be routed to
a feature build.

## Failure behavior

All failures return the plugin's existing `CommandResult` error shape. No
exception escapes a handler. The loader's errors carry the file name and the
violated rule.

## Test matrix

| Test | Covers |
|---|---|
| `tests/workflow-definitions.test.mjs` | valid load; malformed JSON; duplicate JSON keys; duplicate stages; missing required fields; unknown skill reference; unknown keys; bad `on_optional_missing`; name ≠ stem; vocabulary check |
| `tests/skill-contracts.test.mjs` | every contract key is a shipped skill; every shipped skill has a contract; schema violations; duplicate keys; vocabulary enforcement |
| `tests/flow-select.test.mjs` | every required fixture routes deterministically, fallback, tie-breaks, priority |
| `tests/flow-compose.test.mjs` | header, order, rules, skipped optional stages, verbatim request, no frontmatter duplication, risk annotation |
| `tests/flow-command.test.mjs` | `/flow` registered; steer exactly once; source metadata; required-missing error; optional-missing skip and error policies; empty request |
| existing gates | unchanged |
