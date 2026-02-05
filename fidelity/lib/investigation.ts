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
Original DOCX ──→ Decompiler+Parser ──→ AST ──→ Compiler ──→ Recompiled DOCX
     ${paragraphCounts.original} paras               ${paragraphCounts.ast} nodes    ${paragraphCounts.recompiled} paras
\`\`\`

### Paragraph Count Chain

| Stage | Count | Delta | Status |
|-------|-------|-------|--------|
| Original DOCX | ${paragraphCounts.original} | - | baseline |
| AST (parsed) | ${paragraphCounts.ast} | ${formatDelta(paragraphCounts.ast - paragraphCounts.original)} | ${paragraphCounts.ast === paragraphCounts.original ? "✓" : "✗ DIVERGED"} |
| Recompiled DOCX | ${paragraphCounts.recompiled} | ${formatDelta(paragraphCounts.recompiled - paragraphCounts.ast)} | ${paragraphCounts.recompiled === paragraphCounts.ast ? "✓" : "✗ DIVERGED"} |

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
- \`ast.json\` - Parsed AST as JSON
- \`recompiled.docx\` - Final output after full roundtrip
- \`alignment.json\` - Paragraph-level alignment report

`;

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
    report += `1. Compare \`decompiled.ldoc\` line count to \`ast.json\` node count
2. Check if parser is merging or splitting content unexpectedly
3. Look at \`src/parser/\` for parsing rules
`;
  } else if (diagnosis?.likely_stage === "compiler") {
    report += `1. Compare \`ast.json\` structure to \`recompiled.docx\`
2. Check if compiler is emitting correct paragraph structure
3. Look at \`src/compiler/\` for emission logic
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
