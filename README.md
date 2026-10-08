# dsh-agent-skills

A plug-and-drop set of **engineering lifecyle skills** for the DeepSeek Harness (DSH).
It gives your coding agent 27 ready-made "how to do X" guides plus 9 quick slash
commands, and it drops straight into the host's native skill system with no custom
code to maintain.

This is a DSH-native port of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills),
plus two original skills (`testing-strategy`, `writing-repository-readme`) written for this plugin.

---

## Start here — what is this, in plain words?

An AI coding agent is smart but forgetful: every session it re-derives how to plan
a feature, how to write tests, how to review code, and so on. That wastes time and
produces inconsistent work.

**A "skill"** is a written guide the agent can load on demand — think of it as a
checklist or a mini-playbook ("here is how a strong engineer does a code review").
This plugin ships **27 of those guides**, covering the full life of software work:
planning, building, testing, reviewing, and shipping.

**A "command"** is a short shortcut you type in chat to pull in one guide.
Instead of asking the agent in vague words, you type `/review` and the agent loads
the full code-review guide and works from it. There are **9 shortcuts**, each one
just a door into one of the 27 guides.

That is the whole idea. No background daemons, no setup after install: the host
loads the skill files and registers the commands at boot, and you use them.

---

## What is inside

```
dsh-agent-skills/
├── lib/index.js            ← the plugin: registers the 9 slash commands
├── assets/
│   ├── skills/            ← 27 guides, one folder each (SKILL.md + optional notes)
│   └── references/        ← 7 shared checklists the guides point to
├── cordis.patch.yml        ← tells the host where to find the skills + commands
├── package.json           ← plugin metadata (name, version, dependencies)
├── tests/                 ← the checks that prove it still works (see "Verify")
├── NOTICE.md              ← credits to the original author
└── LICENSE                ← MIT
```

- **27 skills** — the guides themselves (listed in full below).
- **9 commands** — shortcuts that load one guide each (`/spec`, `/plan`, `/build`, …).
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

Example: `/review check my auth changes for security issues`. The agent loads the
full review guide and applies it to your request.

> Not every skill has a shortcut — that is fine. The remaining skills are still
> available; the agent reaches for them on its own when the task fits. The 9
> shortcuts just give you the fastest door into the most-used guides.

---

## All 27 skills

These are the guides in `assets/skills/`. The 9 above are the ones with a shortcut;
the rest the agent uses by judgment.

**Planning & thinking**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `spec-driven-development` | You start a feature with fuzzy requirements; pin down objectives, boundaries, and "done" first. |
| `planning-and-task-breakdown` | A task feels too big to start; split it into ordered, doable steps. |
| `idea-refine` | An idea is still vague; stress-test it and sharpen it before committing. |
| `interview-me` | A request is underspecified ("build X" with no why); the agent asks one question at a time until it truly gets it. |
| `doubt-driven-development` | High-stakes or unfamiliar work where a confident-looking answer would be cheaper to check now than to debug later. |
| `context-engineering` | Output quality is slipping or you are switching tasks; tidy what the agent is working from. |

**Building**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `incremental-implementation` | A change touches many files; deliver it in thin, verifiable slices. |
| `test-driven-development` | Adding logic, fixing a bug, or changing behavior — prove it with tests. |
| `api-and-interface-design` | Designing a public API or the boundary between two modules. |
| `frontend-ui-engineering` | Building or fixing user-facing UI that should feel polished and accessible. |
| `source-driven-development` | You want the answer grounded in the official docs, not in guesswork. |

**Quality**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `code-review-and-quality` | Before anything merges; review your own or someone else's changes. |
| `code-simplification` | Code works but is harder to read than it needs to be. |
| `constraint-driven-development` | Standards keep slipping; set a written quality bar and guard it. |
| `testing-strategy` | You need to know what tests a repository should have, and which to write first (original to this pack). |

**Version control**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `git-workflow-and-versioning` | Committing, branching, resolving conflicts, or bumping a release. |

**Operating & shipping**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `ci-cd-and-automation` | Setting up or changing build/deploy pipelines and quality gates. |
| `observability-and-instrumentation` | Making production behavior visible: logging, metrics, tracing, alerts. |
| `performance-optimization` | Fixing slow pages, queries, or regressions (this is what `/webperf` loads). |
| `shipping-and-launch` | The pre-launch checklist, rollout plan, and rollback (this is what `/ship` loads). |
| `browser-testing-with-devtools` | Verifying something that runs in a real browser with live DOM/console data. |

**Maintaining**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `deprecation-and-migration` | Removing an old system or migrating users/data without a painful cutover. |
| `security-and-hardening` | Hardening against vulnerabilities: threat modeling, boundaries, OWASP-aligned controls. |
| `debugging-and-error-recovery` | Something that worked yesterday is broken; find the root cause instead of guessing. |

**Meta & documentation**
| Skill | When the agent reaches for it |
|-------|-------------------------------|
| `using-agent-skills` | The "how do the other skills work" guide; it governs how the rest are discovered. |
| `documentation-and-adrs` | Recording a decision and *why*, so future engineers (and agents) understand. |
| `writing-repository-readme` | Writing or rewriting a README from what the files actually say, not from habit (original to this pack). |

---

## How it works under the hood

You do not need this to use the plugin, but it is short and reassuring.

Two lines are added to the host's configuration (`cordis.patch.yml`):

1. **A skill scanner** pointed at `assets/skills/`. The host reads each
   `SKILL.md` and puts the 27 guides into the catalog the agent can reach.
2. **This plugin's `lib/index.js`**, which registers the 9 commands.

When you type `/review`, the command does exactly three small things and nothing
more: it finds the guide by name, checks that it is something a user may call, and
hands the guide's full text to the agent together with whatever you typed. There is
no duplicated logic in the command — the guide is the single source of truth, so
there is one place to edit.

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
> `/constraints`, `/review`, `/webperf`, `/code-simplify`, and `/ship` are available,
> and the agent can reach all 27 skills on its own.

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
```

You can also just ask in plain language ("review my changes", "help me plan this
feature") and the agent will reach for the matching skill without you typing the
shortcut. The shortcuts are the fast lane, not the only lane.

---

## Verify it still works

Two levels, cheap to run:

```bash
# 1. Static checks — no host needed. Four gates in sequence:
npm test
#   structural.test.mjs     27 SKILL.md parse cleanly, names are unique, refs resolve
#   skill-load.test.mjs     27 skills survive the real host FileSystemSkillProvider,
#                           plus a mutation probe proving broken files get dropped
#   e2e-handler.test.mjs    4 cases: happy path, missing skill, non-invocable, empty input
#   command-routing.test.mjs 9 cases: each command resolves to the right skill

# 2. Live check — after a restart, against the running host:
bash tests/verify-live.sh           # exit 0 = all registered
node tests/verify-catalog-live.mjs  # 27 skills in the live catalog, 9 commands present
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
- The 26th guide, `testing-strategy`, is original to this plugin and is not
  part of the upstream port.
- The 27th guide, `writing-repository-readme`, is also original to this plugin.
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

1. **The skill folder path is absolute** in `cordis.patch.yml`. If you move the
   checkout to a new location, edit that one path. Everything else is portable.
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
3. **When you add a skill, the count moves in six places.** See
   `## Adding a skill` below for the runbook; forgetting one breaks `npm test`
   or this README's own contract.
4. **`/webperf` and `/ship` are guides, not specialists.** They load the
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

Adding one guide touches more files than you would expect, because the catalog
size is asserted in several places. The count lives in six:

| # | File | What to change |
|---|------|----------------|
| 1 | `assets/skills/<nama>/SKILL.md` | The skill itself. Frontmatter `name` must equal the directory name. |
| 2 | `tests/structural.test.mjs` | The `names.length !== N` assertion and its message. |
| 3 | `tests/verify-catalog-live.mjs` | The `declared.size !== N` assertion and its message. |
| 4 | `tests/verify-live.sh` | The human-readable count string. |
| 5 | `package.json` | The `description` field, if it states the number. |
| 6 | `README.md` | The intro count, the `## All N skills` heading, the table row, and the verify-section comments. |

Land the folder and all six edits in one commit: either half alone fails
`npm test` for anyone who checks out that intermediate state.

`NOTICE.md` is not one of the six. It records how many bodies came from upstream
(25), which stays constant unless you port more from upstream; a skill written
for this plugin goes under its `## What this plugin added` section instead.

Then verify:

```bash
npm test                      # all four gates must pass
bash tests/verify-live.sh     # after the host has been restarted
```

The rules a new `SKILL.md` must satisfy, all enforced by `structural.test.mjs`:
the first line is exactly `---`, it has both `name` and `description`, `name`
matches the directory name, `description` contains a "Use when" clause and stays
under 400 characters, and the file stays under 24 KB.

Adding a slash command is a separate change: the name goes into
`COMMAND_SKILL_MAP` in `lib/index.js`, and both `command-routing.test.mjs` and
the count check in `structural.test.mjs` (which fails unless the map holds
exactly nine entries) have to move with it.

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

### `npm test` fails

The most common cause is a malformed `SKILL.md`. The structural test uses the
host's exact YAML parser and will flag skills whose frontmatter is wrong (first
line must be exactly `---`, must have `name` and `description`). Fix the
offending file and re-run.

### The command does nothing when typed

Confirm the host actually restarted after the mount (step 4). The commands only
register at boot. If you changed `cordis.patch.yml` or the skills folder after
installing, a restart is also needed.

---

## In one line

`dsh-agent-skills` gives your DSH agent 27 engineering guides and 9 one-word
shortcuts for the parts of software work you do over and over — install it once,
restart once, and use the `/` commands whenever you want a strong engineer's
playbook, on demand.
