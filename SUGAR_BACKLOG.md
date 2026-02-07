# Sugar and UX Backlog (Non-Normative)

This file tracks potential language sugar and UX improvements that are explicitly out of scope for v3 core.

Use this backlog for planning only. Core guarantees remain in `LDOC-V3-SPEC.md`.

## Status legend

- `candidate`: idea exists, no implementation commitment
- `planned`: implementation intended, not yet started
- `deferred`: intentionally postponed
- `ready-for-spec`: implementation + diagnostics behavior are clear enough to standardize

## Acceptance requirements before promotion to spec

Each item must define:

- exact syntax and desugaring target
- parser recovery and diagnostics behavior
- evaluator/binder scope interactions
- at least one IR-level test and one OOXML-level test

## Backlog items

| ID | Status | Theme | Proposal | Notes |
| --- | --- | --- | --- | --- |
| SG-001 | deferred | include params | typed params for `@params` (e.g. `name: "string?"`) | v3 core keeps `@params(names: [...])` |
| SG-002 | deferred | args expressions | allow direct `$(...)` inside args objects | requires clear value-context evaluation rules |
| SG-003 | candidate | alignment sugar | `@center{...}`, `@right{...}` shorthand for `@align(value: ...)` | parser-level sugar only |
| SG-004 | candidate | emphasis sugar | markdown-style `**bold**`, `_italic_` as pure desugar | must not degrade diagnostics precision |
| SG-005 | candidate | table UX | explicit `@cell(...)` form for literal `">"` and `"^"` values | mentioned as optional in spec |
| SG-006 | planned | diagnostics UX | unknown directive suggestions (did-you-mean) | Levenshtein threshold + stable ordering |
| SG-007 | candidate | header/footer UX | clearer diagnostics for region misuse (`@left`/`@right`) | include fix-it hints in LSP |
