/**
 * Investigation report generator for deep-dive diagnostics.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import type { DocumentResult, StageDiagnosis } from "./checks/types";
import type { AlignmentReport } from "./alignment";
import { formatAlignmentTable } from "./alignment";

export interface InvestigationContext {
  docResult: DocumentResult;
  artifactsDir: string;
  ldocSource: string;
  paragraphCounts: StageDiagnosis["paragraph_counts"];
}

/**
 * Generate a detailed investigation report in Markdown format.
 */
export function generateInvestigationReport(ctx: InvestigationContext): string {
  const { docResult, paragraphCounts } = ctx;
  const diagnosis = docResult.diagnosis;

  let report = `# Investigation Report: ${docResult.id}

Generated: ${new Date().toISOString()}

## Summary

- **Status**: ${docResult.passed ? "PASSED" : "FAILED"}
- **Duration**: ${docResult.duration}ms
- **Checks Failed**: ${docResult.checks.filter((c) => !c.passed).length}

## Pipeline Analysis

\`\`\`
 Original DOCX ──→ Decompiler+Parser ──→ CST ──→ Evaluator ──→ Document ──→ Emitter ──→ Recompiled DOCX
     ${paragraphCounts.original} paras               ${paragraphCounts.cst} nodes    ${paragraphCounts.document} blocks    ${paragraphCounts.recompiled} paras
\`\`\`

### Paragraph Count Chain

| Stage | Count | Delta | Status |
|-------|-------|-------|--------|
| Original DOCX | ${paragraphCounts.original} | - | baseline |
| CST (parsed) | ${paragraphCounts.cst} | ${formatDelta(paragraphCounts.cst - paragraphCounts.original)} | ${paragraphCounts.cst === paragraphCounts.original ? "✓" : "✗ DIVERGED"} |
| Document IR | ${paragraphCounts.document} | ${formatDelta(paragraphCounts.document - paragraphCounts.cst)} | ${paragraphCounts.document === paragraphCounts.cst ? "✓" : "✗ DIVERGED"} |
| Recompiled DOCX | ${paragraphCounts.recompiled} | ${formatDelta(paragraphCounts.recompiled - paragraphCounts.document)} | ${paragraphCounts.recompiled === paragraphCounts.document ? "✓" : "✗ DIVERGED"} |

`;

  if (diagnosis) {
    report += `## Diagnosis

- **Likely Stage**: ${diagnosis.likely_stage}
- **Confidence**: ${diagnosis.confidence}
- **Evidence**: ${diagnosis.evidence}

`;
    if (diagnosis.first_divergence) {
      report += `### First Divergence

- **Stage**: ${diagnosis.first_divergence.stage}
- **At Paragraph**: ${diagnosis.first_divergence.paragraph_index}
- **Detail**: ${diagnosis.first_divergence.detail}

`;
    }
  }

  report += `## Check Results

| Check | Severity | Status | Message |
|-------|----------|--------|---------|
`;

  for (const check of docResult.checks) {
    const status = check.passed ? "✓ PASS" : "✗ FAIL";
    const message = check.message?.replace(/\|/g, "\\|") ?? "";
    report += `| ${check.name} | ${check.severity} | ${status} | ${message} |\n`;
  }

  report += `
## Artifacts

- \`original.docx\` - Source document
- \`decompiled.ldoc\` - LDOC output from decompiler
- \`recompiled.ldoc\` - LDOC from decompiling the recompiled DOCX
- \`cst.json\` - Parsed CST as JSON
- \`document.json\` - Document IR after evaluation
- \`styled.json\` - StyledDocument after style resolution
- \`recompiled.docx\` - Final output after full roundtrip
- \`alignment.json\` - Paragraph-level alignment report

`;

  // Include LDOC diff comparison if both files exist
  const decompiledLdocPath = join(ctx.artifactsDir, "decompiled.ldoc");
  const recompiledLdocPath = join(ctx.artifactsDir, "recompiled.ldoc");
  if (existsSync(decompiledLdocPath) && existsSync(recompiledLdocPath)) {
    try {
      const decompiledLdoc = readFileSync(decompiledLdocPath, "utf-8");
      const recompiledLdoc = readFileSync(recompiledLdocPath, "utf-8");
      const decompiledLines = decompiledLdoc.split("\n").length;
      const recompiledLines = recompiledLdoc.split("\n").length;
      const lineDelta = recompiledLines - decompiledLines;
      const match = decompiledLdoc === recompiledLdoc;

      report += `## LDOC Diff

| File | Lines | Delta | Match |
|------|-------|-------|-------|
| decompiled.ldoc | ${decompiledLines} | - | baseline |
| recompiled.ldoc | ${recompiledLines} | ${formatDelta(lineDelta)} | ${match ? "✓ IDENTICAL" : "✗ DIFFERS"} |

`;
      if (!match) {
        report += `> Run \`diff decompiled.ldoc recompiled.ldoc\` in artifacts dir to see differences.\n\n`;
      }
    } catch {
      // Skip if files can't be read
    }
  }

  // Include alignment table if available
  const alignmentPath = join(ctx.artifactsDir, "alignment.json");
  if (existsSync(alignmentPath)) {
    try {
      const alignmentData = JSON.parse(readFileSync(alignmentPath, "utf-8")) as AlignmentReport;
      report += formatAlignmentTable(alignmentData, 15) + "\n\n";
    } catch {
      // Skip if alignment file is invalid
    }
  }

  report += `## Next Steps

`;

  if (diagnosis?.likely_stage === "decompiler") {
    report += `1. Open \`decompiled.ldoc\` and compare structure to original
2. Look for extra paragraphs, missing content, or style issues
3. Check \`src/decompiler/\` for the relevant conversion logic
4. Common issues: whitespace handling, empty paragraph detection, style mapping
`;
  } else if (diagnosis?.likely_stage === "parser") {
    report += `1. Compare \`decompiled.ldoc\` line count to \`cst.json\` node count
2. Check if parser is merging or splitting content unexpectedly
3. Look at \`src/parse/\` for parsing rules
`;
  } else if (diagnosis?.likely_stage === "evaluator") {
    report += `1. Compare \`cst.json\` to \`document.json\` for expansion changes
2. Check macro expansion, @if/@foreach handling
3. Look at \`src/evaluate/\` for expansion logic
`;
  } else if (diagnosis?.likely_stage === "emitter") {
    report += `1. Compare \`document.json\` and \`styled.json\` to \`recompiled.docx\`
2. Check if emit is preserving block structure
3. Look at \`src/emit/\` for emission logic
`;
  } else {
    report += `1. Content differs but structure matches - likely formatting/style issue
2. Compare text content at each stage
3. Look for whitespace normalization or encoding differences
`;
  }

  report += `
## Commands

\`\`\`bash
# Re-run this document
${docResult.commands?.rerun_single ?? `bun fidelity/run.ts --doc ${docResult.id}`}

# Run specific check
${docResult.commands?.rerun_check ?? `bun fidelity/run.ts --doc ${docResult.id} --check <check_name>`}

# View artifacts
ls -la ${ctx.artifactsDir}
\`\`\`
`;

  return report;
}

function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/**
 * Save investigation report to artifacts directory.
 */
export function saveInvestigationReport(ctx: InvestigationContext): string {
  const report = generateInvestigationReport(ctx);
  const reportPath = join(ctx.artifactsDir, "investigation.md");
  writeFileSync(reportPath, report);
  return reportPath;
}
