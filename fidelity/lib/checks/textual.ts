/**
 * Textual fidelity checks - compare text content
 */

import JSZip from "jszip";
import { createHash } from "crypto";
import type { CheckResult, TextualMetrics } from "./types";

export async function extractTextualMetrics(docxBuffer: Buffer): Promise<TextualMetrics> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file("word/document.xml")?.async("string");

  if (!docXml) {
    throw new Error("Cannot read document.xml from DOCX");
  }

  // Extract all text content
  const textMatches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  let fullText = "";
  for (const match of textMatches) {
    const text = match.replace(/<[^>]+>/g, "");
    fullText += text;
  }

  // Normalize whitespace for comparison
  const normalizedText = fullText.replace(/\s+/g, " ").trim();

  const charCount = normalizedText.length;
  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const lineCount = fullText.split(/\n/).length;

  // Content hash for quick comparison
  const contentHash = createHash("md5").update(normalizedText).digest("hex");

  return {
    charCount,
    wordCount,
    lineCount,
    contentHash,
  };
}

export async function extractRawText(docxBuffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file("word/document.xml")?.async("string");

  if (!docXml) {
    throw new Error("Cannot read document.xml from DOCX");
  }

  const textMatches = docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  let fullText = "";
  for (const match of textMatches) {
    const text = match.replace(/<[^>]+>/g, "");
    fullText += text;
  }

  return fullText;
}

export async function runTextualChecks(
  originalDocx: Buffer,
  recompiledDocx: Buffer,
  _ldocSource: string,
  _options: { artifactsDir: string; verbose?: boolean }
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const origMetrics = await extractTextualMetrics(originalDocx);
  const recMetrics = await extractTextualMetrics(recompiledDocx);

  // Character count (with tolerance for minor whitespace differences)
  const charDiff = Math.abs(origMetrics.charCount - recMetrics.charCount);
  const charTolerance = Math.max(10, origMetrics.charCount * 0.01); // 1% or 10 chars
  results.push({
    name: "textual.charCount",
    passed: charDiff <= charTolerance,
    severity: "major",
    expected: origMetrics.charCount,
    actual: recMetrics.charCount,
    message: charDiff > charTolerance
      ? `Character count differs by ${charDiff} (tolerance: ${Math.round(charTolerance)})`
      : undefined,
  });

  // Word count
  const wordDiff = Math.abs(origMetrics.wordCount - recMetrics.wordCount);
  results.push({
    name: "textual.wordCount",
    passed: wordDiff === 0,
    severity: "major",
    expected: origMetrics.wordCount,
    actual: recMetrics.wordCount,
    message: wordDiff > 0
      ? `Word count differs by ${wordDiff}`
      : undefined,
  });

  // Content hash (exact match after normalization)
  results.push({
    name: "textual.contentHash",
    passed: origMetrics.contentHash === recMetrics.contentHash,
    severity: "critical",
    expected: origMetrics.contentHash,
    actual: recMetrics.contentHash,
    message: origMetrics.contentHash !== recMetrics.contentHash
      ? "Normalized content differs (hash mismatch)"
      : undefined,
  });

  // If hash differs, try to find what's different
  if (origMetrics.contentHash !== recMetrics.contentHash) {
    const origText = await extractRawText(originalDocx);
    const recText = await extractRawText(recompiledDocx);
    
    // Find first difference
    const minLen = Math.min(origText.length, recText.length);
    let diffPos = -1;
    for (let i = 0; i < minLen; i++) {
      if (origText[i] !== recText[i]) {
        diffPos = i;
        break;
      }
    }
    
    if (diffPos >= 0) {
      const context = 20;
      const origSnippet = origText.slice(Math.max(0, diffPos - context), diffPos + context);
      const recSnippet = recText.slice(Math.max(0, diffPos - context), diffPos + context);
      
      results.push({
        name: "textual.firstDifference",
        passed: false,
        severity: "major",
        expected: origSnippet,
        actual: recSnippet,
        message: `First difference at position ${diffPos}`,
      });
    }
  }

  return results;
}
