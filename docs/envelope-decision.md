# Task 0 — Is the plugin envelope necessary?

## Verdict: (a) NO — the 27 skills ship fine as a plain directory

DSH discovers skills from fixed filesystem roots. `@deepseek-ai/dsh-skill-filesystem`
is already a row in the **base bundle** (`packages/bundle/base/cordis.patch.yml:241`),
so every profile runs it with default config. Its `roots()` resolves
(`packages/skill/skill-filesystem/src/index.ts:241-261`):

| Rank | Path | Source |
|---|---|---|
| 100 | `<projectRoot>/.dsh/skills` | `project-dsh` |
| 200 | `<projectRoot>/.agents/skills` | `project-agents` |
| 300 | `config.customSkillDirs[]` | `custom` |
| 400 | `$DSH_HOME/skills` | `user-dsh` |
| 500 | `~/.agents/skills` | `user-agents` |

Ranks 100/200/400/500 need no configuration. `customSkillDirs` is exactly what this
repo's plugin uses to point at `assets/skills/`.

## Concrete non-plugin install path

```bash
cp -R assets/skills/* "$DSH_HOME/skills/"
```

No symlink into `node_modules`, no `pnpm add link:`, no host restart. The provider
watches its roots with chokidar and invalidates the catalog on change
(`index.ts:579-588`, `watch: true` default at `index.ts:82`), so new directories
appear live. Any agent then reaches them through the `skill` tool.

**Proof this path is already load-bearing on this machine.** These four skills exist
in `find /home/administrator/deepseek-harness -maxdepth 6 -name <n> -not -path '*/node_modules/*'`
results as **zero hits**, and live only under `$DSH_HOME/skills/`: `antislop`,
`memory-hygiene`, `evidence-labeling`, `no-transfer-fix`. They are in my active
skill catalog this session. Delivered by root 400, with no plugin anywhere.

## What the plugin envelope actually buys

| Capability | Needed for skill delivery? |
|---|---|
| `dsh-skill-filesystem` row + `customSkillDirs` | **No** — base bundle already loads these skills from root 400 |
| `lib/index.js`, 9 slash commands | **Yes** — a command module must be a composed row |
| `providerName: agent-skills` + `includeDefaultRoots: false` | **No** — isolation, not delivery |
| Hardcoded count `N` across 6 files | **No** — a repo-side problem, fixed by Tasks 1-3 |

**The forcing constraint is narrow:** only `lib/index.js` genuinely requires the
plugin model, because DSH has no other way to register a custom command module.
The 27 `SKILL.md` files impose no such constraint — they are content, and DSH
already knows where to find content.

## Cost of switching

Dropping the plugin loses the 9 slash commands. Keeping `lib/index.js` means
keeping the plugin for the commands while the skills ride along on a
`customSkillDirs` row — which is what the repo does today. The alternative
(routing by judgment only) works but removes `/plan`, `/review`, and the rest.

## Note for Tasks 1-10

Tasks 1-9 are all repo-internal quality work and remain valid either way: deriving
the count, generating the README, scaffolding, mutation fixtures, gate-split lock,
routing exhaustiveness, provenance, exit codes, `doctor`. Two need re-scoping under
a non-plugin story:

- **Task 8** exit codes 11/12/13 are all plugin-install failures. They collapse to a
  single "skills not visible in catalog" check.
- **Task 10** resolves `cordis.patch.yml`'s absolute path. Without that file the
  path lives in the install command instead.

**Recommendation:** keep the plugin for the 9 commands, and treat "copy to
`$DSH_HOME/skills/`" as a documented fallback, not the primary story.

## Decision

**Chosen: (b) B2 — keep the plugin envelope intact.** `assets/skills/` stays inside
the plugin and is loaded through `cordis.patch.yml`'s `customSkillDirs` row (root
300), and `lib/index.js` keeps its 9 slash commands. The reason is the isolation
property already listed in the table above: `providerName: agent-skills` plus
`includeDefaultRoots: false` gives these 27 skills their own provider namespace, so
they do not compete for names with the skills already living under
`$DSH_HOME/skills/` (root 400) and the two packaged fallback install paths are
neither the primary story nor needed. The analysis in this document stands as the
reasoning record; Tasks 1-10 proceed exactly as originally specified, including
Task 8's exit codes 11/12/13 and Task 10's `cordis.patch.yml` path resolution.