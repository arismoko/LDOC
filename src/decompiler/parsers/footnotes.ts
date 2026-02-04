import { xmlParser, findFirst, getOnlyKey, attrVal, type XmlNode } from "../xml";

export interface FootnoteInfo {
  id: string;
  content: string; // The footnote text
}

/**
 * Collect text content from footnote child nodes (w:p elements).
 * This is a simplified version that extracts plain text from paragraphs.
 */
function collectFootnoteText(children: XmlNode[]): string {
  const parts: string[] = [];

  for (const child of children ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      const pChildren = child["w:p"] as XmlNode[];
      for (const pChild of pChildren ?? []) {
        const pKey = getOnlyKey(pChild);
        if (pKey === "w:r") {
          const runChildren = pChild["w:r"] as XmlNode[];
          for (const rChild of runChildren ?? []) {
            const rKey = getOnlyKey(rChild);
            if (rKey === "w:t") {
              const tChildren = rChild["w:t"] as XmlNode[];
              for (const t of tChildren ?? []) {
                if (typeof t === "string" || typeof t === "number" || typeof t === "boolean") {
                  parts.push(String(t));
                  continue;
                }
                const text = t?.["#text"];
                if (typeof text === "string" || typeof text === "number" || typeof text === "boolean") {
                  parts.push(String(text));
                }
              }
            }
          }
        }
      }
    }
  }

  return parts.join("").trim();
}

/**
 * Parse footnotes from word/footnotes.xml content.
 * Returns a map of footnote ID to FootnoteInfo.
 */
export function parseFootnotes(footnotesXml: string | undefined): Map<string, FootnoteInfo> {
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

      // Extract text from footnote paragraphs
      const fnChildren = child["w:footnote"] as XmlNode[];
      const content = collectFootnoteText(fnChildren);
      
      if (content) {
        map.set(id, { id, content });
      }
    }
  }

  return map;
}
