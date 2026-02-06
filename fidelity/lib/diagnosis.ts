/**
 * Stage diagnosis - identify WHERE in the pipeline issues occur
 *
 * Pipeline: Original DOCX -> Decompiler -> LDOC -> Parser -> CST -> Evaluator -> Document -> Emitter -> Recompiled DOCX
 */

import type { StageDiagnosis } from "./checks/types";
import type { CSTDocument, CSTNode, CSTInline, CSTListItem, CSTTableRow, CSTTableCell } from "../../src/types/cst";
import type { Document, Block, Inline, ListItem, TableRow, TableCell } from "../../src/types/document-ir";

export interface ParagraphCounts {
  original: number;
  cst: number;
  document: number;
  recompiled: number;
}

/**
 * Count paragraph-generating elements in LDOC source text.
 * This is an approximation - counts lines that would generate paragraph nodes.
 * 
 * Note: This is inherently imprecise since we can't know paragraph boundaries
 * without parsing. For better accuracy, compare original -> AST -> recompiled.
 */
export function countLdocParagraphs(ldocSource: string): number {
  const lines = ldocSource.split("\n");
  let count = 0;
  let inPreamble = true; // Skip @document block at start
  let inHeaderFooter = false;
  let inContinuation = false; // Tracks if previous line ended with hard break (two trailing spaces)
  
  // Pure structural directives that don't create content paragraphs
  const structuralDirectives = new Set([
    "@br", "@end", "@pagebreak"
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    
    // Detect @document block and skip its YAML-like content
    if (trimmed === "@document") {
      inPreamble = true;
      continue;
    }
    if (inPreamble) {
      // Still in preamble while lines are indented (part of @document block)
      if (line.startsWith("  ") || !trimmed) {
        continue;
      }
      // Non-preamble content - we're out
      inPreamble = false;
    }
    
    // Track @header/@footer blocks
    if (trimmed.startsWith("@header") || trimmed.startsWith("@footer") ||
        trimmed.startsWith("@firstpage @header") || trimmed.startsWith("@evenpage @header") ||
        trimmed.startsWith("@firstpage @footer") || trimmed.startsWith("@evenpage @footer")) {
      inHeaderFooter = true;
      continue;
    }
    if (trimmed === "@end" && inHeaderFooter) {
      inHeaderFooter = false;
      continue;
    }
    // Skip content inside header/footer blocks for body count
    if (inHeaderFooter) {
      continue;
    }
    
    // Skip structural directives
    if (structuralDirectives.has(trimmed)) {
      continue;
    }
    
    // Skip @end outside header/footer context
    if (trimmed === "@end") {
      continue;
    }
    
    // Skip structural block directive declarations (but their content will be counted)
    if (trimmed.match(/^@(document|table|row|cell|columns)/)) {
      continue;
    }
    
    // Skip empty lines
    if (!trimmed) {
      inContinuation = false;
      continue;
    }
    
    // Skip comment lines
    if (trimmed.startsWith("//")) {
      continue;
    }
    
    // Skip YAML frontmatter markers
    if (trimmed === "---") {
      continue;
    }
    
    // Skip table cell syntax in inline form
    if (trimmed.startsWith("|") || trimmed.startsWith("||")) {
      const cellMatches = trimmed.match(/\|[^|]+/g) || [];
      count += cellMatches.filter(c => c.trim() !== "|").length;
      inContinuation = false;
      continue;
    }
    
    // If previous line ended with hard break (two trailing spaces),
    // this line is a continuation, not a new paragraph
    if (inContinuation) {
      inContinuation = line.endsWith("  ");
      continue;
    }
    
    // Inline directives like @tab, @nbsp don't create paragraphs on their own
    if (trimmed === "@tab" || trimmed === "@nbsp") {
      // But if they're alone on a line, they're in a paragraph context
      // The paragraph was already counted from a previous line
      continue;
    }
    
    // Style directives without content don't create paragraphs themselves
    // But style directives WITH inline content do: @style(...)[content] or @bold: text
    if (trimmed.match(/^@(style|bold|italic|underline)\b/)) {
      // Check if it has inline content in brackets or after colon
      if (trimmed.includes("[") && trimmed.includes("]")) {
        count++;
        inContinuation = line.endsWith("  ");
      } else if (trimmed.match(/^@\w+:\s*\S/)) {
        count++;
        inContinuation = line.endsWith("  ");
      }
      // Block form - content on next lines will be counted
      continue;
    }
    
    // Headers (# ## ### or @h1/@h2 etc) each produce a paragraph
    if (/^#{1,6}\s/.test(trimmed)) {
      count++;
      inContinuation = line.endsWith("  ");
      continue;
    }
    if (trimmed.match(/^@h[1-6]\b/)) {
      // @h1 blocks count as 1 paragraph (the content inside will be merged)
      count++;
      inContinuation = line.endsWith("  ");
      continue;
    }
    
    // List items each produce a paragraph
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      count++;
      inContinuation = line.endsWith("  ");
      continue;
    }
    
    // Regular content line - this starts a new paragraph
    count++;
    inContinuation = line.endsWith("  ");
  }

  return count;
}

/**
 * Count paragraph-like nodes in AST.
 * Counts: paragraph, empty_paragraph, header, numbered_item, bullet_item, blockquote (as container)
 */
export function countCstParagraphs(cst: CSTDocument): number {
  let count = 0;

  function countInline(inline: CSTInline): void {
    if (inline.type === "InlineDirective") {
      for (const child of inline.content) {
        countInline(child);
      }
    }
  }

  function countNode(node: CSTNode | CSTListItem | CSTTableRow | CSTTableCell): void {
    switch (node.type) {
      case "Paragraph":
      case "Header":
        count++;
        return;
      case "ListItem":
        count++;
        for (const child of node.content) {
          countInline(child);
        }
        for (const child of node.children) {
          countNode(child);
        }
        return;
      case "List":
        for (const item of node.items) {
          countNode(item);
        }
        return;
      case "Blockquote":
        for (const child of node.content) {
          countNode(child);
        }
        return;
      case "Table":
        for (const row of node.rows) {
          countNode(row);
        }
        return;
      case "TableRow":
        for (const cell of node.cells) {
          countNode(cell);
        }
        return;
      case "TableCell":
        for (const child of node.content) {
          countNode(child);
        }
        return;
      case "FootnoteDef":
        for (const child of node.content) {
          countNode(child);
        }
        return;
      case "Directive":
        for (const child of node.body ?? []) {
          countNode(child);
        }
        return;
      default:
        return;
    }
  }

  for (const node of cst.children) {
    countNode(node);
  }

  return count;
}

export function countDocumentParagraphs(document: Document): number {
  let count = 0;

  function countInline(inline: Inline): void {
    if (inline.type === "Styled" || inline.type === "Bold" || inline.type === "Italic" ||
        inline.type === "Underline" || inline.type === "Strikethrough" || inline.type === "Highlight") {
      for (const child of inline.content) {
        countInline(child);
      }
    }
  }

  function countBlocks(blocks: Block[]): void {
    for (const block of blocks) {
      switch (block.type) {
        case "Paragraph":
        case "Heading":
          count++;
          for (const child of block.content) {
            countInline(child);
          }
          break;
        case "List":
          for (const item of block.items) {
            countListItem(item);
          }
          break;
        case "Blockquote":
          countBlocks(block.content);
          break;
        case "Table":
          for (const row of block.rows) {
            countTableRow(row);
          }
          break;
        case "Section":
          countBlocks(block.content);
          break;
        case "Footnote":
          countBlocks(block.content);
          break;
        case "PageBreak":
        case "ColumnBreak":
        case "HorizontalRule":
          count++;
          break;
      }
    }
  }

  function countListItem(item: ListItem): void {
    count++;
    for (const child of item.content) {
      countInline(child);
    }
    countBlocks(item.children);
  }

  function countTableRow(row: TableRow): void {
    for (const cell of row.cells) {
      countTableCell(cell);
    }
  }

  function countTableCell(cell: TableCell): void {
    countBlocks(cell.content);
  }

  countBlocks(document.blocks);
  return count;
}

/**
 * Diagnose which pipeline stage is likely causing issues based on paragraph counts.
 * 
 * Compares: original DOCX → AST → recompiled DOCX
 * 
 * Note: We skip LDOC counting in diagnosis because counting paragraphs in LDOC source
 * is inherently imprecise without actually parsing it. The AST count is accurate
 * since it comes from the parser.
 */
export function diagnoseStage(counts: ParagraphCounts): StageDiagnosis {
  const { original, cst, document, recompiled } = counts;

  if (cst !== original) {
    const diff = cst - original;
    const direction = diff > 0 ? "added" : "lost";
    return {
      likely_stage: "decompiler",
      confidence: "medium",
      evidence: `Paragraph count diverges at CST: ${original} -> ${cst} (${Math.abs(diff)} ${direction})`,
      paragraph_counts: counts,
      first_divergence: {
        stage: "decompiler",
        paragraph_index: Math.min(original, cst),
        detail: `Decompiler/Parser ${direction} ${Math.abs(diff)} paragraph(s)`,
      },
    };
  }

  if (document !== cst) {
    const diff = document - cst;
    const direction = diff > 0 ? "added" : "lost";
    return {
      likely_stage: "evaluator",
      confidence: "medium",
      evidence: `Paragraph count diverges at Document IR: ${cst} -> ${document} (${Math.abs(diff)} ${direction})`,
      paragraph_counts: counts,
      first_divergence: {
        stage: "evaluator",
        paragraph_index: Math.min(cst, document),
        detail: `Evaluator ${direction} ${Math.abs(diff)} paragraph(s)`,
      },
    };
  }

  if (recompiled !== document) {
    const diff = recompiled - document;
    const direction = diff > 0 ? "added" : "lost";
    return {
      likely_stage: "emitter",
      confidence: "high",
      evidence: `Paragraph count diverges at recompiled: ${document} -> ${recompiled} (${Math.abs(diff)} ${direction})`,
      paragraph_counts: counts,
      first_divergence: {
        stage: "emitter",
        paragraph_index: Math.min(document, recompiled),
        detail: `Emitter ${direction} ${Math.abs(diff)} paragraph(s)`,
      },
    };
  }

  return {
    likely_stage: "unknown",
    confidence: "low",
    evidence: "Paragraph counts match but content differs - need deeper analysis",
    paragraph_counts: counts,
  };
}

/**
 * Format paragraph count chain for display.
 * Example: "39 → 41 → 40" (original → AST → recompiled)
 * 
 * Note: LDOC count is omitted as it's imprecise without parsing.
 */
export function formatCountChain(counts: ParagraphCounts): string {
  const { original, cst, document, recompiled } = counts;
  return `${original} → ${cst} → ${document} → ${recompiled}`;
}

/**
 * Get emoji for stage
 */
export function getStageEmoji(stage: StageDiagnosis["likely_stage"]): string {
  switch (stage) {
    case "decompiler":
      return "\u{1F527}"; // wrench
    case "parser":
      return "\u{1F4D6}"; // open book
    case "evaluator":
      return "\u{1F9E0}"; // brain
    case "emitter":
      return "\u{1F3D7}\uFE0F"; // building construction
    case "unknown":
      return "\u{2753}"; // question mark
  }
}
