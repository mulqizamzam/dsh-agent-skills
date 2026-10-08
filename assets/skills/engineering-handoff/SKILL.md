---
name: engineering-handoff
description: Produces a compact handoff of the current engineering state for an interrupted session, partial work, review handoff, or human takeover. Use when context is running out, when passing work to another agent or person, or when the reader needs to know what changed, what was verified, and what was not.
---

# Engineering Handoff

## Overview

A handoff is not a summary of effort. It is the state a competent successor needs
to continue the work without re-reading the whole session: what exists now, what
is proven, what is only claimed, and what the next concrete move is.

This skill is for the moment work stops being continuous: the session is running
out of room, the work is partial, a review boundary was reached, or a human is
taking over. Running it is cheap; reconstructing the state from scratch is not.

## When to Use

- The session is ending or about to lose context
- Work stopped partway through a plan or a workflow stage
- Handing a change to a reviewer or to another agent
- A human is taking over and needs the honest picture, not the highlights
- A run that stopped on a blocker and someone else has to unblock it

## The Convention

```
STATUS
- completed / partial / blocked

CHANGED
- files and purpose

VERIFIED
- commands
- tests
- results

NOT VERIFIED
- ...

RISKS
- ...

DECISIONS
- ...

OPEN ITEMS
- ...

NEXT ACTION
- ...
```

## Rules

1. **Status is one of three words, and partial is the honest default.** Work that
   stopped halfway is partial, not completed.
2. **CHANGED names files, not effort.** Every entry says what the file does now
   that it did not do before.
3. **VERIFIED and NOT VERIFIED are separate sections on purpose.** Anything not
   in VERIFIED has not been verified, including things that obviously work.
4. **Never present an assumption as a fact.** If a claim was not executed, it is
   NOT VERIFIED.
5. **RISKS carries real risk**, including the risk that the change is incomplete.
   A handoff with no risks is usually an incomplete handoff.
6. **DECISIONS records why, not just what.** See
   `evidence-and-decision-tracking` for the fuller convention.
7. **NEXT ACTION is one concrete step**, not a menu and not a request for
   instructions. If more than one step is genuinely possible, say which you would
   take and why.
8. **Keep it short.** Every line the successor does not need is a line they have
   to filter out.

## What Each Section Is For

### STATUS

One word plus one line of context. `blocked` names the blocker.

### CHANGED

The working tree as it stands. Include deletions and renames. If nothing changed,
say so — "no files changed" is a valid and useful entry.

### VERIFIED

Commands, tests, results. Each entry pairs what ran with what it produced. A
green badge with no command behind it does not belong here.

### NOT VERIFIED

What a reader might otherwise assume was checked. This is the section that
prevents a successor from trusting a change that was never proven.

### RISKS

What could go wrong because of this state, including blast radius and what is
irreversible.

### DECISIONS

Decisions that would otherwise have to be re-derived, with the alternative that
was rejected.

### OPEN ITEMS

Known unresolved work, with what is needed to resolve it.

### NEXT ACTION

The single next step. One concrete, executable action.

## Worked Shape

```
STATUS
- partial. Workflow engine, /flow command, and both new skills are on disk and
  green in the static suite. Live-host verification has not run.

CHANGED
- lib/index.js — registers /flow next to the nine skill aliases
- assets/workflows/*.json — the five workflow definitions
- assets/skill-contracts.json — composition metadata for every shipped skill

VERIFIED
- npm test → exit 0, 12 gate files
- host FileSystemSkillProvider → 29/29 skills discovered and loaded

NOT VERIFIED
- Behaviour of /flow against the running host. No host restart was performed,
  so the command is not registered there yet.

RISKS
- The composed message carries up to seven rendered skill bodies. Measured
  locally at 94,748 characters for the feature workflow; not measured against a
  live host.

DECISIONS
- One steering message for v1. Rejected: a multi-turn stage machine — no
  installed DSH API exposes one, and inventing it would be a speculative API.

NEXT ACTION
- Restart the host as the operator, then run bash tests/verify-live.sh.
```

## Relationship to Other Skills

`evidence-and-decision-tracking` produces the record this skill compresses.
`code-review-and-quality` consumes a handoff when it reviews someone else's work.
`shipping-and-launch` must not run while a handoff reports `blocked`.
