/**
 * Stage diagnosis - identify WHERE in the pipeline issues occur
 *
 * Pipeline: Original DOCX -> Decompiler -> LDOC -> Parser -> AST -> Compiler -> Recompiled DOCX
 */

import type { StageDiagnosis } from "./checks/types";
import type { DocumentNode, Node } from "../../src/parser/ast";

export interface ParagraphCounts {
  original: number;
  /** @deprecated LDOC counting is imprecise - use AST count instead */
  ldoc: number;
  ast: number;
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
export function countAstParagraphs(ast: DocumentNode): number {
  let count = 0;

  function countNode(node: Node): void {
    switch (node.type) {
      case "paragraph":
      case "header":
        count++;
        break;
      case "empty_paragraph":
        // empty_paragraph has a count field for consecutive blank lines
        count += (node as { count: number }).count;
        break;
      case "numbered_item":
      case "bullet_item":
        count++;
        // Also count children recursively
        if ("children" in node && Array.isArray(node.children)) {
          for (const child of node.children) {
            countNode(child);
          }
        }
        break;
      case "blockquote":
        // Blockquote contains content, count recursively
        if ("content" in node && Array.isArray(node.content)) {
          for (const child of node.content) {
            countNode(child as Node);
          }
        }
        break;
      case "table":
        // Tables contain rows with cells that may contain paragraphs
        if ("rows" in node && Array.isArray(node.rows)) {
          for (const row of node.rows) {
            if ("cells" in row && Array.isArray(row.cells)) {
              for (const cell of row.cells) {
                if ("content" in cell && Array.isArray(cell.content)) {
                  for (const child of cell.content) {
                    countNode(child as Node);
                  }
                }
              }
            }
          }
        }
        break;
      case "columns_region":
      case "modifier":
      case "footnote_def":
        // These contain nested content
        if ("content" in node && Array.isArray(node.content)) {
          for (const child of node.content) {
            countNode(child as Node);
          }
        }
        if ("children" in node && Array.isArray(node.children)) {
          for (const child of node.children) {
            countNode(child);
          }
        }
        break;
      case "doc_header":
      case "doc_footer":
        // Header/footer contain content
        if ("content" in node && Array.isArray(node.content)) {
          for (const child of node.content) {
            countNode(child as Node);
          }
        }
        break;
    }
  }

  // Count body nodes
  for (const node of ast.body) {
    countNode(node);
  }

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
  const { original, ast, recompiled } = counts;

  // If AST count != original -> decompiler+parser issue
  // (We can't distinguish decompiler from parser without accurate LDOC counting)
  if (ast !== original) {
    const diff = ast - original;
    const direction = diff > 0 ? "added" : "lost";
    return {
      likely_stage: "decompiler",
      confidence: "medium",
      evidence: `Paragraph count diverges at AST: ${original} -> ${ast} (${Math.abs(diff)} ${direction})`,
      paragraph_counts: counts,
      first_divergence: {
        stage: "decompiler",
        paragraph_index: Math.min(original, ast),
        detail: `Decompiler/Parser ${direction} ${Math.abs(diff)} paragraph(s)`,
      },
    };
  }

  // If recompiled count != AST count -> compiler issue
  if (recompiled !== ast) {
    const diff = recompiled - ast;
    const direction = diff > 0 ? "added" : "lost";
    return {
      likely_stage: "compiler",
      confidence: "high",
      evidence: `Paragraph count diverges at recompiled: ${ast} -> ${recompiled} (${Math.abs(diff)} ${direction})`,
      paragraph_counts: counts,
      first_divergence: {
        stage: "compiler",
        paragraph_index: Math.min(ast, recompiled),
        detail: `Compiler ${direction} ${Math.abs(diff)} paragraph(s)`,
      },
    };
  }

  // Counts all match but we still have failures
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
  const { original, ast, recompiled } = counts;
  return `${original} → ${ast} → ${recompiled}`;
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
    case "compiler":
      return "\u{1F3D7}\uFE0F"; // building construction
    case "unknown":
      return "\u{2753}"; // question mark
  }
}
