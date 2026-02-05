# LDOC Decompiler Refactoring Plan

## Layered Pipeline Architecture

**Branch:** `refactor/decompiler-layered-pipeline`  
**Status:** In Progress  
**Goal:** Clean separation of extraction, semantic analysis, and emission concerns

---

## Problem Statement

The current decompiler mixes three concerns across multiple files:

| Concern | Current Location | Problem |
|---------|-----------------|---------|
| Extraction (XML parsing) | `run.ts`, `paragraph.ts`, `table.ts` | Mixed with markup generation |
| Semantic analysis (grouping, style detection) | `generator.ts`, `paragraph.ts` | Mixed with emission |
| Emission (LDOC syntax) | Everywhere | No single source of truth |

### Key Symptoms

1. **Hard breaks converted too early** - `w:br` → `"  \n"` in `run.ts:465-480`, then `@br` in `paragraph.ts`, but generator needs newlines for indentation
2. **`ParagraphInfo.line` is ambiguous** - Contains raw text OR LDOC markup (`**bold**`, `@style(...)`)
3. **Whitespace normalized 3 times** - `run.ts:21-46`, `paragraph.ts:84-103`, `docx.ts:386-398`
4. **Style wrapping in wrong layer** - `wrapEmphasis()` emits LDOC syntax during extraction

### Failing Fidelity Tests

```
Total: 12, Passed: 0, Failed: 12

Root Causes:
- poa_*: Multi-line content breaks table cell indentation
- dpp_*: Negative character spacing (-2twip) not supported
- cot_POWELL: Trailing whitespace lost during normalization
- will_*: Style usage differs (LegalList vs ListParagraph)
```

---

## Proposed Architecture

```
DOCX XML
    ↓
extraction/  →  semantic/  →  emission/
    ↓              ↓             ↓
ExtractedDoc  SemanticDoc    string[]
```

### Layer 1: Extraction

**Purpose:** Pull raw data from DOCX XML with minimal transformation  
**Location:** `src/decompiler/extraction/`

```typescript
// extraction/types.ts
interface ExtractedRun {
  text: string;              // Raw text (no markup)
  style: RunStyleFlags;      // bold, italic, strike, code, etc.
  font?: string;
  sizePt?: number;
  color?: string;
  characterSpacing?: number; // Can be negative
  hardBreak: boolean;        // Was followed by w:br/w:cr
  tab: boolean;              // Was w:tab
}

interface ExtractedParagraph {
  runs: ExtractedRun[];
  styleId?: string;          // "Heading1", "Normal", etc.
  numbering?: { numId: string; ilvl: number };
  alignment?: "left" | "center" | "right" | "justify";
  indentTwips?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  bookmarks: string[];
  hasPageBreak: boolean;
}

interface ExtractedTable {
  rows: ExtractedTableRow[];
  widths?: number[];
  indent?: number;
  hasBorders: boolean;
}

interface ExtractedDocument {
  body: ExtractedElement[];  // paragraphs, tables, etc.
  headers: Map<string, ExtractedElement[]>;
  footers: Map<string, ExtractedElement[]>;
  layout: LayoutInfo;
  styles: StyleMap;
  numbering: NumberingInfo;
}
```

**Key Rules:**
- Hard breaks stay as `hardBreak: boolean` - NOT converted to `\n`
- No LDOC syntax generated (no `**`, `*`, `@style`, etc.)
- Whitespace normalization happens ONCE here
- Tabs preserved as `tab: boolean` (not `@tab` yet)
- Negative values allowed (character spacing can be negative)

### Layer 2: Semantic

**Purpose:** Apply semantic transformations (classification, grouping, analysis)  
**Location:** `src/decompiler/semantic/`

```typescript
// semantic/types.ts
type SemanticBlock =
  | SemanticHeading
  | SemanticParagraph
  | SemanticList
  | SemanticBlockquote
  | SemanticTable
  | SemanticPageBreak
  | SemanticEmpty;

interface SemanticParagraph {
  type: "paragraph";
  runs: ExtractedRun[];        // Still no markup
  alignment?: "center" | "right";  // Only non-default
  indentTwips?: number;
  isEmpty: boolean;
  anchors: string[];
  // Computed:
  uniformStyle?: "bold" | "italic";
  styleAttrs?: Record<string, string>;  // Differs from dominant
  spacing?: { before?: number; after?: number };
}

interface SemanticGroup {
  type: "group";
  groupType: "align" | "spacing" | "indent" | "style";
  blocks: SemanticNode[];
  // Group-level attributes:
  alignment?: string;
  spacing?: { before?: number; after?: number };
  indent?: number;
  styleAttrs?: Record<string, string>;
}

type SemanticNode = SemanticBlock | SemanticGroup;
```

**Key Rules:**
- Runs still contain raw text (no wrapping)
- Groups are explicit tree nodes
- Empty paragraph detection is definitive here
- Uniform style detection computed here
- Dominant style analysis done here

### Layer 3: Emission

**Purpose:** Format-specific output (LDOC syntax, indentation, escaping)  
**Location:** `src/decompiler/emission/`

```typescript
// emission/types.ts
interface EmissionContext {
  indent: string;            // Current indentation prefix
  dominantStyle: FontSizeStats;
  inTable: boolean;
  inHeaderFooter: boolean;
}

// emission/emitter.ts
function emitDocument(doc: SemanticDocument, ctx: EmissionContext): string[];
function emitBlock(block: SemanticBlock, ctx: EmissionContext): string[];
function emitGroup(group: SemanticGroup, ctx: EmissionContext): string[];

// emission/inline.ts
function emitRuns(runs: ExtractedRun[], ctx: EmissionContext): string;
// ↳ This is where **bold**, *italic*, @style()[], @br, @tab get created
```

**Key Rules:**
- ALL LDOC syntax generation happens here
- Hard break → `"  \n"` or `@br` decision made here
- Tab → `@tab` conversion here
- Indentation managed via context
- Multi-line content properly indented

---

## Migration Path

### Phase 1: Extraction Layer (Current Focus)

**Files to create:**
```
src/decompiler/extraction/
├── types.ts          # ExtractedRun, ExtractedParagraph, etc.
├── run.ts            # extractRuns()
├── paragraph.ts      # extractParagraph()
├── table.ts          # extractTable()
└── index.ts          # Re-exports
```

**Strategy:** Create new extraction without breaking existing code. Old `paragraphToLdoc()` calls new extraction then converts to old `ParagraphInfo` via bridge.

**Success Criteria:**
- `bun test` passes
- New extraction functions have unit tests
- No LDOC syntax in extraction layer

### Phase 2: Semantic Layer

**Files to create:**
```
src/decompiler/semantic/
├── types.ts          # SemanticBlock, SemanticGroup
├── classifier.ts     # heading/list/blockquote detection
├── grouper.ts        # alignment/spacing/indent grouping
├── analyzer.ts       # uniform style detection
└── index.ts
```

**Strategy:** Move grouping logic from `generator.ts` into semantic layer. Returns tree of `SemanticNode` instead of strings.

**Success Criteria:**
- Grouping logic has unit tests
- Generator receives grouped tree (not flat list)

### Phase 3: Emission Layer

**Files to create:**
```
src/decompiler/emission/
├── types.ts          # EmissionContext
├── emitter.ts        # emitDocument()
├── inline.ts         # emitRuns(), wrapEmphasis()
├── block.ts          # emitParagraph(), emitHeading()
├── table.ts          # emitTable()
└── index.ts
```

**Strategy:** Move all LDOC syntax generation here. Delete old converters.

**Success Criteria:**
- All fidelity tests pass
- Clean separation of concerns
- Old `converters/` directory deleted

---

## File Structure After Refactor

```
src/decompiler/
├── index.ts              # Re-exports
├── docx.ts               # Orchestrator (simplified)
├── xml.ts                # XML utilities (unchanged)
├── extraction/
│   ├── types.ts
│   ├── run.ts
│   ├── paragraph.ts
│   ├── table.ts
│   └── index.ts
├── semantic/
│   ├── types.ts
│   ├── classifier.ts
│   ├── grouper.ts
│   ├── analyzer.ts
│   └── index.ts
├── emission/
│   ├── types.ts
│   ├── emitter.ts
│   ├── inline.ts
│   ├── block.ts
│   ├── table.ts
│   └── index.ts
├── parsers/              # (unchanged)
│   ├── layout.ts
│   ├── numbering.ts
│   ├── styles.ts
│   └── footnotes.ts
└── statistics.ts         # (unchanged)
```

---

## Key Design Decisions

### 1. Hard Break Representation

| Stage | Representation |
|-------|----------------|
| Extraction | `ExtractedRun.hardBreak: boolean` |
| Semantic | Preserved on runs |
| Emission | `"  \n"` for normal, `@br` for whitespace-only |

### 2. Inline Style Wrapping

**Emission layer only.** Current `wrapEmphasis()` in `run.ts` moves to `emission/inline.ts`.

### 3. Whitespace Normalization

**Extraction layer only.** Single pass in `extractRuns()`. No further normalization.

### 4. Negative Values

Support negative character spacing in `parseLengthToTwip()` - required for Word documents with condensed text.

### 5. Multi-line Content Indentation

Emission layer handles indentation via `EmissionContext.indent`. All lines of multi-line content get proper prefix.

---

## Testing Strategy

### Unit Tests (New)

```typescript
// tests/decompiler/extraction.test.ts
describe("extractRuns", () => {
  test("extracts runs without markup");
  test("preserves hard break flag");
  test("preserves tab flag");
  test("normalizes whitespace once");
});

// tests/decompiler/semantic.test.ts
describe("groupByAlignment", () => {
  test("groups consecutive centered paragraphs");
  test("preserves empty paragraphs in groups");
});

// tests/decompiler/emission.test.ts
describe("emitRuns", () => {
  test("wraps bold with **");
  test("emits @br for hard breaks");
  test("indents multi-line content");
});
```

### Integration Tests

- Existing `tests/decompiler.test.ts`
- Fidelity harness `bun fidelity/run.ts`

---

## Progress Tracking

- [ ] Phase 1: Extraction Layer
  - [ ] Create `extraction/types.ts`
  - [ ] Create `extraction/run.ts`
  - [ ] Create `extraction/paragraph.ts`
  - [ ] Create `extraction/table.ts`
  - [ ] Add unit tests
  - [ ] Bridge to existing code
- [ ] Phase 2: Semantic Layer
  - [ ] Create `semantic/types.ts`
  - [ ] Create `semantic/classifier.ts`
  - [ ] Create `semantic/grouper.ts`
  - [ ] Create `semantic/analyzer.ts`
  - [ ] Migrate grouping logic
- [ ] Phase 3: Emission Layer
  - [ ] Create `emission/types.ts`
  - [ ] Create `emission/emitter.ts`
  - [ ] Create `emission/inline.ts`
  - [ ] Create `emission/block.ts`
  - [ ] Create `emission/table.ts`
  - [ ] Delete old converters
  - [ ] All fidelity tests pass
