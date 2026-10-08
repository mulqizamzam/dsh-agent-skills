---
name: evidence-and-decision-tracking
description: Establishes a lightweight convention for separating facts, assumptions, evidence, decisions, unknowns, and verification. Use when a task turns on telling observation apart from interpretation, when an audit or investigation must attach every claim to evidence, or when a decision needs its alternatives and trade-off recorded.
---

# Evidence and Decision Tracking

## Overview

Most wrong engineering answers are not wrong about the code. They are wrong about
what is known: an assumption gets promoted to a fact halfway through a response,
a plausible cause gets reported as the cause, and a number that was never
measured is presented as measured.

This skill is a convention for output, not a process to run. It gives the agent a
small, fixed vocabulary for labelling its own claims, so a reader can tell in one
glance which parts of a report rest on evidence and which parts are still open.

Use it where it helps. Do not turn every trivial statement into paperwork.

## When to Use

- An investigation, audit, or incident review where conclusions must be defensible
- Any report containing numbers, pass/fail claims, or confidence levels
- A decision with real alternatives and a non-obvious trade-off
- A handoff, where the next reader needs to know what was proven and what was not
- A session that has been running long enough that "I remember reading it" has
  started substituting for checking

Do not use it for one-line answers, for restating what the user just said, or for
mechanical edits the user already verified.

## The Convention

```
FACTS
- Directly supported by something observed or executed this session.

ASSUMPTIONS
- Believed but not proven. Always paired with what would prove or disprove it.

EVIDENCE
- source/file/test/command
- what it proves

DECISIONS
- decision
- alternatives considered
- rationale
- trade-off

UNKNOWN
- Explicitly unresolved. Not a placeholder for "I did not look".

VERIFICATION
- what was tested
- result
```

## Rules

1. **Never present an assumption as a fact.** If it was not observed or executed,
   it goes under ASSUMPTIONS or UNKNOWN.
2. **Distinguish observation from interpretation.** "The test exits 1" is an
   observation. "The parser is broken" is an interpretation of it.
3. **Attach claims to repository evidence when possible.** A file path, a command,
   a test name, a line number. A claim with no pointer is an assumption.
4. **Record important decisions with their alternatives.** A decision without the
   rejected option cannot be reviewed later.
5. **Track unknowns explicitly.** An unknown that is named can be resolved; an
   unknown that is hidden becomes a defect.
6. **Unmeasured is unmeasured.** Write "not determined" rather than an estimate
   that looks like a measurement.
7. **Do not pad.** If a section has nothing real in it, drop the section. An empty
   `UNKNOWN` header is noise; an empty report is not evidence.

## What Each Section Is For

### FACTS

Statements a reader could re-check themselves and get the same answer. Includes
negative results: "no reference to this symbol exists in the inspected files" is
a fact about what was inspected, and it must name what was inspected.

### ASSUMPTIONS

The honest home for everything you are taking on trust. Two properties make an
assumption useful: it is stated, and the cost of being wrong is stated. If the
cost is high and the assumption is load-bearing, that is a signal to verify it
before continuing.

### EVIDENCE

The pointer, not the argument. One line for the source, one line for what it
proves. Anything that cannot be re-run or re-read does not belong here.

### DECISIONS

A decision is a choice among alternatives. Recording only the chosen option makes
the record useless for the next person, because they cannot tell whether the
alternative was considered and rejected or never seen.

### UNKNOWN

What you looked for and did not find, plus what you did not look for at all.
These are different and both belong here.

### VERIFICATION

The commands actually run and what actually happened. "Tests pass" without a
command and its output is not verification.

## Worked Shape

```
FACTS
- `lib/flow-select.js` matched "implement" to the feature workflow.
- The /flow handler called agent.steer once.

ASSUMPTIONS
- The installed catalog resolves every stage skill. Checked for feature; not
  checked against a live host.

EVIDENCE
- tests/flow-command.test.mjs
- one steer, source.kind === "plugin", 7 rendered skill blocks in order

DECISIONS
- One steering message for v1, no multi-turn stage machine.
- Alternatives: a staged runtime loop; the installed DSH API exposes no such hook.
- Trade-off: the agent, not the plugin, owns stage transitions.

UNKNOWN
- Whether a live host accepts the composed message size. Not measured.

VERIFICATION
- npm test → exit 0, 9 gate files green
```

## Relationship to Other Skills

`debugging-and-error-recovery` produces the diagnosis; this skill produces the
record of how it was reached. `documentation-and-adrs` persists decisions beyond
the session; this skill captures them while they are still fresh.
`engineering-handoff` consumes this record and renders final state.

Workflows in `assets/workflows/` reference this skill by name. The workflow
definitions and `assets/skill-contracts.json` describe how it composes with other
skills; the canonical `SKILL.md` files remain the source of truth for what each
skill says.
