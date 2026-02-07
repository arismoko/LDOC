# AGENTS.md — Code Review Policy

## Severity Classification

- **P0 (Critical)**: DRY violations, dead code, YAGNI violations. Fix immediately — these rot the codebase.
- **P1 (High)**: Correctness bugs, spec violations, silent failures, data loss, silently dropped user input. Fix before merge.

## Review Principles

1. **Flag architectural issues even if fixing them requires breaking changes.** Do not suppress findings because the fix is hard. Name the problem, describe the ideal fix, and let the author decide scope.
2. **Prefer breaking changes over workarounds.** If the correct fix changes a public type or IR shape, propose it.
