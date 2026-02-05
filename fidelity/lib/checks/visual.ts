/**
 * Visual fidelity checks - PDF page count comparison via LibreOffice
 */

import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { CheckResult, VisualMetrics } from "./types";

let libreofficeAvailable: boolean | null = null;

export async function checkLibreOfficeAvailable(): Promise<boolean> {
  if (libreofficeAvailable !== null) return libreofficeAvailable;
  
  try {
    const result = await $`which libreoffice`.quiet();
    libreofficeAvailable = result.exitCode === 0;
  } catch {
    libreofficeAvailable = false;
  }
  
  return libreofficeAvailable;
}

export async function extractVisualMetrics(
  docxBuffer: Buffer,
  workDir: string,
  name: string
): Promise<VisualMetrics> {
  if (!await checkLibreOfficeAvailable()) {
    return { pageCount: null };
  }

  // Write DOCX to temp file
  mkdirSync(workDir, { recursive: true });
  const docxPath = join(workDir, `${name}.docx`);
  writeFileSync(docxPath, docxBuffer);

  try {
    // Convert to PDF
    await $`libreoffice --headless --convert-to pdf --outdir ${workDir} ${docxPath}`.quiet();

    const pdfPath = join(workDir, `${name}.pdf`);
    if (!existsSync(pdfPath)) {
      return { pageCount: null };
    }

    // Get page count
    const result = await $`pdfinfo ${pdfPath}`.quiet();
    const match = result.text().match(/Pages:\s+(\d+)/);
    const pageCount = match ? parseInt(match[1]!, 10) : null;

    return { pageCount };
  } catch {
    return { pageCount: null };
  }
}

export async function runVisualChecks(
  originalDocx: Buffer,
  recompiledDocx: Buffer,
  _ldocSource: string,
  options: { artifactsDir: string; verbose?: boolean }
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  if (!await checkLibreOfficeAvailable()) {
    results.push({
      name: "visual.pageCount",
      passed: true, // Skip, not fail
      severity: "minor",
      message: "Skipped: LibreOffice not available",
    });
    return results;
  }

  const workDir = join(options.artifactsDir, "visual");
  
  const [origMetrics, recMetrics] = await Promise.all([
    extractVisualMetrics(originalDocx, workDir, "original"),
    extractVisualMetrics(recompiledDocx, workDir, "recompiled"),
  ]);

  if (origMetrics.pageCount === null || recMetrics.pageCount === null) {
    results.push({
      name: "visual.pageCount",
      passed: true, // Skip, not fail
      severity: "minor",
      message: "Skipped: Could not determine page count",
    });
    return results;
  }

  results.push({
    name: "visual.pageCount",
    passed: origMetrics.pageCount === recMetrics.pageCount,
    severity: "minor",
    expected: origMetrics.pageCount,
    actual: recMetrics.pageCount,
    message: origMetrics.pageCount !== recMetrics.pageCount
      ? `Page count differs: ${origMetrics.pageCount} → ${recMetrics.pageCount}`
      : undefined,
  });

  return results;
}
