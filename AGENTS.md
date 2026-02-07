# AGENTS.md — Code Review Policy

## Severity Classification

- **P0 (Critical)**: DRY violations, dead code, YAGNI violations. Fix immediately — these rot the codebase.
- **P1 (High)**: Correctness bugs, spec violations, silent failures. Fix before merge.
- **P2 (Medium)**: Edge cases, inconsistent behavior, missing validation. Fix in same PR if scope allows.
- **P3 (Low)**: Style, naming, documentation. Fix opportunistically.

## Review Principles

1. **Flag architectural issues even if fixing them requires breaking changes.** Do not suppress findings because the fix is hard. Name the problem, describe the ideal fix, and let the author decide scope.

2. **Dead code is a P0.** Exported symbols with zero consumers, unreachable branches, and vestigial modules must be flagged. Dead code misleads future readers and hides real dependencies.

3. **DRY violations are a P0.** Duplicated logic (even across phase boundaries) must be consolidated. If two functions do the same thing with different names, that is a bug waiting to happen.

4. **YAGNI violations are a P0.** Code that exists "in case we need it later" without a current consumer is dead weight. Forward declarations are acceptable only if they are tiny (<10 lines) and documented with a reference to the planned consumer (e.g., a git-journal PR number).

5. **Spec divergence is a P1.** If the implementation contradicts the spec, flag it — even if the current behavior "works." The spec is the contract.

6. **Type safety gaps are a P1.** Unsafe casts (`as any`, `as Record<string, unknown>` without validation), unhandled union variants, and missing exhaustiveness checks must be flagged.

7. **Prefer breaking changes over workarounds.** If the correct fix changes a public type or IR shape, propose it. Workarounds that preserve a broken interface accumulate tech debt.

## What to Review

- All changed files in the PR diff.
- Files adjacent to changes (same module) for DRY/consistency.
- Type definitions touched by the PR for soundness.
- Test coverage: new behavior must have tests; changed behavior must update tests.

## What NOT to Do

- Do not approve a PR just because tests pass. Tests can be incomplete.
- Do not defer P0/P1 issues to "a future PR" unless there is a tracked issue or git-journal entry.
- Do not suggest style-only changes as blocking. Use P3.
