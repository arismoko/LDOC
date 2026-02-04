# Agent Guide (Repository-Specific)

This repo is a Bun + TypeScript project for compiling/decompiling a "Legal Document DSL" (LDOC) to/from DOCX.

If you are an agent making changes here: follow the commands + conventions below.

## Quick Commands

### Install

- Install deps: `bun install`

### Build

- Build library bundle: `bun run build`
  - Defined in `package.json` as: `bun build src/index.ts --outdir dist --target node`

- Build standalone CLI binary:
  - `bun build --compile --target=bun src/cli/index.ts --outfile /home/ari/.local/bin/ldoc`

### Test

- Run all tests: `bun test`

- Run a single test file:
  - `bun test tests/parser.test.ts`

- Run a single test by name (pattern):
  - `bun test -t "tokenizes variables"`
  - `bun test -t "Parser"`

Notes:
- Tests use Bun's test runner (`import { test, expect, describe } from "bun:test"`).
- Primary suite is `tests/parser.test.ts`.

### Typecheck

- Typecheck (no emit): `bunx tsc -p tsconfig.json`
  - `tsconfig.json` already sets `noEmit: true`.

### Lint / Format

No ESLint/Prettier scripts are currently defined in `package.json`.

- Optional: check Markdown (if you have a markdownlint runner installed):
  - Config: `.markdownlint.yaml` (relaxed rules).
  - Example invocation (one of these, depending on your environment):
    - `bunx markdownlint-cli2 "**/*.md"`
    - `npx markdownlint-cli2 "**/*.md"`

### Run CLI

- Run the CLI entrypoint:
  - `bun run ldoc -- --help`
  - `bun run ldoc -- compile path/to/input.ldoc -o out.docx`
  - `bun run ldoc -- decompile path/to/input.docx -o out.ldoc`

## Subproject: Tree-sitter Grammar

There is a grammar subproject at `tree-sitter-ldoc/`.

- Generate parser: `bun run generate` (runs `tree-sitter generate`)
- Run grammar tests: `bun run test` (runs `tree-sitter test`)

Run from that directory:
- `cd tree-sitter-ldoc && bun install && bun run generate && bun run test`

## Repo Rules (Cursor/Copilot)

- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` were found at the time of writing.

## Code Style (TypeScript)

### TypeScript Configuration Expectations

The repo is intentionally strict:

- `strict: true`
- `noUncheckedIndexedAccess: true` (treat indexed access as possibly undefined)
- `noImplicitOverride: true` (use `override` when overriding methods)
- `moduleResolution: "bundler"` and ESM (`package.json` has `"type": "module"`)
- `verbatimModuleSyntax: true` (do not rely on TS to rewrite imports)

Practical implications:

- Avoid unsafe index access without checks.
- Avoid `any`; prefer `unknown` + narrowing.
- Prefer explicit return types for exported functions.

### Imports

Follow existing patterns (see `src/parser/parser.ts`, `src/compiler/docx.ts`, `tests/parser.test.ts`):

- Order imports:
  1. Third-party packages (e.g. `docx`, `jszip`, `bun:test`)
  2. Node built-ins (e.g. `node:path`) or vice versa; keep it consistent within a file
  3. Internal relative imports (`../...` or `./...`)

- Use `import type { ... }` for type-only imports.
- Avoid unused imports; prefer direct imports over barrel imports unless the barrel is the public API.

### Formatting

There is no enforced formatter config in this repo today; match the existing style:

- 2-space indentation
- Semicolons are used
- Double quotes for strings
- Trailing commas where natural in multiline objects/arrays

When editing a file, keep formatting consistent with nearby code.

### Naming

- Types/interfaces/classes: `PascalCase`
- Functions/variables/methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE` (used for static-ish values)
- Files: existing files are mostly `lowercase` with occasional hyphens; do not rename without a reason

### Error Handling

Prefer explicit, descriptive errors:

- Throw `new Error("...")` with context (line/column, directive name, etc.) when parsing/compiling fails.
- Keep user-facing CLI failures as:
  - `console.error("...", error)` and `process.exit(1)` (see `src/cli/index.ts`).

Avoid swallowing errors; propagate and add context at boundaries.

### Null/Undefined Handling

Given `noUncheckedIndexedAccess`, assume `arr[i]` can be `undefined`.

- In tests, this repo uses a small helper `must<T>(value)` to assert non-nullability (see `tests/parser.test.ts`).
- In production code, prefer:
  - explicit checks (`if (!x) throw ...`)
  - narrowing functions
  - early returns

### Performance / Debugging

Compiler code has some internal tracing patterns; keep logs behind clear prefixes and avoid noisy logs in library code.

### Public API

- `src/index.ts` is the package entrypoint and re-exports parser/compiler/decompiler.
- When adding new exports, consider whether they are part of the public API and keep it stable.

## Testing Conventions

- Place tests in `tests/` with `*.test.ts`.
- Use `describe()` blocks for grouping and `test()` for cases.
- Prefer small, deterministic fixtures under `tests/fixtures/` when needed.

## Change Checklist (for agents)

- Run: `bun test`
- Run targeted test(s): `bun test tests/parser.test.ts -t "<name>"`
- Build: `bun run build`
- Typecheck (if you changed types/public APIs): `bunx tsc -p tsconfig.json`
