/**
 * Text extraction utilities for pipeline stage comparison.
 * Extracts normalized plain text from DOCX, LDOC, and AST.
 */

import JSZip from "jszip";
import type { DocumentNode, Node } from "../../src/parser/ast";

export interface ExtractedText {
  /** Raw text content */
  text: string;
  /** Text split into paragraphs */
  paragraphs: string[];
  /** MD5 hash of normalized text */
  hash: string;
}

/**
 * Extract plain text from a DOCX buffer.
 * Parses document.xml and extracts all w:t text nodes.
 */
export async function extractTextFromDocx(docxBuffer: Buffer): Promise<ExtractedText> {
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  
  if (!documentXml) {
    return { text: "", paragraphs: [], hash: "" };
  }
  
  // Extract text from w:t elements, preserving paragraph boundaries
  const paragraphs: string[] = [];
  
  // Split by w:p (paragraph) elements
  const paraMatches = documentXml.match(/<w:p[^>]*>[\s\S]*?<\/w:p>/g) || [];
  
  for (const para of paraMatches) {
    // Extract all w:t text content from this paragraph
    const textMatches = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const paraText = textMatches
      .map(t => t.replace(/<w:t[^>]*>([^<]*)<\/w:t>/, "$1"))
      .join("");
    paragraphs.push(paraText);
  }
  
  const text = paragraphs.join("\n");
  const hash = computeHash(normalizeText(text));
  
  return { text, paragraphs, hash };
}

/**
 * Extract plain text from LDOC source.
 * Strips directives and extracts content text.
 */
export function extractTextFromLdoc(ldocSource: string): ExtractedText {
  const lines = ldocSource.split("\n");
  const paragraphs: string[] = [];
  let currentPara = "";
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip directives
    if (trimmed.startsWith("@") || trimmed.startsWith("---")) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = "";
      }
      continue;
    }
    
    // Skip comments
    if (trimmed.startsWith("//")) continue;
    
    // Empty line = paragraph break
    if (!trimmed) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = "";
      }
      continue;
    }
    
    // Handle table rows - extract cell content
    if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").filter(c => c.trim());
      for (const cell of cells) {
        if (cell.trim()) {
          paragraphs.push(cell.trim());
        }
      }
      continue;
    }
    
    // Headers - strip # prefix
    if (/^#{1,6}\s/.test(trimmed)) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = "";
      }
      paragraphs.push(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }
    
    // List items - strip prefix
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = "";
      }
      paragraphs.push(trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
      continue;
    }
    
    // Regular text - accumulate
    currentPara += (currentPara ? " " : "") + trimmed;
  }
  
  if (currentPara) {
    paragraphs.push(currentPara);
  }
  
  const text = paragraphs.join("\n");
  const hash = computeHash(normalizeText(text));
  
  return { text, paragraphs, hash };
}

/**
 * Extract plain text from parsed AST.
 */
export function extractTextFromAst(ast: DocumentNode): ExtractedText {
  const paragraphs: string[] = [];
  
  function extractFromNode(node: Node): void {
    switch (node.type) {
      case "paragraph":
      case "header": {
        const text = extractInlineText(node);
        if (text) paragraphs.push(text);
        break;
      }
      case "empty_paragraph":
        // Skip empty paragraphs in text extraction
        break;
      case "numbered_item":
      case "bullet_item": {
        const text = extractInlineText(node);
        if (text) paragraphs.push(text);
        // Process children
        if ("children" in node && Array.isArray(node.children)) {
          for (const child of node.children) {
            extractFromNode(child);
          }
        }
        break;
      }
      case "table":
        if ("rows" in node && Array.isArray(node.rows)) {
          for (const row of node.rows) {
            if ("cells" in row && Array.isArray(row.cells)) {
              for (const cell of row.cells) {
                if ("content" in cell && Array.isArray(cell.content)) {
                  for (const child of cell.content) {
                    extractFromNode(child as Node);
                  }
                }
              }
            }
          }
        }
        break;
      case "blockquote":
      case "columns_region":
      case "modifier":
      case "footnote_def":
      case "doc_header":
      case "doc_footer":
        if ("content" in node && Array.isArray(node.content)) {
          for (const child of node.content) {
            extractFromNode(child as Node);
          }
        }
        break;
    }
  }
  
  for (const node of ast.body) {
    extractFromNode(node);
  }
  
  const text = paragraphs.join("\n");
  const hash = computeHash(normalizeText(text));
  
  return { text, paragraphs, hash };
}

/**
 * Extract text from inline content (runs, text nodes).
 */
function extractInlineText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  
  const n = node as Record<string, unknown>;
  
  // Direct text content
  if (typeof n.text === "string") return n.text;
  
  // Content array (paragraphs, headers)
  if (Array.isArray(n.content)) {
    return n.content.map(extractInlineText).join("");
  }
  
  // Runs array
  if (Array.isArray(n.runs)) {
    return n.runs.map(extractInlineText).join("");
  }
  
  return "";
}

/**
 * Normalize text for comparison (lowercase, collapse whitespace).
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute MD5 hash of text.
 */
function computeHash(text: string): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(text);
  return hasher.digest("hex");
}

/**
 * Compare two ExtractedText results and find first difference.
 */
export function findFirstDifference(
  original: ExtractedText,
  compared: ExtractedText
): { index: number; original: string; compared: string } | null {
  const maxLen = Math.max(original.paragraphs.length, compared.paragraphs.length);
  
  for (let i = 0; i < maxLen; i++) {
    const origPara = original.paragraphs[i] ?? "";
    const compPara = compared.paragraphs[i] ?? "";
    
    if (normalizeText(origPara) !== normalizeText(compPara)) {
      return {
        index: i,
        original: origPara.slice(0, 100),
        compared: compPara.slice(0, 100),
      };
    }
  }
  
  return null;
}
