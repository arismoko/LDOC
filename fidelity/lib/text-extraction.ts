/**
 * Text extraction utilities for pipeline stage comparison.
 * Extracts normalized plain text from DOCX, LDOC, CST, and Document IR.
 */

import JSZip from "jszip";
import type {
  CSTDocument,
  CSTNode,
  CSTInline,
  CSTListItem,
  CSTTableRow,
  CSTTableCell,
} from "../../src/types/cst";
import type {
  Document,
  Block,
  Inline,
  ListItem,
  TableRow,
  TableCell,
} from "../../src/types/document-ir";
import type { StyledDocument } from "../../src/types/styled";

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
    
    // List items - keep prefix for consistent comparison with DOCX
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      if (currentPara) {
        paragraphs.push(currentPara);
        currentPara = "";
      }
      paragraphs.push(trimmed);
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
 * Extract plain text from CST.
 */
export function extractTextFromCst(cst: CSTDocument): ExtractedText {
  const paragraphs: string[] = [];

  function extractInline(inline: CSTInline): string {
    switch (inline.type) {
      case "Text":
        return inline.value;
      case "Variable":
        return inline.expression;
      case "CrossRef":
        return inline.target;
      case "FootnoteRef":
        return inline.label;
      case "Emphasis":
        return inline.content.map(extractInline).join("");
      case "Link":
        return inline.text.map(extractInline).join("");
      case "DefinedTerm":
        return inline.term;
      case "InlineDirective":
        return inline.content.map(extractInline).join("");
      case "Image":
        return inline.alt;
      case "Blank":
      case "HardBreak":
      case "Tab":
      case "Error":
        return "";
      default:
        return "";
    }
  }

  function extractFromNode(node: CSTNode | CSTListItem | CSTTableRow | CSTTableCell): void {
    switch (node.type) {
      case "Paragraph":
      case "Header": {
        const text = node.content.map(extractInline).join("");
        if (text) paragraphs.push(text);
        break;
      }
      case "ListItem": {
        const listItem = node as CSTListItem;
        const marker = listItem.marker ? listItem.marker + " " : "";
        const text = marker + node.content.map(extractInline).join("");
        if (text.trim()) paragraphs.push(text);
        for (const child of node.children) {
          extractFromNode(child);
        }
        break;
      }
      case "List":
        for (const item of node.items) {
          extractFromNode(item);
        }
        break;
      case "Blockquote":
        for (const child of node.content) {
          extractFromNode(child);
        }
        break;
      case "Table":
        for (const row of node.rows) {
          extractFromNode(row);
        }
        break;
      case "TableRow":
        for (const cell of node.cells) {
          extractFromNode(cell);
        }
        break;
      case "TableCell":
        for (const child of node.content) {
          extractFromNode(child);
        }
        break;
      case "FootnoteDef":
        for (const child of node.content) {
          extractFromNode(child);
        }
        break;
      case "Directive":
        for (const child of node.body ?? []) {
          extractFromNode(child);
        }
        break;
      default:
        break;
    }
  }

  for (const node of cst.children) {
    extractFromNode(node);
  }

  const text = paragraphs.join("\n");
  const hash = computeHash(normalizeText(text));
  
  return { text, paragraphs, hash };
}

/**
 * Extract plain text from Document IR.
 */
export function extractTextFromDocument(document: Document): ExtractedText {
  const paragraphs: string[] = [];

  function extractInline(inline: Inline): string {
    switch (inline.type) {
      case "Text":
        return inline.value;
      case "Code":
        return inline.value;
      case "CrossRef":
        return inline.text ?? inline.target;
      case "FootnoteRef":
        return inline.label;
      case "Link":
        return inline.content.map(extractInline).join("");
      case "Styled":
      case "Bold":
      case "Italic":
      case "Underline":
      case "Strikethrough":
      case "Highlight":
        return inline.content.map(extractInline).join("");
      case "Image":
        return inline.alt ?? "";
      case "Bookmark":
      case "HardBreak":
      case "Tab":
      case "Field":
        return "";
      default:
        return "";
    }
  }

  function extractBlocks(blocks: Block[]): void {
    for (const block of blocks) {
      switch (block.type) {
        case "Paragraph":
        case "Heading": {
          const text = block.content.map(extractInline).join("");
          if (text) paragraphs.push(text);
          break;
        }
        case "List":
          for (let idx = 0; idx < block.items.length; idx++) {
            const item = block.items[idx]!;
            const marker = block.ordered
              ? `${(block.start ?? 1) + idx}.`
              : "-";
            extractListItem(item, marker);
          }
          break;
        case "Blockquote":
          extractBlocks(block.content);
          break;
        case "Table":
          for (const row of block.rows) {
            extractTableRow(row);
          }
          break;
        case "Section":
          extractBlocks(block.content);
          break;
        case "Footnote":
          extractBlocks(block.content);
          break;
        case "PageBreak":
        case "ColumnBreak":
        case "HorizontalRule":
          break;
      }
    }
  }

  function extractListItem(item: ListItem, marker: string): void {
    const inlineText = item.content.map(extractInline).join("");
    const text = marker + " " + inlineText;
    if (text.trim()) paragraphs.push(text);
    extractBlocks(item.children);
  }

  function extractTableRow(row: TableRow): void {
    for (const cell of row.cells) {
      extractTableCell(cell);
    }
  }

  function extractTableCell(cell: TableCell): void {
    extractBlocks(cell.content);
  }

  extractBlocks(document.blocks);

  const text = paragraphs.join("\n");
  const hash = computeHash(normalizeText(text));

  return { text, paragraphs, hash };
}

/**
 * Extract plain text from StyledDocument.
 * StyledDocument wraps a Document IR, so we delegate to extractTextFromDocument.
 */
export function extractTextFromStyledDocument(styledDocument: StyledDocument): ExtractedText {
  return extractTextFromDocument(styledDocument.document);
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
