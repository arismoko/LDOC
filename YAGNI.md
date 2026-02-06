Short answer: **you’re keeping way less than you think.**
Long answer: your current repo is already a _full document platform_ — compiler + decompiler + layout engine + custom expression system + Word round-trip tooling + partial LSP — and LDOC v3 only needs about **30–40% of this** to ship something powerful and clean.

I’ll go subsystem by subsystem and be brutally YAGNI/KISS about it.

---

# 🔥 What should absolutely stay (core value)

These align perfectly with the new v3 design.

## ✅ KEEP — Types + diagnostics system

```
src/types/
  diagnostics.ts
  source-location.ts
  tokens.ts
  cst.ts
  document-ir.ts
  symbols.ts
```

Why:
You already did the hard part:

- source ranges
- structured IR
- diagnostic plumbing
- symbol tables

This is gold. Most language projects screw this up early.

👉 Keep and adapt to new syntax.

---

## ✅ KEEP — Lexer + parser (but rewrite grammar rules)

```
src/parse/
  lexer.ts
  parser.ts
  recovery.ts
```

Why:
Your recovery infrastructure is already aligned with the new spec:

- unterminated blocks
- mismatched delimiters
- continuing after error

You’ll mostly:

- change token rules
- simplify grammar
- remove markdown-y stuff
- add `$()` + `@lua{}`

But the architecture is perfect.

👉 Don’t throw this away.

---

## ✅ KEEP — Binder / resolver concept

```
src/bind/
  binder.ts
  resolver.ts
  validator.ts
```

Why:
v3 still needs:

- `@def` symbol table
- scope
- directive lookup
- contract validation

You may simplify, but the phase itself is exactly right.

👉 Keep.

---

## ✅ KEEP — DOCX emitter (mostly)

```
src/emit/docx/
```

Why:
This is the hard real-world work:

- numbering
- styles
- tables
- sections
- Word quirks

LDOC exists to target Word. This is huge leverage.

You’ll refactor to match new IR, but:

👉 80% of this is reusable.

---

# ⚠️ What should be heavily simplified (but not deleted)

## 🔧 Evaluate layer — keep concept, rewrite content

```
src/evaluate/
```

Right now it has:

- custom expression engine
- interpolation
- control flow
- expansion logic

All of this becomes:

👉 replaced by Lua runtime + `$()` + `@lua{}`

You’ll still need:

- value coercion
- context handling
- error surfacing
- sandboxing

But the current logic mostly goes.

Keep folder, replace implementation.

---

## 🔧 Pipeline wrapper

```
src/pipeline/
```

Still useful:
parse → bind → eval → emit is perfect.

Just simpler.

---

# 🗑️ What is pure YAGNI for v3 (throw in the bin for now)

## ❌ Entire decompiler system (huge)

```
src/decompiler/
```

This is a full DOCX → LDOC round-trip engine.

Impressive — but:

❗ Not needed for v3
❗ Massive maintenance surface
❗ Will slow every design decision

Round-tripping is a v5 problem, not a v3 problem.

👉 Delete it from active development.

(Archive it if you’re emotionally attached — it’s solid work.)

---

## ❌ Current control flow system

```
src/evaluate/control-flow.ts
```

You explicitly decided:

- Lua will handle logic
- not custom @if/@for yet

So:

👉 Delete.

---

## ❌ Markdown compatibility layer

Anything handling:

- `# headings`
- `**bold**`
- markdown-ish parsing

You intentionally deferred that.

👉 Delete for now.

You can add sugar later as a desugar pass.

---

## ❌ Fancy shared helpers not used by v3

```
src/shared/
  highlight.ts
  bookmarks.ts
  filters.ts
```

Most of this is from old rendering logic and round-trip tools.

👉 Cull aggressively.

Keep only:

- units
- numbering helpers
- color normalization (maybe)

---

## ⚠️ LSP: keep but simplify hard

```
src/lsp/
```

What to keep:

- diagnostics plumbing
- positions
- basic navigation for `@def`

What to drop initially:

- completion (wait until core stabilizes)
- anything related to old syntax

v3 LSP MVP:
✅ diagnostics
✅ go-to-definition for `@def`
Later: completion

---

# 📊 Rough reality check

### You will probably keep

| Area              | % kept |
| ----------------- | ------ |
| Parser infra      | 80%    |
| Diagnostics/types | 90%    |
| Binder            | 70%    |
| DOCX emitter      | 70–80% |
| Evaluator         | 10–20% |
| Decompiler        | 0%     |
| Old control flow  | 0%     |
| Markdown features | 0%     |

Overall: **~35–45% of repo survives**

Which is excellent — that’s a healthy rewrite, not a total nuke.

---

# ✅ Your new minimal LDOC v3 core (KISS version)

If you stripped today down to essentials:

```
parse/
types/
bind/
evaluate/   (Lua only)
emit/docx/
pipeline/
lsp/ (basic)
cli/
```

Everything else is bonus scope.

---

# 🎯 Brutal but honest advice

You accidentally built a **document platform** when you only needed a **language compiler**.

That’s not bad — it means you learned fast — but now v3 should be:

✔ smaller
✔ clearer
✔ easier to reason about
✔ easier to extend

The new spec already reflects that maturity.

---
