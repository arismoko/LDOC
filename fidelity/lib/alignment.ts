/**
 * Paragraph-level alignment between pipeline stages.
 * Identifies exactly which paragraphs diverged and how.
 */

export interface ParagraphAlignment {
  index: number;
  original: string | null;
  cst: string | null;
  document: string | null;
  recompiled: string | null;
  status: "match" | "content_diff" | "missing_original" | "missing_recompiled" | "added";
  divergedAt?: "decompiler" | "parser" | "evaluator" | "emitter";
}

export interface AlignmentReport {
  alignments: ParagraphAlignment[];
  firstDivergence: number | null;
  summary: {
    matched: number;
    contentDiff: number;
    missing: number;
    added: number;
  };
}

/**
 * Align paragraphs from all four stages.
 * Returns alignment report showing where content diverges.
 */
export function alignParagraphs(
  originalParas: string[],
  cstParas: string[],
  documentParas: string[],
  recompiledParas: string[]
): AlignmentReport {
  const maxLen = Math.max(
    originalParas.length,
    cstParas.length,
    documentParas.length,
    recompiledParas.length
  );
  
  const alignments: ParagraphAlignment[] = [];
  let firstDivergence: number | null = null;
  let matched = 0;
  let contentDiff = 0;
  let missing = 0;
  let added = 0;
  
  for (let i = 0; i < maxLen; i++) {
    const orig = originalParas[i] ?? null;
    const cst = cstParas[i] ?? null;
    const doc = documentParas[i] ?? null;
    const recomp = recompiledParas[i] ?? null;
    
    let status: ParagraphAlignment["status"];
    let divergedAt: ParagraphAlignment["divergedAt"];
    
    if (orig === null && recomp !== null) {
      status = "added";
      added++;
    } else if (orig !== null && recomp === null) {
      status = "missing_recompiled";
      missing++;
    } else if (normalize(orig) === normalize(recomp)) {
      status = "match";
      matched++;
    } else {
      status = "content_diff";
      contentDiff++;
      
      // Determine where divergence started
      if (normalize(orig) !== normalize(cst)) {
        divergedAt = "decompiler";
      } else if (normalize(cst) !== normalize(doc)) {
        divergedAt = "evaluator";
      } else if (normalize(doc) !== normalize(recomp)) {
        divergedAt = "emitter";
      }
    }
    
    if (status !== "match" && firstDivergence === null) {
      firstDivergence = i;
    }
    
    alignments.push({
      index: i,
      original: truncate(orig, 60),
      cst: truncate(cst, 60),
      document: truncate(doc, 60),
      recompiled: truncate(recomp, 60),
      status,
      ...(divergedAt && { divergedAt }),
    });
  }
  
  return {
    alignments,
    firstDivergence,
    summary: { matched, contentDiff, missing, added },
  };
}

/**
 * Normalize text for comparison.
 */
function normalize(text: string | null): string {
  if (!text) return "";
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Truncate text for display.
 */
function truncate(text: string | null, maxLen: number): string | null {
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Format alignment report as Markdown table.
 */
export function formatAlignmentTable(report: AlignmentReport, limit = 10): string {
  const lines: string[] = [];
  
  lines.push("## Paragraph Alignment");
  lines.push("");
  lines.push("Showing divergent paragraphs:");
  lines.push("");
  lines.push("| # | Status | Original | Recompiled |");
  lines.push("|---|--------|----------|------------|");
  
  let shown = 0;
  for (const a of report.alignments) {
    if (a.status === "match") continue;
    if (shown >= limit) {
      const remaining = report.alignments.filter(x => x.status !== "match").length - limit;
      lines.push(`| ... | | (${remaining} more divergent) | |`);
      break;
    }
    
    const statusIcon = {
      match: "✓",
      content_diff: "≠",
      missing_original: "−",
      missing_recompiled: "+",
      added: "+",
    }[a.status];
    
    const origText = a.original?.replace(/\|/g, "\\|") ?? "(none)";
    const recompText = a.recompiled?.replace(/\|/g, "\\|") ?? "(none)";
    
    lines.push(`| ${a.index} | ${statusIcon} ${a.status} | ${origText} | ${recompText} |`);
    shown++;
  }
  
  lines.push("");
  lines.push(`**Summary**: ${report.summary.matched} matched, ${report.summary.contentDiff} differ, ${report.summary.missing} missing, ${report.summary.added} added`);
  
  return lines.join("\n");
}

/**
 * Format alignment as JSON for artifacts.
 */
export function formatAlignmentJson(report: AlignmentReport): string {
  return JSON.stringify(report, null, 2);
}
