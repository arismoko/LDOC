import { findFirst, getOnlyKey, attrVal, type XmlNode } from "./xml";

export interface FontSizeStats {
  font?: string;
  sizePt?: number;
}

export interface FontFrequency {
  key: string;      // "fontName|sizePt"
  font?: string;
  sizePt?: number;
  count: number;
  charCount: number; // Weight by character count
}

/**
 * Collect font/size frequency from all runs in the document body.
 * Returns the dominant (most frequent by character count) font/size combo.
 */
export function collectFontStatistics(bodyChildren: XmlNode[]): FontFrequency[] {
  const freqMap = new Map<string, FontFrequency>();
  
  function processRun(runNode: XmlNode): void {
    const runChildren = runNode["w:r"] as XmlNode[];
    if (!runChildren) return;
    
    // Get font/size from w:rPr
    const rPr = findFirst(runChildren, "w:rPr");
    let font: string | undefined;
    let sizePt: number | undefined;
    
    if (rPr) {
      const rPrChildren = rPr["w:rPr"] as XmlNode[];
      
      // Font from w:rFonts
      const rFonts = findFirst(rPrChildren, "w:rFonts");
      if (rFonts) {
        font = attrVal(rFonts, "@_w:ascii") || attrVal(rFonts, "@_w:hAnsi");
      }
      
      // Size from w:sz (half-points)
      const szNode = findFirst(rPrChildren, "w:sz");
      const szVal = attrVal(szNode, "@_w:val");
      if (szVal) {
        const halfPt = parseInt(szVal, 10);
        if (Number.isFinite(halfPt)) {
          sizePt = halfPt / 2;
        }
      }
    }
    
    // Count text characters
    let charCount = 0;
    for (const child of runChildren) {
      const key = getOnlyKey(child);
      if (key === "w:t") {
        const tChildren = child["w:t"] as XmlNode[];
        for (const c of tChildren ?? []) {
          const text = c?.["#text"];
          if (typeof text === "string") {
            charCount += text.length;
          }
        }
      }
    }
    
    if (charCount === 0) return;
    
    // Create frequency key
    const freqKey = `${font || ""}|${sizePt || ""}`;
    const existing = freqMap.get(freqKey);
    if (existing) {
      existing.count++;
      existing.charCount += charCount;
    } else {
      freqMap.set(freqKey, {
        key: freqKey,
        font,
        sizePt,
        count: 1,
        charCount,
      });
    }
  }
  
  function walkNodes(nodes: XmlNode[]): void {
    for (const node of nodes) {
      const key = getOnlyKey(node);
      if (!key) continue;
      
      if (key === "w:r") {
        processRun(node);
      }
      
      // Recurse into paragraphs, tables, etc.
      const children = node[key];
      if (Array.isArray(children)) {
        walkNodes(children as XmlNode[]);
      }
    }
  }
  
  walkNodes(bodyChildren);
  
  // Sort by charCount descending
  return Array.from(freqMap.values()).sort((a, b) => b.charCount - a.charCount);
}

/**
 * Compute dominant style from statistics and document defaults.
 * Prefers document defaults if available, otherwise uses frequency mode.
 */
export function computeDominantStyle(
  stats: FontFrequency[],
  docDefaults: FontSizeStats
): FontSizeStats {
  // If we have document defaults, use them as the base
  const result: FontSizeStats = {
    font: docDefaults.font,
    sizePt: docDefaults.sizePt,
  };
  
  // If we're missing either, try to fill from frequency stats
  if (stats.length > 0) {
    const top = stats[0]!;
    if (!result.font && top.font) {
      result.font = top.font;
    }
    if (!result.sizePt && top.sizePt) {
      result.sizePt = top.sizePt;
    }
  }
  
  return result;
}
