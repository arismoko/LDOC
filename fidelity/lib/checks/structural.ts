/**
 * Structural fidelity checks - compare DOCX XML structure
 */

import JSZip from "jszip";
import type { CheckResult, StructuralMetrics } from "./types";

export async function extractStructuralMetrics(docxBuffer: Buffer): Promise<StructuralMetrics> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file("word/document.xml")?.async("string");

  if (!docXml) {
    throw new Error("Cannot read document.xml from DOCX");
  }

  // Count paragraphs
  const paragraphs = docXml.match(/<w:p[ >]/g) || [];
  const paragraphCount = paragraphs.length;

  // Count empty paragraphs (paragraphs with no w:t text nodes)
  const emptyParagraphCount = countEmptyParagraphs(docXml);

  // Count tables
  const tables = docXml.match(/<w:tbl[ >]/g) || [];
  const tableCount = tables.length;

  // Generate table signatures (structure fingerprint)
  const tableSignatures = extractTableSignatures(docXml);

  // Count style usage
  const styleUsage: Record<string, number> = {};
  const styleMatches = docXml.matchAll(/<w:pStyle w:val="([^"]+)"/g);
  for (const m of styleMatches) {
    const style = m[1]!;
    styleUsage[style] = (styleUsage[style] || 0) + 1;
  }

  return {
    paragraphCount,
    emptyParagraphCount,
    tableCount,
    tableSignatures,
    styleUsage,
  };
}

function countEmptyParagraphs(docXml: string): number {
  // Split by paragraph, check if each has text content
  const paragraphPattern = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const paragraphs = docXml.match(paragraphPattern) || [];
  
  let emptyCount = 0;
  for (const p of paragraphs) {
    // Check for text nodes
    if (!/<w:t[ >]/.test(p)) {
      emptyCount++;
    }
  }
  return emptyCount;
}

function extractTableSignatures(docXml: string): string[] {
  // Extract table structure as signatures for comparison
  // Format: "T{n}::{rows}x{cols}|{cellCounts}"
  const tablePattern = /<w:tbl[ >][\s\S]*?<\/w:tbl>/g;
  const tables = docXml.match(tablePattern) || [];
  
  const signatures: string[] = [];
  let tableIndex = 0;
  
  for (const table of tables) {
    tableIndex++;
    const rows = table.match(/<w:tr[ >]/g) || [];
    const cells = table.match(/<w:tc[ >]/g) || [];
    const rowCount = rows.length;
    const cellCount = cells.length;
    
    // Simple signature: table index, row count, cell count
    signatures.push(`T${tableIndex}::${rowCount}r${cellCount}c`);
  }
  
  return signatures;
}

export async function runStructuralChecks(
  originalDocx: Buffer,
  recompiledDocx: Buffer,
  _ldocSource: string,
  _options: { artifactsDir: string; verbose?: boolean }
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const origMetrics = await extractStructuralMetrics(originalDocx);
  const recMetrics = await extractStructuralMetrics(recompiledDocx);

  // Paragraph count
  results.push({
    name: "structural.paragraphCount",
    passed: origMetrics.paragraphCount === recMetrics.paragraphCount,
    severity: "major",
    expected: origMetrics.paragraphCount,
    actual: recMetrics.paragraphCount,
    message: origMetrics.paragraphCount !== recMetrics.paragraphCount
      ? `Paragraph count differs: ${origMetrics.paragraphCount} → ${recMetrics.paragraphCount}`
      : undefined,
  });

  // Empty paragraph count
  results.push({
    name: "structural.emptyParagraphs",
    passed: origMetrics.emptyParagraphCount === recMetrics.emptyParagraphCount,
    severity: "minor",
    expected: origMetrics.emptyParagraphCount,
    actual: recMetrics.emptyParagraphCount,
    message: origMetrics.emptyParagraphCount !== recMetrics.emptyParagraphCount
      ? `Empty paragraph count differs: ${origMetrics.emptyParagraphCount} → ${recMetrics.emptyParagraphCount}`
      : undefined,
  });

  // Table count
  results.push({
    name: "structural.tableCount",
    passed: origMetrics.tableCount === recMetrics.tableCount,
    severity: "critical",
    expected: origMetrics.tableCount,
    actual: recMetrics.tableCount,
    message: origMetrics.tableCount !== recMetrics.tableCount
      ? `Table count differs: ${origMetrics.tableCount} → ${recMetrics.tableCount}`
      : undefined,
  });

  // Table signatures
  const origSigs = origMetrics.tableSignatures.join("|");
  const recSigs = recMetrics.tableSignatures.join("|");
  results.push({
    name: "structural.tableSignatures",
    passed: origSigs === recSigs,
    severity: "critical",
    expected: origSigs,
    actual: recSigs,
    message: origSigs !== recSigs
      ? `Table structure differs`
      : undefined,
  });

  // Style usage
  const styleKeys = new Set([
    ...Object.keys(origMetrics.styleUsage),
    ...Object.keys(recMetrics.styleUsage),
  ]);
  let styleMismatch = false;
  const styleDiffs: string[] = [];
  for (const style of styleKeys) {
    const origCount = origMetrics.styleUsage[style] || 0;
    const recCount = recMetrics.styleUsage[style] || 0;
    if (origCount !== recCount) {
      styleMismatch = true;
      styleDiffs.push(`${style}: ${origCount} → ${recCount}`);
    }
  }
  results.push({
    name: "structural.styleUsage",
    passed: !styleMismatch,
    severity: "major",
    expected: origMetrics.styleUsage,
    actual: recMetrics.styleUsage,
    message: styleMismatch ? `Style usage differs: ${styleDiffs.join(", ")}` : undefined,
  });

  return results;
}
