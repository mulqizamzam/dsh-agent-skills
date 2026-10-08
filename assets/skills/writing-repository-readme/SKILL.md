---
name: writing-repository-readme
description: Writes or rewrites a repository README from evidence found in the actual files. Use when the owner asks to create a README, write documentation for a repo, make onboarding docs for newcomers, document setup steps for a project, or when an existing README has drifted from the code and must be regenerated from real commands and config.
source: original
---

# Writing a Repository README

## Overview

Produce a README that a newcomer can follow from an empty machine to a running
project, with every command, path, port, and variable traceable to a file in the
repository.

Core principle: **the repository is the only source of truth.** A README is a
report about code that exists, not a description of how the project ought to
work. When the repository does not settle a question, the README says so
explicitly instead of guessing.

## Objective

1. Inventory the repository before writing a single sentence of prose.
2. Write a README whose every factual claim can be traced to a file.
3. Leave the reader with an ordered path from empty machine to working project.
4. Mark every unverifiable detail rather than filling the gap with a plausible
   default.

## Phase 1 — Evidence inventory (do this first, in this order)

Read before writing. Every later claim comes from this pass.

| Target | What to extract |
|---|---|
| `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json` | Runtime, scripts (exact names), dependencies, engines, license |
| Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `poetry.lock`, `uv.lock`) | Package manager actually in use; a lockfile settles this, a README does not |
| `Makefile`, `Taskfile.yml`, `justfile` | Alias commands the project expects people to use |
| `.env.example`, `.env.sample`, `config.example.*` | Every variable name and its documented meaning, with the example value |
| `docker-compose.yml`, `Dockerfile`, `compose.yaml` | Ports, volumes, service names, build args |
| CI configs (`.github/workflows/*.yml`, `.gitlab-ci.yml`) | The commands CI actually runs; these are the project's real contract |
| Test files and test config | Runner, invocation, how pass/fail is reported |
| Deployment config (`vercel.json`, `k8s/`, `fly.toml`, `netlify.toml`, `Procfile`) | Deploy path and required production variables |
| Source tree (top 2 levels) | Framework, entry point, where a newcomer edits |
| `CONTRIBUTING.md`, `AGENTS.md`, `LICENSE`, `NOTICE.md`, `CHANGELOG.md` | Conventions and constraints the README must not contradict |

Record for each item whether it was **found**, **absent**, or **ambiguous**.
Absent means the README omits the section or says the project does not have
one. It never means "assume the default".

## Phase 2 — Classify every claim

Before a sentence reaches the README, it is one of three kinds:

| Kind | Test | Rule |
|---|---|---|
| Observed | Read directly from a file in the repo | Write it, and name the file it came from in the inventory notes |
| Inferred | Reasonable reading of observed evidence | Write it, and phrase it as guidance ("use X"), not fact ("X is the config") |
| Unknown | The repo does not settle it | Write **Perlu dikonfirmasi** plus what is missing |

Never promote inferred to observed because the inference is almost always
right. The one time a README states a fact with no file behind it, it is a bug
in the README.

## Phase 3 — Write, in the reader's order

Order the sections by the journey, not by importance to the author:
install → configure → setup → run → test → use → develop → deploy →
troubleshoot.

Use these sections. Keep each one; drop none silently. When a section has no
content for this project, say so in one line rather than deleting it, so the
reader knows it was considered.

1. **Overview** — what the project is, in two or three sentences. Who it is
   for. The main use case. The headline features, each traceable to a directory,
   script, or endpoint.
2. **Prerequisites** — every tool, with the version actually required
   (`engines.node`, `.nvmrc`, `.tool-versions`, CI matrix). How to check each
   one is installed, with the check command. State the OS requirement if one
   exists. State whether an account, API key, or paid service is needed; say
   "none" explicitly when none is needed, since silence reads as "check the
   docs".
3. **Installation** — start from nothing: clone command, the directory change,
   the install command for the detected package manager, and the first command
   that proves the install worked. Include the environment setup step here.
4. **Configuration** — a table of every variable or config key: name, what it
   does, safe example value, whether it has a default. Values in examples are
   placeholders. A README containing a real API key, password, or token is a
   defect, not a convenience.
5. **Database / External Services** — only when the repo has one. Setup from
   empty, migration, seed, or init commands, quoted from the migration config or
   package scripts. No section if there is no database; do not invent one.
6. **Running the Project** — the exact dev command, the production command, the
   build command, other service commands. What a successful start looks like,
   including the port or URL from the config, and how to open it.
7. **First Use / Quick Start** — one complete worked example from start to
   success: the command, the expected output, and for an API the request and a
   realistic response; for a CLI a real invocation; for a UI the click path.
8. **Project Structure** — the tree with a function for each entry. Mark which
   files a newcomer will edit first.
9. **Common Commands** — grouped: development, testing, build, linting,
   database, deployment. One line each. Copy from the scripts section verbatim;
   do not reword a command.
10. **Testing** — the runner, the command, how success is reported, which test
    types exist based on the files actually present, and what a failure looks
    like.
11. **Troubleshooting** — the errors this repository can actually produce. For
    each: the symptom, the likely cause, the command that checks it, the fix.
    Derive these from real error strings in the code, config, and CI. A generic
    "check your setup" entry is padding; delete it.
12. **Development Guide** — the branch, change, lint, test, review, commit loop
    this project uses, as far as the files show it.
13. **Deployment** — each deployment path the repo supports, step by step, with
    the production environment variables. Recommend the simplest option for a
    newcomer and say why.
14. **Security Notes** — what must never be committed, what the ignore file
    already covers, and the security configuration that matters here. Verify
    against `.gitignore` rather than assuming it is right.
15. **FAQ** — the questions a newcomer actually asks, answered from the repo.
16. **Final Checklist** — an ordered checkbox list from "cloned the repo" to
    "used the project", so a reader can confirm they are done.

## Writing rules

- Copy commands verbatim from scripts, Makefiles, or CI. If a command is not in
  the repository, either derive it from what is there and label it, or leave it
  out.
- Put every command in a fenced code block so it can be copied in one action.
- Wrap inline commands, file names, and paths in backticks.
- Explain a technical term the first time it appears, in the same sentence.
- Give the reason when the reason is not obvious, especially for setup steps
  that look skippable.
- Use tables for anything with more than three parallel items.
- Do not write marketing. No "seamless", "powerful", "cutting-edge", "blazing
  fast", "enterprise-grade". Say what the thing does.
- Do not use an em dash. Write two sentences.
- Do not invent: no version numbers, no ports, no endpoints, no script names,
  no sample output that was not observed.
- Do not describe a command as working when it was not run. If the command could
  not be executed in this environment, that belongs in the unknown list, not in
  the README body as a fact.

## Final verification pass

Before delivering, re-read the README and confirm:

1. Every command in it appears in a real file in the repository.
2. Every file path in it exists, or is clearly labelled as something the reader
   creates.
3. Every environment variable in it appears in `.env.example`, the config
   schema, or the code.
4. Every port and URL in it comes from a config or compose file.
5. Every "test fails this way" statement matches a real error path.
6. The sequence works: nothing in a later section is required by an earlier one.
7. No real secret appears anywhere in the document.

Report to the user: what the README now covers, which sections had no evidence
and were marked **Perlu dikonfirmasi**, and which claims came from inference
rather than a file.

## Common mistakes

| Mistake | Why it fails | What to do instead |
|---|---|---|
| Writing the README from the project name and a mental model | The README describes a project that does not exist | Run Phase 1 before writing a word |
| Copying commands from the upstream project's docs | Versions, flags, and paths drift | Quote this repository's own scripts |
| Guessing a default port | Wrong port means a failed first run | Read it from the compose file or server code, or mark it unknown |
| Listing dependencies without saying how to check them | The reader cannot tell whether setup succeeded | Give the version-check command per dependency |
| A troubleshooting entry that could apply to any project | No diagnostic value | Derive each entry from a real error string in this repo |
| Silently dropping a section because it is empty | The reader cannot tell considered from forgotten | Keep the section with a one-line explanation |
| Example values that look real | Readers paste them, then leak or fail | Use obvious placeholders and say they are placeholders |
| Counting skills, commands, or endpoints from memory | Counts drift silently and other gates break | Count from disk, and check every gate that stores the number |

## Quick reference

| Phase | Action |
|---|---|
| 1 | Read manifests, env examples, compose, CI, tests, deploy config, tree |
| 2 | Tag every fact: observed, inferred, unknown |
| 3 | Write the 16 sections in journey order |
| 4 | Verify every command, path, variable, and port against a file |

Unknown facts get the words **Perlu dikonfirmasi**. They are a deliverable, not
a failure.
