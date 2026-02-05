#!/usr/bin/env bun
/**
 * LDOC Fidelity Test Runner
 *
 * Usage:
 *   bun fidelity/run.ts                    # Run all checks
 *   bun fidelity/run.ts --visual           # Include visual (PDF page) checks
 *   bun fidelity/run.ts --filter cot_      # Only run docs matching pattern
 *   bun fidelity/run.ts --verbose          # Show detailed progress
 *   bun fidelity/run.ts --artifacts all    # Save all artifacts
 *   bun fidelity/run.ts --json             # Output results as JSON
 */

import { parseArgs } from "util";
import { readFileSync } from "fs";
import { join } from "path";
import { runFidelityTests } from "./lib/runner";
import type { RunOptions, Severity } from "./lib/checks/types";
import { formatCountChain, getStageEmoji } from "./lib/diagnosis";
import { saveInvestigationReport } from "./lib/investigation";

const severityOrder: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

const severityEmoji: Record<Severity, string> = {
  critical: "🔴",
  major: "🟡",
  minor: "🟢",
};

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    visual: {
      type: "boolean",
      default: false,
    },
    filter: {
      type: "string",
      multiple: true,
    },
    doc: {
      type: "string",
      multiple: true,
    },
    check: {
      type: "string",
      multiple: true,
    },
    verbose: {
      type: "boolean",
      short: "v",
      default: false,
    },
    artifacts: {
      type: "string",
      default: "failures",
    },
    json: {
      type: "boolean",
      default: false,
    },
    help: {
      type: "boolean",
      short: "h",
      default: false,
    },
    investigate: {
      type: "boolean",
      default: false,
    },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`
LDOC Fidelity Test Runner

Usage:
  bun fidelity/run.ts [options]

Options:
  --visual         Include visual (PDF page count) checks (requires LibreOffice)
  --filter <pat>   Only run documents matching pattern (can specify multiple)
  --doc <id>       Only run documents with specific id (can specify multiple)
  --check <name>   Only report specific checks (category.name, can specify multiple)
  -v, --verbose    Show detailed progress output
  --artifacts      What artifacts to generate: all, failures, none (default: failures)
  --json           Output results as JSON (no console output)
  --investigate    Deep-dive diagnostics on a single document (requires --doc)
  -h, --help       Show this help message

Environment:
  LDOC_CORPUS_PATH   Path to corpus directory with DOCX files
                     (or create fidelity/.env with this variable)

Examples:
  bun fidelity/run.ts                     # Run structural + textual checks
  bun fidelity/run.ts --visual            # Include page count verification
  bun fidelity/run.ts --filter cot_       # Only check cot_* documents
  bun fidelity/run.ts --doc cot_POWELL    # Only check specific document
  bun fidelity/run.ts --check structural.paragraphCount  # Only report specific check
  bun fidelity/run.ts --artifacts all -v  # Save all artifacts with verbose output
  bun fidelity/run.ts --json > results.json  # Output results as JSON
  bun fidelity/run.ts --investigate --doc cot_POWELL  # Deep-dive investigation
`);
  process.exit(0);
}

// Validate --investigate mode
if (values.investigate) {
  if (!values.doc || values.doc.length !== 1) {
    console.error("--investigate requires exactly one --doc argument");
    process.exit(1);
  }
}

// Build run options
const checks: RunOptions["checks"] = ["structural", "textual"];
if (values.visual) {
  checks.push("visual");
}

let artifactMode = values.artifacts as "all" | "failures" | "none";
if (!["all", "failures", "none"].includes(artifactMode)) {
  console.error(`Invalid --artifacts value: ${values.artifacts}`);
  console.error("Valid options: all, failures, none");
  process.exit(1);
}

// Force all artifacts in investigate mode
if (values.investigate) {
  artifactMode = "all";
}

const options: RunOptions = {
  checks,
  filter: values.filter,
  docFilter: values.doc,
  checkFilter: values.check,
  generateArtifacts: artifactMode,
  verbose: values.verbose,
  quiet: values.json,
};

const jsonMode = values.json;

// Run tests
if (!jsonMode) {
  console.log("LDOC Fidelity Tests");
  console.log("===================\n");

  if (options.verbose) {
    console.log("Options:", {
      checks: options.checks,
      filter: options.filter ?? "(all)",
      docFilter: options.docFilter ?? "(all)",
      checkFilter: options.checkFilter ?? "(all)",
      artifacts: options.generateArtifacts,
    });
    console.log();
  }
}

const result = await runFidelityTests(options);

if (jsonMode) {
  // Add commands to each document result
  for (const doc of result.documents) {
    const firstFailedCheck = doc.checks.find((c) => !c.passed);
    doc.commands = {
      rerun_single: `bun fidelity/run.ts --doc ${doc.id}`,
      ...(firstFailedCheck
        ? { rerun_check: `bun fidelity/run.ts --doc ${doc.id} --check ${firstFailedCheck.name}` }
        : {}),
    };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.summary.failed > 0 ? 1 : 0);
}

// Print summary
console.log();
console.log("Summary");
console.log("-------");
console.log(`Total:    ${result.summary.total}`);
console.log(`Passed:   ${result.summary.passed}`);
console.log(`Failed:   ${result.summary.failed}`);

// Count failures by severity
const failedChecks = result.documents.flatMap((d) =>
  d.checks.filter((c) => !c.passed)
);
const severityCounts = {
  critical: failedChecks.filter((c) => c.severity === "critical").length,
  major: failedChecks.filter((c) => c.severity === "major").length,
  minor: failedChecks.filter((c) => c.severity === "minor").length,
};
if (failedChecks.length > 0) {
  console.log(`  ${severityEmoji.critical} Critical: ${severityCounts.critical}`);
  console.log(`  ${severityEmoji.major} Major: ${severityCounts.major}`);
  console.log(`  ${severityEmoji.minor} Minor: ${severityCounts.minor}`);
}

console.log(`Duration: ${(result.summary.duration / 1000).toFixed(2)}s`);

// Print failures
const failures = result.documents.filter((d) => !d.passed);
if (failures.length > 0) {
  // Sort failures by highest severity check in each document
  const sortedFailures = [...failures].sort((a, b) => {
    const aMinSeverity = Math.min(
      ...a.checks.filter((c) => !c.passed).map((c) => severityOrder[c.severity])
    );
    const bMinSeverity = Math.min(
      ...b.checks.filter((c) => !c.passed).map((c) => severityOrder[c.severity])
    );
    return aMinSeverity - bMinSeverity;
  });

  console.log();
  console.log("Failures");
  console.log("--------");
  for (const doc of sortedFailures) {
    // Get failed checks sorted by severity
    const failedDocChecks = doc.checks
      .filter((c) => !c.passed)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    const topSeverity = failedDocChecks[0]?.severity ?? "minor";
    const emoji = severityEmoji[topSeverity];
    
    console.log(`\n${emoji} ${doc.id}: ${failedDocChecks.map((c) => c.name).join(", ")}`);
    if (doc.error) {
      console.log(`  ERROR: ${doc.error}`);
    } else {
      for (const check of failedDocChecks) {
        console.log(`  ${check.message ?? ""}`);
        if (check.expected !== undefined) {
          console.log(`    expected: ${JSON.stringify(check.expected)}`);
          console.log(`    actual:   ${JSON.stringify(check.actual)}`);
        }
      }
    }
    
    // Show stage diagnosis
    if (doc.diagnosis) {
      const d = doc.diagnosis;
      const stageEmoji = getStageEmoji(d.likely_stage);
      console.log(`  Stage: ${stageEmoji} ${d.likely_stage} (${d.confidence} confidence)`);
      console.log(`  Chain: ${formatCountChain(d.paragraph_counts)}`);
      if (d.first_divergence) {
        console.log(`  Divergence: ${d.first_divergence.detail}`);
      }
    }
    
    if (doc.artifactsDir) {
      console.log(`  artifacts: ${doc.artifactsDir}`);
    }
  }
}

// Generate investigation report if in investigate mode
if (values.investigate && result.documents.length === 1) {
  const doc = result.documents[0]!;
  if (doc.artifactsDir) {
    // Add commands to the document for the report
    const firstFailedCheck = doc.checks.find((c) => !c.passed);
    doc.commands = {
      rerun_single: `bun fidelity/run.ts --doc ${doc.id}`,
      ...(firstFailedCheck
        ? { rerun_check: `bun fidelity/run.ts --doc ${doc.id} --check ${firstFailedCheck.name}` }
        : {}),
    };

    // Read ldoc source for the report
    const ldocPath = join(doc.artifactsDir, "decompiled.ldoc");
    let ldocSource = "";
    try {
      ldocSource = readFileSync(ldocPath, "utf-8");
    } catch {
      // ldoc source may not exist if there was an early error
    }

    // Get paragraph counts from diagnosis, or use defaults
    const paragraphCounts = doc.diagnosis?.paragraph_counts ?? {
      original: 0,
      ldoc: 0,
      ast: 0,
      recompiled: 0,
    };

    const reportPath = saveInvestigationReport({
      docResult: doc,
      artifactsDir: doc.artifactsDir,
      ldocSource,
      paragraphCounts,
    });

    console.log();
    console.log("Investigation Report");
    console.log("--------------------");
    console.log(`Report saved to: ${reportPath}`);
    console.log(`Artifacts dir:   ${doc.artifactsDir}`);
  }
}

// Exit with code based on results
process.exit(result.summary.failed > 0 ? 1 : 0);
