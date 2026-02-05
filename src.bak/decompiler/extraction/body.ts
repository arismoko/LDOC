/**
 * Body Extraction
 *
 * Extracts body elements (paragraphs and tables) from DOCX XML.
 */

import { getOnlyKey, type XmlNode } from "../xml";
import { extractParagraph } from "./paragraph";
import { extractTable } from "./table";
import type { ParagraphStyleMap } from "../parsers/styles";
import type { ExtractedBodyElement } from "./types";

/**
 * Extract body elements from w:body children.
 */
export function extractBodyElements(
  bodyChildren: XmlNode[],
  styles: ParagraphStyleMap,
  rels?: Map<string, string>,
): ExtractedBodyElement[] {
  const elements: ExtractedBodyElement[] = [];

  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);
    if (!key) continue;

    if (key === "w:p") {
      elements.push(extractParagraph(child, styles, rels));
      continue;
    }

    if (key === "w:tbl") {
      elements.push(extractTable(child, styles, rels));
      continue;
    }

    // Skip sectPr and other structural elements
  }

  return elements;
}
