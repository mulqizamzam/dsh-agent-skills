# NOTICE

This plugin repackages skills from:

**Source repository:** https://github.com/addyosmani/agent-skills
**Copyright:** (c) 2025 Addy Osmani
**License:** MIT

## What was taken

Verified by byte comparison of shipped `assets/skills/*/SKILL.md` against a
fresh shallow clone of upstream at HEAD 1401c8b:

- 25 SKILL.md bodies, shipped verbatim (byte-identical after frontmatter)
- 7 shared reference files (those with two or more consumers in upstream)
- 25 skill directory names, kept as stable compatibility identifiers
- The 9 command-to-skill mappings

## What this plugin added

- 4 original SKILL.md files, written for this plugin and NOT taken from upstream:
  `testing-strategy`, `writing-repository-readme`, `evidence-and-decision-tracking`,
  and `engineering-handoff`. The count above stays at 25 for the ported bodies;
  the shipped catalog is 29 skills total.
- The whole workflow layer: `assets/workflows/*.json`,
  `assets/skill-contracts.json`, `lib/flow*.js`, `lib/workflows.js`,
  `lib/skill-contracts.js`, and the `/flow` command. Nothing in it is taken from
  upstream.

## What was changed

- 6 `description:` values rewritten to fit the host's 400-character catalog
  budget; the other 19 were already under the limit
- 1 description value quoted to fix a YAML compact-mapping hazard in
  `git-workflow-and-versioning`, which would otherwise have made the host
  drop that skill from the catalog without surfacing an error
- Hooks, multi-host manifests, dev scripts, and evals are omitted
- Agents/personas are omitted; `/ship` delegates to the skill body instead
- Commands are implemented as thin `ctx.commands.register()` aliases rather
  than TOML files

## What this plugin does not ship

- `hooks/` - no portable DSH equivalent for SessionStart / PreToolUse / Stop
- `agents/` - only referenced by `/ship`
- `evals/` - upstream TF-IDF runner is host-specific; replaced by the
  structural gate
- `scripts/` - upstream dev-only tooling with no runtime value

## Third-party dependencies

This plugin imports four host packages via symlinked
`node_modules/@deepseek-ai/`:

- `@deepseek-ai/cordis` (v4.0.1)
- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-llm`
- `@deepseek-ai/dsh-skill`

These resolve at load time against the harness workspace checkout.
