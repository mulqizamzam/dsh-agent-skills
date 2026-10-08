# dsh-agent-skills

A plug-and-drop set of **engineering lifecyle skills** for the DeepSeek Harness (DSH).
It gives your coding agent every ready-made "how to do X" guide plus 9 quick slash
commands, and it drops straight into the host's native skill system with no custom
code to maintain.

This is a DSH-native port of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills),
plus four original skills (`testing-strategy`, `writing-repository-readme`,
`evidence-and-decision-tracking`, `engineering-handoff`) written for this plugin.

The nine alias commands load one guide each. The tenth, `/flow`, runs a whole
**engineering workflow** by composing several guides into one coherent instruction.

---

## Start here — what is this, in plain words?

An AI coding agent is smart but forgetful: every session it re-derives how to plan
a feature, how to write tests, how to review code, and so on. That wastes time and
produces inconsistent work.

**A "skill"** is a written guide the agent can load on demand — think of it as a
checklist or a mini-playbook ("here is how a strong engineer does a code review").
This plugin ships **every one of those guides**, covering the full life of software work:
planning, building, testing, reviewing, and shipping.

**A "command"** is a short shortcut you type in chat to pull in one guide.
Instead of asking the agent in vague words, you type `/review` and the agent loads
the full code-review guide and works from it. There are **10 shortcuts**: nine are
a door into one guide each, and one — `/flow` — runs a whole workflow made of
several guides in the right order.

That is the whole idea. No background daemons, no setup after install: the host
loads the skill files and registers the commands at boot, and you use them.

---

## What is inside

```
dsh-agent-skills/
├── lib/
│   ├── index.js            ← the plugin: registers the 10 slash commands
│   ├── flow.js             ← the workflow engine (resolve + policy)
│   ├── flow-select.js      ← deterministic request → workflow routing
│   ├── flow-compose.js     ← assembles the one steering message
│   ├── workflows.js        ← workflow definition schema + loader
│   ├── skill-contracts.js  ← composition metadata schema + loader
│   ├── json-file.js        ← strict JSON reader (rejects duplicate keys)
│   ├── skill-catalog.js    ← the single shipped-skill enumeration
│   └── counts.js           ← derived counts (single source of truth)
├── assets/
│   ├── skills/            ← one folder per guide (SKILL.md + optional notes)
│   ├── workflows/         ← the 5 workflow definitions (/flow reads these)
│   ├── skill-contracts.json ← how skills compose (produces / consumes / risk)
│   └── references/        ← 7 shared checklists the guides point to
├── cordis.patch.yml        ← tells the host where to find the skills + commands
├── package.json           ← plugin metadata (name, version, dependencies)
├── tests/                 ← the checks that prove it still works (see "Verify")
├── docs/                  ← design record + verification policy
├── NOTICE.md              ← credits to the original author
└── LICENSE                ← MIT
```

- **Every skill** — the guides themselves (listed in full below).
- **10 commands** — nine that load one guide each (`/spec`, `/plan`, `/build`, …)
  and `/flow`, which runs a whole workflow.
- **5 workflow definitions** — what `/flow` can run, and in which order.
- **7 shared references** — checklists that several guides reuse
  (testing patterns, a security checklist, performance tips, etc.).

---

## The commands (your shortcuts)

Type any of these in chat, optionally followed by your request:

| Command | What it loads | Plain meaning |
|---------|---------------|---------------|
| `/spec` | `spec-driven-development` | "Write down a clear plan/spec before coding." |
| `/plan` | `planning-and-task-breakdown` | "Break this big job into small doable steps." |
| `/build` | `incremental-implementation` | "Do it in small, testable slices — not one giant dump." |
| `/test` | `test-driven-development` | "Write the test first, then the code (red-green-refactor)." |
| `/constraints` | `constraint-driven-development` | "Set the quality bar up front and keep it from being quietly lowered." |
| `/review` | `code-review-and-quality` | "Give me a real multi-angle review before this goes in." |
| `/webperf` | `performance-optimization` | "Find and fix the slow parts (pages, queries, databases)." |
| `/code-simplify` | `code-simplification` | "Make this code clearer without changing what it does." |
| `/ship` | `shipping-and-launch` | "Checklist for putting this in front of real users safely." |
| `/flow` | *composes several skills* | "Run a whole engineering workflow — see the next section." |

Example: `/review check my auth changes for security issues`. The agent loads the
full review guide and applies it to your request.

> Not every skill has a shortcut — that is fine. The remaining skills are still
> available; the agent reaches for them on their own when the task fits. The
> aliases just give you the fastest door into the most-used guides.

---

## `/flow` — run a whole workflow, not one guide

`/flow` answers the question the aliases cannot: "what is the right *order* of
engineering steps for this job?" You describe the work in plain words, the plugin
picks the workflow, and the agent receives one instruction that carries the whole
ordered sequence.

```text
/flow implement OAuth login
/flow migrate the API from v1 to v2
/flow investigate why CI started failing
/flow prepare this feature for production
```

### How a request becomes a workflow

```
User Request
     |
     v
/flow command
     |
     v
Workflow Selector          (lib/flow-select.js — deterministic keyword rules)
     |
     v
Workflow Definition        (assets/workflows/<name>.json — the ordered stages)
     |
     v
Skill Contracts           (assets/skill-contracts.json — produces / consumes / risk)
     |
     v
Canonical DSH Skills       (assets/skills/<name>/SKILL.md, loaded through the host)
     |
     v
One Composed Agent Steering Message
     |
     v
DSH Agent
```

Three rules govern that arrow chain, and they are the whole design:

1. **The canonical `SKILL.md` is the source of truth for skill behaviour.** The
   composer never rewrites, summarizes, or reorders a skill body. It embeds the
   host's own `renderSkillContent()` output verbatim, exactly as the `skill` tool
   and the alias commands do. Metadata exists for *composition*, never as a second
   implementation.
2. **The workflow is data, not code.** No workflow is hard-coded in the command
   handler. Adding or reordering a stage is an edit to a JSON file.
3. **One steering message for v1.** The agent, not the plugin runtime, executes
   the stages. Nothing in the installed DSH API promises a multi-turn stage
   machine, so the plugin does not invent one.

### The five workflows

| Workflow | Chosen when the request says… | Stages |
|---|---|---|
| `feature` | add / implement / build / create | *debugging (optional)* → spec → plan → build → test → review → ship (optional) |
| `bugfix` | fix / broken / regression / crash | debugging → test → build → review |
| `investigation` | investigate / why / failing / diagnose | context (optional) → evidence → diagnosis → findings |
| `migration` | migrate / upgrade / deprecate | context (optional) → migration → test → review → ship (optional) |
| `release` | release / deploy / production / ship | review → test → observability (optional) → ship |

Selection is deterministic and explainable: each workflow declares its keywords,
the selector counts which ones appear as whole words in the request, the highest
count wins, and ties break on an explicit `priority`. A request that matches
nothing falls back to `investigation` — the most conservative workflow, because
understanding a change before making it is never the wrong first move.

`bugfix` runs the test step twice on purpose: once to encode the bug before the
fix, once to prove the fix holds. Because a workflow may not list the same skill
twice, the second pass is stated as a workflow rule instead of a second stage.

Optional stages are honest. A missing optional skill is dropped from the sequence
and named under `Skipped`, with the instruction not to claim its output. A missing
**required** skill fails the whole command with an error that names the skill —
steering a workflow whose middle stage is absent would just make the agent invent
the missing guidance.

### Workflow definitions

`assets/workflows/<name>.json`:

```json
{
  "name": "feature",
  "description": "Standard workflow for implementing a new product or engineering feature.",
  "match": { "keywords": ["add", "implement", "build"], "priority": 60 },
  "stages": [
    { "skill": "spec-driven-development", "required": true, "purpose": "Pin the target." }
  ],
  "rules": ["Complete each stage before treating it as complete."],
  "on_optional_missing": "skip",
  "completion": "Done when the review passes and every claim is verified."
}
```

The schema is small on purpose. Validation rejects an unknown key, a missing
required field, a duplicate stage, a skill that is not shipped, and a file whose
`name` does not match its file name. The full rule set is in
`docs/workflow-orchestrator-spec.md`.

### Skill contracts

`assets/skill-contracts.json` answers "what does this skill hand to the next
one?" — one entry per shipped skill:

```json
"spec-driven-development": {
  "produces": ["specification"],
  "consumes": ["user-request"],
  "categories": ["planning"],
  "risk_level": "low"
}
```

The artifacts, categories, and risk levels come from closed vocabularies declared
in the same file, so a typo fails at load instead of quietly creating a second
spelling of the same concept. Every shipped skill has exactly one contract, and
every contract names a shipped skill — the same exhaustiveness rule
`autonomous-only.json` already enforces. Contracts are **not** a skill-discovery
system: the native DSH registry remains authoritative for loading skills.

### Evidence tracking and handoff

Two skills in the catalog exist to make workflow output trustworthy, and both are
usable on their own:

- `evidence-and-decision-tracking` — a small output convention: FACTS,
  ASSUMPTIONS, EVIDENCE, DECISIONS, UNKNOWN, VERIFICATION. Use it where it
  materially helps; never as paperwork on a one-line answer.
- `engineering-handoff` — a compact final state for an interrupted session, a
  partial implementation, or a human takeover: STATUS, CHANGED, VERIFIED, NOT
  VERIFIED, RISKS, DECISIONS, OPEN ITEMS, NEXT ACTION.

The `investigation` workflow runs the first one as a required stage, and
`bugfix` can use it to record the reproduction and the diagnosis.

---

<!-- BEGIN:SKILL-COUNT -->
## All 29 skills
<!-- END:SKILL-COUNT -->

These are the guides in `assets/skills/`. The 9 above are the ones with a shortcut;
the rest the agent uses by judgment.

<!-- BEGIN:SKILL-TABLE -->
**Planning & thinking**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `spec-driven-development` | Creates a structured specification before coding — covering objectives, commands, structure, style, testing strategy, boundaries, and success criteria. Use when starting a new project or feature with ambiguous requirements, when requirements span several independently testable capabilities, or when a spec prevents rework. |
| `planning-and-task-breakdown` | Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible. |
| `idea-refine` | Refines raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. Use when an idea is still vague, when you need to stress-test assumptions before committing to a plan, or when you want to expand options before converging on one. Triggers on "ideate", "refine this idea", or "stress-test my plan". |
| `interview-me` | Extracts what the user actually wants through one-question-at-a-time elicitation until ~95% confidence. Use when a request is underspecified ("build X" without why), when explicitly invoked ("interview me", "grill me"), or when you catch yourself silently filling in ambiguous requirements. |
| `doubt-driven-development` | Subjects every non-trivial decision to fresh-context adversarial review before it stands. Use when correctness matters more than speed, in unfamiliar code, on high-stakes work (production auth, security logic, irreversible migrations), or when a confident output would be cheaper to verify now than debug later. |
| `context-engineering` | Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project. |

**Building**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `incremental-implementation` | Delivers changes incrementally in thin, verifiable slices. Use when implementing any feature or change that touches more than one file, or when picking up the next task from a plan. Use when rolling a change out behind a feature flag, when you're about to write a large amount of code at once, or when a task feels too big to land in one step. |
| `test-driven-development` | Drives development with tests using the red-green-refactor loop. Use when implementing any logic, fixing any bug, or changing any behavior. Use when you need to prove that code works, when a bug report arrives, or when you're about to modify existing functionality. |
| `api-and-interface-design` | Guides stable API and interface design. Use when designing APIs, module boundaries, or any public interface. Use when creating REST or GraphQL endpoints, defining type contracts between modules, or establishing boundaries between frontend and backend. |
| `frontend-ui-engineering` | Builds production-quality, accessible, responsive user-facing UIs. Use when building or modifying interfaces and pages, creating components, implementing layouts, meeting WCAG accessibility requirements, managing state, or when the output needs to look and feel production-quality rather than AI-generated. |
| `source-driven-development` | Grounds every implementation decision in official documentation. Use when you want to verify an approach against the official docs before implementing it, or when you want authoritative, source-cited code free from outdated patterns. Use when building with any framework or library where correctness matters. |

**Quality**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `code-review-and-quality` | Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch. Use when asked to review a diff or a pull request, even when the diff is pasted inline. |
| `code-simplification` | Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity. |
| `constraint-driven-development` | Sets a project-wide quality bar as a written contract and watches diffs for regressions. Use when establishing standards, when tests are being silenced, when an agent keeps skipping checks to get to green, or when you need enforced thresholds for coverage or performance. |
| `testing-strategy` | Analyzes a repository end to end and decides which tests should exist, what already covers the code, and what to build first. Use when the owner asks what testing a repo needs, requests a test-strategy or coverage-gap analysis, asks to audit existing tests (redundant/flaky/missing), or wants a prioritized P0/P1/P2 test plan before any test code is written. |

**Version control**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `git-workflow-and-versioning` | Structures git practices: branching, committing, worktrees, change summaries, and release versioning. Use when making any code change, committing, branching, resolving conflicts, opening or reviewing a PR, or when you need semantic version bumps and changelog entries. |

**Operating & shipping**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `ci-cd-and-automation` | Automates CI/CD pipeline setup. Use when setting up or modifying build and deployment pipelines. Use when you need to automate quality gates, configure test runners in CI, or establish deployment strategies. |
| `observability-and-instrumentation` | Instruments code so production behavior is visible and diagnosable. Use when adding logging, metrics, tracing, or alerting. Use when shipping any feature that runs in production and you need evidence it works. Use when production issues are reported but you can't tell what happened from the available data. |
| `performance-optimization` | Optimizes application performance across frontend, backend, queries, and databases. Use when performance requirements exist, when you suspect performance regressions, when Core Web Vitals or load times need improvement, when N+1 query patterns need fixing, or when profiling reveals bottlenecks. |
| `shipping-and-launch` | Prepares production launches. Use when preparing to deploy to production, or when asking what needs to be in place before shipping. Use when you need a pre-launch checklist, when setting up monitoring, when planning a staged rollout, or when you need a rollback strategy. |
| `browser-testing-with-devtools` | Tests in real browsers via Chrome DevTools MCP. Use when building or debugging anything that runs in a browser. Use when you need to inspect the DOM, capture console errors, analyze network requests, profile performance, or verify visual output with real runtime data. Requires the chrome-devtools MCP server to be configured. |

**Maintaining**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `deprecation-and-migration` | Manages deprecation and migration. Use when removing old systems, APIs, or features. Use when migrating users from one implementation to another. Use when migrating a database schema in production, such as renaming or dropping a column without downtime (expand/contract). Use when deciding whether to maintain or sunset existing code. |
| `security-and-hardening` | Hardens code against vulnerabilities through threat modeling, boundary classification, and OWASP-aligned controls. Use when auditing input handlers, handling user data or authentication, checking a login flow, auditing dependencies, or when privacy compliance is involved. |
| `debugging-and-error-recovery` | Guides systematic root-cause debugging. Use when tests fail, builds break, something that worked yesterday broke, behavior doesn't match expectations, or you encounter any unexpected error. Use when you need to figure out what broke and why — a systematic approach to finding and fixing the root cause rather than guessing. |

**Meta & documentation**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `using-agent-skills` | Discovers and invokes agent skills. Use when starting a session, or when you need to decide which skill or workflow applies to the piece of work at hand. This is the meta-skill that governs how all other skills are discovered and invoked. |
| `documentation-and-adrs` | Records decisions and documentation. Use when you need to document an architecture decision (ADR) or the reasoning behind a design choice, when changing public APIs, shipping features, or when you need to record context that future engineers and agents will need to understand the codebase. |
| `writing-repository-readme` | Writes or rewrites a repository README from evidence found in the actual files. Use when the owner asks to create a README, write documentation for a repo, make onboarding docs for newcomers, document setup steps for a project, or when an existing README has drifted from the code and must be regenerated from real commands and config. |
| `evidence-and-decision-tracking` | Establishes a lightweight convention for separating facts, assumptions, evidence, decisions, unknowns, and verification. Use when a task turns on telling observation apart from interpretation, when an audit or investigation must attach every claim to evidence, or when a decision needs its alternatives and trade-off recorded. |
| `engineering-handoff` | Produces a compact handoff of the current engineering state for an interrupted session, partial work, review handoff, or human takeover. Use when context is running out, when passing work to another agent or person, or when the reader needs to know what changed, what was verified, and what was not. |
<!-- END:SKILL-TABLE -->

---

## How it works under the hood

You do not need this to use the plugin, but it is short and reassuring.

Two lines are added to the host's configuration (`cordis.patch.yml`):

1. **A skill scanner** pointed at `assets/skills/`. The host reads each
   `SKILL.md` and puts every guide into the catalog the agent can reach.
2. **This plugin's `lib/index.js`**, which registers the 10 commands.

When you type `/review`, the command does exactly three small things and nothing
more: it finds the guide by name, checks that it is something a user may call, and
hands the guide's full text to the agent together with whatever you typed. There is
no duplicated logic in the command — the guide is the single source of truth, so
there is one place to edit.

`/flow` is built the same way, one layer up. `lib/index.js` loads and validates the
workflow definitions and the skill contracts **once, at plugin activation**, then
registers a handler that does nothing but classify the request, resolve the stage
skills through the same `ctx.skills.get()` lookup the aliases use, compose the
message, and call `agent.steer()` a single time. If an asset is malformed, the nine
aliases still register — they share nothing with the workflow layer — and `/flow`
stays registered while reporting exactly which file and rule failed.
`npm test` validates every shipped asset on each commit, so a green checkout can
never reach that path.

The message the agent receives is a header (goal, selected workflow, execution
order, workflow rules, definition of done) followed by the ordered skill bodies,
exactly as the host renders them:

```text
WORKFLOW
========

Goal:
implement OAuth login

Selected workflow:
feature — Standard workflow for implementing a new product or engineering feature.

Execution order:
1. spec-driven-development (required) — Write down objectives, boundaries, and success criteria.
   Artifacts: produces specification; consumes user-request.
2. planning-and-task-breakdown (required) — …
…

STAGE 1 of 6: spec-driven-development
Purpose: …

<skill_content name="spec-driven-development">
…
</skill_content>
…

User request:
implement OAuth login
```

There are no background processes to babysit; the host loads everything at startup.

---

## Before you start — do you have what you need?

This plugin does not run on its own. It is a piece that snaps into the
**DeepSeek Harness (DSH)** — a desktop application that gives you an AI coding
agent in the browser. DSH must already be installed, running, and you must have
access to the machine where it lives (terminal / SSH). If you do not have those
three things yet, stop here and install DSH first; this README assumes they
exist.

Checklist before you touch anything in this repo:

| # | Item | How to verify |
|---|------|---------------|
| 1 | **DeepSeek Harness** is installed and running | Open your browser to `http://127.0.0.1:13080`. If you see the DSH web UI, you are good. |
| 2 | **Node.js** ≥ 20 is on the PATH | Run `node --version`. The first two numbers must be `20` or higher. |
| 3 | **pnpm** is installed | Run `pnpm --version`. Any version is fine. |
| 4 | You can run `bash` commands in a terminal | Open a terminal. If `echo hello` prints `hello`, you are set. |
| 5 | You know where DSH keeps its profiles | Run `echo $DSH_HOME`. If it prints a path (e.g. `/home/user/.dsh`), write it down — you will need it in step 3. If it prints nothing, the variable is not set; ask whoever set up the DSH install on this machine. |
| 6 | You know where the DSH harness source lives | This is the repository that contains DSH itself (usually called `deepseek-harness`). Ask whoever set up the machine, or look for a folder named `deepseek-harness` near the repo you are about to clone. You will need its absolute path for step 2. |

If any row is empty, do not proceed — find the missing thing first, then come
back here.

---

## Installation

You install once. Everything after is automatic.

### 1. Get the code

```bash
# Wherever you keep your projects, clone this repo:
git clone https://github.com/mulqizamzam/dsh-agent-skills.git
cd dsh-agent-skills
```

You now have a folder on your machine that contains the plugin source. Keep that
path — you will need it in the next step. We will call it `$PLUGIN_DIR` here
afterwards.

### 2. Link the host packages it depends on

The plugin reads four host packages by name (`cordis`, `dsh-agent`, `dsh-llm`,
`dsh-skill`). Node looks for them in the plugin's own `node_modules`, so a fresh
clone has none and will fail to load until you link them to your harness install:

```bash
# HARNESS = where your DeepSeek Harness checkout lives. Point it at your machine.
# Example: HARNESS=/home/your-user/deepseek-harness
HARNESS=/path/to/deepseek-harness

mkdir -p node_modules/@deepseek-ai
ln -s $HARNESS/vendor/cordis                  node_modules/@deepseek-ai/cordis
ln -s $HARNESS/packages/core/agent            node_modules/@deepseek-ai/dsh-agent
ln -s $HARNESS/packages/llm/llm               node_modules/@deepseek-ai/dsh-llm
ln -s $HARNESS/packages/skill/skill           node_modules/@deepseek-ai/dsh-skill
```

These symlinks are intentionally not committed (`node_modules/` is in
`.gitignore`), because they point at *your* machine's harness. A fresh clone on a
different machine fails to load with `ERR_MODULE_NOT_FOUND` until you recreate
them — that is expected, not a bug.

### 3. Mount the plugin into a profile

The plugin joins the host through the profile's `package.json`
(`dsh.profile.bundles`); you do not hand-edit `cordis.patch.yml`.

```bash
# From outside the DSH sandbox, in the profile you want it in (here: web)
cd $DSH_HOME/profiles/web
pnpm add link:/path/to/dsh-agent-skills
```

If `$DSH_HOME` is not set, supply the full path you found in the prerequisites:

```bash
cd /path/to/your/dsh-home/profiles/web
pnpm add link:/path/to/dsh-agent-skills
```

> Moving the plugin *after* this step? One path assumes the checkout stays where it is.
> See **Limitations, item 1** (`## Limitations (be aware)` below) before relocating it.

### 4. Restart the host

The host reads the new bundle at boot. Restarting is a deliberate operator action
and varies by environment (a `systemctl` unit, a supervisor, a custom restart
script, or simply re-running the host command). Use whatever restart path *your*
deployment uses:

```bash
# Replace with the restart command your environment uses, e.g.
dsh restart            # or: systemctl restart <your-dsh-unit>
# or: bash /path/to/your-restart-dsh.sh
```

### 5. Confirm it is live

Run the verification script that ships with the plugin, relative to the plugin
checkout:

```bash
bash tests/verify-live.sh
```

`exit 0` means the skills and commands are registered in the running host.
If you get a non-zero exit, read the `FAIL` lines it prints — each points at the
specific thing that did not register.

> That is it. On the next chat, `/spec`, `/plan`, `/build`, `/test`,
> `/constraints`, `/review`, `/webperf`, `/code-simplify`, `/ship`, and `/flow` are
> available, and the agent can reach every skill on its own.

---

## Everyday use

```
you>  /spec add a public pin page that shows the image and a 70-155 char description
agent (loads spec-driven-development):   I'll pin down the objective, the data we
                                          need, what "done" looks like, and the
                                          boundaries before writing any code…

you>  /test the new view-counter
agent (loads test-driven-development):   writing the failing test first, then the
                                          handler, then simplifying…

you>  /ship
agent (loads shipping-and-launch):        pre-launch checklist — monitoring in place,
                                          staged rollout, rollback path…

you>  /flow add OAuth login
agent (runs the feature workflow):        spec → plan → build → test → review, with
                                          each guide loaded in order and the
                                          workflow rules carried along…
```

You can also just ask in plain language ("review my changes", "help me plan this
feature") and the agent will reach for the matching skill without you typing the
shortcut. The shortcuts are the fast lane, not the only lane.

---

## Verify it still works

Two levels, cheap to run:

```bash
# 1. Static checks — no host needed. Twelve gates in sequence:
npm test
#   structural.test.mjs        each SKILL.md parses cleanly, names are unique, refs resolve
#   skill-load.test.mjs        each skill survives the real host FileSystemSkillProvider,
#                              plus a mutation probe proving broken files get dropped
#   e2e-handler.test.mjs       4 cases: happy path, missing skill, non-invocable, empty input
#   command-routing.test.mjs   each alias resolves to the right skill; /flow is registered;
#                              the real host registry accepts every definition
#   mutation-gate.test.mjs     7 fixtures, each classified host-loader or structural
#   gates-split.test.mjs       the structural gate and the host loader own separate halves
#                              of the name-vs-directory rule
#   frontmatter-integrity.test.mjs  byte-level frontmatter integrity (host YAML parser)
#   workflow-definitions.test.mjs  valid load, malformed JSON, duplicate keys, duplicate
#                              stages, missing fields, unknown skill reference
#   skill-contracts.test.mjs   every contract is discoverable, schema violations rejected
#   flow-select.test.mjs       the routing table, the fallback, and the tie-breaks
#   flow-compose.test.mjs      ordering, verbatim bodies, skipped stages, request preserved
#   flow-command.test.mjs      /flow end to end: one steer, source metadata, failure paths

# 2. Live check — after a restart, against the running host:
bash tests/verify-live.sh           # exit 0 = all registered
node tests/verify-catalog-live.mjs  # every skill declared on disk, names match directories
```

The static checks use the host's **exact** YAML parser rather than a home-grown
regex, so they catch the kind of mistake that would silently drop a skill from the
catalog with no visible error. `skill-load.test.mjs` goes one step further: it runs
the host's real `FileSystemSkillProvider` against the config shipped in
`cordis.patch.yml`, so it exercises the loader the host actually uses rather than a
re-implementation of it.

The mutation probe inside `skill-load.test.mjs` is part of the gate, not
scaffolding: it is what turns a green run into evidence that the loader rejects
broken files. Keep it, and read `## Limitations` item 2 before touching it.

---

## Where this came from

The 25 ported guides are a faithful port of
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), MIT
licensed, © 2025 Addy Osmani. Full credit is in `NOTICE.md`. In short:

- 25 skill bodies shipped essentially verbatim.
- Four guides are original to this plugin and are not part of the upstream port:
  `testing-strategy`, `writing-repository-readme`, `evidence-and-decision-tracking`,
  and `engineering-handoff`.
- The entire workflow layer (`/flow`, `assets/workflows/`,
  `assets/skill-contracts.json`, `lib/flow*.js`) is original. Upstream has no
  equivalent to port from.
- A few `description` lines were trimmed to fit the host's catalog size limit,
  and one was quoted to fix a YAML hazard that would otherwise have dropped that
  skill silently.
- Upstream extras that do not carry over to DSH (hooks, personas, an eval runner,
  dev-only scripts) are omitted — see `NOTICE.md` for exactly what was and was not
  taken.

The whole plugin is MIT licensed (`LICENSE`).

---

## Limitations (be aware)

Honest about the edges, so nobody is surprised later:

1. **The skill folder path is absolute, and it cannot be made relative.** The host
   resolves `customSkillDirs` with plain `path.resolve()` anchored at its own
   working directory, not the plugin directory
   (`packages/skill/skill-filesystem/src/index.ts:165`, with the schema typed
   `z.array(z.string())` at `:81`), and no path substitution of any kind happens
   when `cordis.patch.yml` is parsed (`packages/boot/app-boot/src/index.ts:320-345`
   — it is a straight `yaml.load`). A relative `assets/skills` therefore resolves
   against wherever the host process was started, which is not the plugin
   checkout. **Consequence:** relocating this checkout requires hand-editing one
   line: the `customSkillDirs` entry in `cordis.patch.yml`, the only absolute
   path in that file. There is no supported plugin-relative form, and no
   installer script can do it for you. Everything else in the plugin is
   portable.

2. **A gate that claims the loader rejects a bad file must first prove it can
   reject one.** `skill-load.test.mjs` carries a mutation probe: it feeds the
   real host provider a file with no frontmatter, a name that fails the
   kebab-case grammar, and frontmatter with no description, and requires all
   three to be dropped while the intact copy still loads. Remove that probe and
   a green run proves nothing. The same test earns its keep the other way too:
   a fourth decoy whose directory name differs from its frontmatter name must
   still load, because the loader takes the name from the frontmatter and the
   "name must equal directory" rule belongs to `structural.test.mjs`. Two gates
   owning the same rule is how one of them quietly stops testing it. The test
   also caught its own bug on day one: comparing the raw `description:` line
   instead of the YAML-parsed value false-failed on the quoted scalar in
   `git-workflow-and-versioning`.
3. **Workflow definitions are JSON, not YAML.** The host parses YAML with
   `yaml@2.9.0` out of its own `node_modules`, and that package is not resolvable
   from inside this plugin (verified: `require.resolve('yaml')` from the plugin
   root fails). Adding it as a dependency to gain a nicer authoring format was
   not worth the new runtime edge, so the definitions are JSON: parsed by Node
   itself, no parser to drift from the host. The trade is a leading comma
   discipline and no comments.
4. **`/flow` composes one message, not a staged runtime.** The installed DSH API
   exposes no hook for a plugin to drive a multi-turn stage machine, so v1 builds
   the best possible single instruction and lets the agent execute the stages.
   A later increment can revisit this only against a real host API, not a hoped-for one.
5. **A composed workflow is a large message.** Measured locally through the
   host's own `renderSkillContent`, the `feature` workflow with all seven stages
   resolves to 94,748 characters. Nothing in the static suite measures how a
   *live* host handles a message of that size, so if a host ever starts
   truncating steering input, a long workflow is the first thing to check.
6. **`/webperf` and `/ship` are guides, not specialists.** They load the
   `performance-optimization` and `shipping-and-launch` guides. The upstream project
   also shipped dedicated "persona" agents for those; this port delegates to the
   guides instead, so you get the checklist but not a separate specialist's
   report format.

None of these block day-to-day use. They are things to know, not bugs to chase.

---

## Adding a skill

One folder, one file: `assets/skills/<name>/SKILL.md`. The first line must be
exactly `---`, and the frontmatter must carry `name` (kebab-case, equal to the
folder name) and `description` with a `Use when` trigger, at most 400
characters. The body stays under 24000 bytes. The host drops anything that
fails those rules with only a warning, so the gates below are what actually
tells you the skill landed.

The count is derived everywhere it is asserted (`lib/counts.js` reads the
catalog, `scripts/gen-readme.mjs` regenerates the two marked README regions), so a
new skill needs exactly two edits and no gate asks you to remember a number:

| # | File | What to change |
|---|------|----------------|
| 1 | `assets/skills/<name>/SKILL.md` | The skill itself. Frontmatter `name` must equal the directory name. |
| 2 | `assets/skill-contracts.json` | One contract entry. `skill-contracts.test.mjs` fails if a shipped skill has none. |

Then regenerate the README table (`npm run readme:gen`). `NOTICE.md` is not one of
the two: it records how many bodies came from upstream (25), which stays constant
unless you port more from upstream; a skill written for this plugin goes under its
`## What this plugin added` section instead.

If the skill should also be a workflow stage, that is a third edit — add it to a
`stages` list in `assets/workflows/<workflow>.json`. Nothing else moves: the stage
is resolved through the host's own catalog by name.

`NOTICE.md` is not one of the six. It records how many bodies came from upstream
(25), which stays constant unless you port more from upstream; a skill written
for this plugin goes under its `## What this plugin added` section instead.

Then verify:

```bash
npm test                      # the full static gate suite
bash tests/verify-live.sh     # after the host has been restarted
```

The rules a new `SKILL.md` must satisfy, all enforced by `structural.test.mjs`:
the first line is exactly `---`, it has both `name` and `description`, `name`
matches the directory name, `description` contains a "Use when" clause and stays
under 400 characters, and the file stays under 24 KB.

Adding a slash command is a separate change. An **alias** for one skill goes
into `COMMAND_SKILL_MAP` in `lib/index.js`; the structural gate keeps that map at
exactly nine entries, so a tenth alias is a deliberate change to that gate too. A
**workflow** command goes into `WORKFLOW_COMMAND_MAP`, and `lib/counts.js` derives
the shipped command total from both maps automatically.

Adding a workflow is the easy case: one new file in `assets/workflows/`. The
definition must carry a unique kebab-case `name` equal to the file stem, at least
one stage, and `match.keywords` so the selector can see it. If the name collides
with the fallback (`investigation`), the selector will no longer have somewhere
to land an unmatched request and the gate says so.

---

## Troubleshooting

### I do not know where my DSH home or harness lives

Common places to look:

| Question | Where to look |
|----------|---------------|
| `$DSH_HOME` | Run `echo $DSH_HOME`. If empty, look for a folder named `.dsh` in your home directory (`ls ~/.dsh`). |
| `profiles/web/package.json` | Inside `$DSH_HOME/profiles/web/package.json`. If the folder does not exist, DSH has not been set up on this machine. |
| `deepseek-harness` source | Look for a repo named `deepseek-harness` somewhere under your home or workspace directory. Common spots: `~/deepseek-harness`, `~/agent-workspace/deepseek-harness`, or wherever you originally cloned it. |
| The web GUI URL | Usually `http://127.0.0.1:13080`. If that page does not load, DSH is not running — start it first. |

If you cannot find any of these on your own, ask whoever installed DSH on this
machine.

### `ERR_MODULE_NOT_FOUND` at load / restart

You skipped step 2. Recreate the four symlinks under `node_modules/@deepseek-ai/`
pointing at *your* harness (step 2 in this guide).

### `verify-live.sh` prints a `FAIL` line

Read which step failed:

| Symptom | Likely cause |
|---------|-------------|
| `web GUI HTTP` FAIL | DSH is not running. Start it and try again. |
| `symlink dsh-agent-skills` FAIL | Step 3 (`pnpm add link:`) was not run or used a wrong path. |
| `modul plugin gagal load` FAIL | Step 2 symlinks are broken — run `ls -la node_modules/@deepseek-ai/` from the plugin dir and confirm all four point to real folders. |
| `package.json` dependency/bundles FAIL | Step 3 did not write to the right profile. Confirm `$DSH_HOME/profiles/web/package.json` exists. |
| `verify-catalog-live` FAIL | A `SKILL.md` is malformed. Run `npm test` to see which one. |

### Exit codes

The `verify-live.sh` script now returns distinct exit codes to identify the failure cause:

| Exit code | Meaning |
|-----------|---------|
| **0** | Everything registered (all checks passed) |
| **10** | DSH web GUI unreachable (host down) |
| **11** | Plugin symlink missing (install step 3 not run) |
| **12** | Plugin module failed to load (step 2 symlinks broken) |
| **13** | Profile `package.json` missing `dependency` or `bundles` entry (step 3 wrong profile) |
| **14** | Catalog count mismatch / malformed `SKILL.md` |

**Precedence rule:** when multiple failures occur simultaneously, the lowest exit code (numerically smallest) is reported. I.e., exit code 10 takes precedence over 11, 12, 13, 14; and 11 takes precedence over 12, 13, 14; etc. This ensures a deterministic single exit code even if more than one check fails.

A step skipped because the profile is absent on this machine does **not** produce a failure code — those steps are simply reported as `PASS` and marked as skipped.

| Symptom | Likely exit code |
|---------|-----------------|
| GUI does not respond at `http://127.0.0.1:13080` | 10 |
| `node_modules/@deepseek-ai/` has no `dsh-agent-skills` symlink | 11 |
| Plugin module cannot be imported from the symlink | 12 |
| `$DSH_HOME/profiles/web/package.json` has no `dependencies.dsh-agent-skills` or `dsh.profile.bundles` does not include `dsh-agent-skills` | 13 |
| `verify-catalog-live.mjs` reports name mismatches or count mismatch | 14 |

If the web profile is absent (fresh clone / CI), steps 1–4 are skipped and the script exits 0 if steps 5–6 also pass, with a note that those checks require a host profile.

### `npm test` fails

The most common cause is a malformed `SKILL.md`. The structural test uses the
host's exact YAML parser and will flag skills whose frontmatter is wrong (first
line must be exactly `---`, must have `name` and `description`). Fix the
offending file and re-run.

### The command does nothing when typed

Confirm the host actually restarted after the mount (step 4). The commands only
register at boot. If you changed `cordis.patch.yml` or the skills folder after
installing, a restart is also needed.

### `/flow` says the workflow assets failed to load

A malformed `assets/workflows/*.json` or `assets/skill-contracts.json` was found
while the plugin booted. The nine alias commands are unaffected. Run `npm test` —
`workflow-definitions.test.mjs` and `skill-contracts.test.mjs` print the file and
the violated rule.

### `/flow` says a required skill is not available

The workflow named in the error could not resolve one of its stages through the
host catalog. Either the skill directory was removed, or another provider won the
name with a `modelInvocable: false` policy. The plugin refuses to steer a workflow
with a hole in it rather than let the agent invent the missing guidance.

---

## In one line

`dsh-agent-skills` gives your DSH agent every engineering guide, ten shortcuts for
the parts of software work you do over and over, and one `/flow` command that runs
a whole workflow in the right order — install it once, restart once, and use the
`/` commands whenever you want a strong engineer's playbook, on demand.
