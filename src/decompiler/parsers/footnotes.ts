import { xmlParser, findFirst, getOnlyKey, attrVal, type XmlNode } from "../xml";
import { processBodyElementsV2, type PipelineOptions } from "../pipeline";
import type { NumberingInfo } from "./numbering";
import type { ParagraphStyleMap } from "./styles";

export interface FootnoteInfo {
  id: string;
  contentLines: string[]; // LDOC lines for the footnote content
}

/**
 * Parse footnotes from word/footnotes.xml content.
 * Returns a map of footnote ID to FootnoteInfo.
 * 
 * Delegates to processBodyElementsV2 for full rich text support (tables, alignment, styles).
 */
export function parseFootnotes(
  footnotesXml: string | undefined,
  numInfo: NumberingInfo,
  styles: ParagraphStyleMap,
  options?: PipelineOptions,
  rels?: Map<string, string>
): Map<string, FootnoteInfo> {
  const map = new Map<string, FootnoteInfo>();
  if (!footnotesXml) return map;

  const tree = xmlParser.parse(footnotesXml) as XmlNode[];
  const footnotes = findFirst(tree, "w:footnotes");
  if (!footnotes) return map;

  const children = footnotes["w:footnotes"] as XmlNode[];
  for (const child of children ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:footnote") {
      const id = attrVal(child, "@_w:id");
      // Skip separator footnotes (id 0, -1)
      if (!id || id === "0" || id === "-1") continue;

      // Use new V2 pipeline for rich text support
      const fnChildren = child["w:footnote"] as XmlNode[];
      const contentLines = processBodyElementsV2(fnChildren ?? [], numInfo, styles, options, "", rels);
      
      // Filter out empty lines and trim
      const nonEmptyLines = contentLines.filter(line => line.trim());
      
      if (nonEmptyLines.length > 0) {
        map.set(id, { id, contentLines: nonEmptyLines });
      }
    }
  }

  return map;
}
