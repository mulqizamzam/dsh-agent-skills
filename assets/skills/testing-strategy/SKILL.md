---
name: testing-strategy
description: Analyzes a repository end to end and decides which tests should exist, what already covers the code, and what to build first. Use when the owner asks what testing a repo needs, requests a test-strategy or coverage-gap analysis, asks to audit existing tests (redundant/flaky/missing), or wants a prioritized P0/P1/P2 test plan before any test code is written.
source: original
---

# Testing Strategy

## Overview

Analyze the repository thoroughly and determine which tests should exist. This
is an analysis skill: it produces an evidence-backed test plan, not test code.
Do not write or change tests while running it.

## Objective

1. Identify the stack, framework, architecture, and main components of the repository.
2. Map features and high-risk parts of the code.
3. Determine which test types are needed. Consider at minimum:
   - Unit test
   - Integration test
   - API test
   - E2E test
   - Component/UI test
   - Regression test
   - Validation/error-handling test
   - Authentication & authorization test
   - Security test
   - Performance/load test
   - Build, lint, and type-check
4. Do not create tests just because a category exists. Recommend only tests
   that are relevant to this repository.
5. Inspect the tests that already exist and identify:
   - coverage that is already good
   - parts that are untested
   - redundant tests
   - flaky or overly brittle tests
   - edge cases not handled
6. Prioritize tests by:
   - business impact
   - likelihood of bugs
   - code complexity
   - external dependencies
   - regression risk
7. If there is a bug or behavior that is potentially wrong, do not change the
   source code directly. Explain it first and write a test that proves the
   problem.
8. Use the testing patterns and tooling the repository already uses. Do not
   introduce a new framework/library unless it is necessary.

## Output Format

```markdown
## 1. Repository Overview
- Stack:
- Architecture:
- Existing testing setup:
- Test framework:
- CI/CD:

## 2. Existing Tests
| Area | Tests available | Coverage/quality | Gap |
|---|---|---|---|

## 3. Recommended Tests
| Priority | Area/Feature | Test Type | What to Test | Reason |
|---|---|---|---|---|
| P0 | ... | ... | ... | ... |
| P1 | ... | ... | ... | ... |
| P2 | ... | ... | ... | ... |

## 4. Missing Edge Cases
Key edge cases that are not yet tested.

## 5. Test Implementation Plan
The most effective implementation order, starting from P0.

## 6. CI Recommendation
What should run on:
- Pull Request
- Merge to main
- Release/deployment

## 7. Final Assessment
- Testing maturity: Low / Medium / High
- Biggest testing risk:
- Most important missing test:
- Recommended next action:
```

Priority legend:

| Tag | Meaning |
|-----|---------|
| P0 | critical, should be built immediately |
| P1 | important |
| P2 | nice to have |

## Hard Rules

- Do not claim coverage or behavior that cannot be verified from the repository.
- Separate facts found in the codebase, assumptions, and recommendations.
- Do not write dummy tests just to raise coverage.
- Focus on tests that catch real bugs and prevent regression.
- If the repository has no testing infrastructure at all, describe the minimum
  setup required before writing any test.

## Common Mistakes

| Mistake | Why it fails |
|---------|--------------|
| Recommending every test category | A test that does not map to a real risk is noise the maintainer must carry forever. |
| Reporting a coverage number that was never measured | Coverage claims must come from a run of this repository's own tooling, not from reading files. |
| Fixing a suspected bug while analyzing | The fix lands before there is a test proving the bug, so the regression can return silently. |
| Adopting a new test framework for convenience | Two test stacks double the maintenance cost and make CI results harder to read. |
| Calling a test flaky without reproducing the flake | Brittleness is a claim that needs a failing-then-passing run, or it is only a suspicion. |

## Red Flags: stop and re-check

- A recommended test names a category but no concrete behavior to assert.
- "Coverage is probably fine" appears anywhere in the report.
- A gap row is filled with an inference rather than a file you actually read.
- The plan starts at P1 or P2 with no P0 justified by business impact.
- The recommendation requires a tool the repository does not depend on.
