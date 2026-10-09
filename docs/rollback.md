# Rollback for 0.2.1

The release under test is `0.2.1`. It changes runtime behaviour, not just docs:
`lib/workflows.js`, `lib/skill-contracts.js`, `lib/flow-compose.js`,
`lib/index.js`, `assets/workflows/release.json` and `tests/verify-live.sh` all
differ from `0.2.0`, so reverting is a code rollback, not a docs revert.

## What a rollback restores

Rolling back to `0.2.0` restores these four defects, all confirmed with a
reproduction before the fix:

1. `release` shipped the keywords `go` and `live`. `/flow implement dark mode
   and go over the edge cases` scored 1 on `implement` (feature) and 1 on `go`
   (release), the tie broke on priority (release 70 > feature 60), and the
   request was routed to a workflow with no spec, planning, or implementation
   stage.
2. `lib/index.js` spread caller config over `COMMAND_SKILL_MAP`, so a config key
   named `flow` registered the command twice. The host throws on a duplicate
   command name (`packages/interaction/commands/src/index.ts:93-95`), the throw
   escaped `apply`, and the nine alias commands were lost with it.
3. A registry whose `vocabularies` object was missing one of `artifacts`,
   `categories`, `risk_levels` crashed with a `TypeError` instead of failing
   closed with a message.
4. `tests/verify-live.sh` printed FAIL and still exited 0. Measured: with
   `countTotalCommands()` returning NaN the script printed
   `FAIL lib/counts.js countTotalCommands() tidak menghasilkan angka: 'NaN'` and
   ended `RESULT: PASS` with exit 0, so the operator's post-restart gate could
   report success on a red run.

## The rollback command

```bash
git -C /home/administrator/agent-workspace/project/dsh-agent-skills revert --no-edit <0.2.1 sha>..<0.2.0 sha>
```

Then restart the host. Command registration happens at boot, so a reverted
`lib/index.js` is not live until the process restarts. Restarting
`/home/administrator/restart-dsh.sh` is the operator's action, not the agent's.

## Rehearsal (2026-10-09, throwaway clone, nothing pushed)

Rehearsed against the same command for the 0.2.0 rollback target, in a clone
under `/tmp` that was removed in the same shell call:

```
fetch+checkout exit 0
784548e feat: engineering workflow orchestrator v1 (/flow)
revert_apply_exit=0            # git revert --no-commit a52e44a..784548e
diff_empty_exit=0             # git diff a52e44a after the revert: no output
COMMAND_SKILL_MAP entries at a52e44a = 9
has WORKFLOW_COMMAND_MAP = false
workflows dir present = false
```

The revert applies with no conflict, and the resulting tree is identical to the
pre-release commit: 9 commands, no `/flow`, no workflow assets. That is the
state a rollback returns to.

## Recovery if a revert lands while the host is running

The host keeps the command set it registered at boot until it restarts, so a
revert alone changes nothing visible. Order:

1. `bash tests/verify-live.sh` — expect exit 0 with the pre-revert gate set.
2. Restart the host (operator).
3. `bash tests/verify-live.sh` again — the counts and gates must match the
   reverted tree, not the one just replaced.

## What is not covered

- No rehearsal against the live host: reverting in a clone proves the merge
  mechanics, not that the host boots the old tree. Restart verification is the
  operator's step.
- No database, migration, or state exists to roll back; this plugin ships files.
