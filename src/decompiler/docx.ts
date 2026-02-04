import JSZip from "jszip";
import { xmlParser, findFirst, findPath, getOnlyKey, type XmlNode } from "./xml";
import { parseNumbering, type NumberingInfo } from "./parsers/numbering";
import { parseSpacingFromStylesXml, parseParagraphStyles, parseDocumentDefaults, extractUsedStyles, styleIdToLdocKey, styleToLdocLines, type ParagraphStyleMap } from "./parsers/styles";
import { collectFontStatistics, computeDominantStyle, type FontSizeStats } from "./statistics";
import { parseDocumentRels, parseLayoutFromSectPr, parseHeaderFooterRefs, parseSectionProps, findFinalSectPr, findParagraphSectPr, type LayoutInfo, type HeaderFooterRefs, type SectionProps } from "./parsers/layout";
import { parseFootnotes, type FootnoteInfo } from "./parsers/footnotes";
import { paragraphToLdoc, type DecompilerOptions } from "./converters/paragraph";
import { tableToLdoc } from "./converters/table";
import { processChildren, shouldEmitIndent, formatTwipsAsPt } from "./generator";

export type { DecompilerOptions };

export type DecompileResult = {
  source: string;
  assets: Map<string, Uint8Array>;
};

function twipsToInches(twips: number): number {
  return twips / 1440;
}

function formatInches(inches: number): string {
  // Format to up to 2 decimal places, remove trailing zeros
  const rounded = Math.round(inches * 100) / 100;
  return rounded.toString();
}

async function parseHeaderFooterContent(
  zip: JSZip,
  rId: string,
  rels: Map<string, string>,
  numInfo: NumberingInfo,
  styles: ParagraphStyleMap,
  options?: DecompilerOptions,
  docRels?: Map<string, string>
): Promise<string[]> {
  const target = rels.get(rId);
  if (!target) return [];

  // Target is like "header1.xml" or "footer1.xml"
  const filePath = `word/${target}`;
  const xml = await zip.file(filePath)?.async("text");
  if (!xml) return [];

  const tree = xmlParser.parse(xml) as XmlNode[];

  // Find w:hdr or w:ftr
  const hdr = findFirst(tree, "w:hdr");
  const ftr = findFirst(tree, "w:ftr");
  const root = hdr ?? ftr;
  if (!root) return [];

  const rootChildren = (hdr ? root["w:hdr"] : root["w:ftr"]) as XmlNode[];
  const lines: string[] = [];

  for (const child of rootChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      const info = paragraphToLdoc(child, numInfo, styles, options, docRels);
      let line = info.line;
      if (info.alignment === "center" && !info.isEmpty) line = `@center ${line}`;
      else if (info.alignment === "right" && !info.isEmpty) line = `@right ${line}`;

      const indentTwips = info.isList ? 0 : (info.indentLeftTwips ?? 0);
      if (indentTwips > 0 && !info.isEmpty && shouldEmitIndent(options)) {
        line = `@indent=${formatTwipsAsPt(indentTwips)} ${line}`;
      }

      if (line) lines.push(line);
    } else if (key === "w:tbl") {
      lines.push(tableToLdoc(child));
    }
  }

  return lines;
}

async function extractMediaAssets(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const assets = new Map<string, Uint8Array>();
  
  // Look for files in word/media/
  const mediaFolder = zip.folder("word/media");
  if (!mediaFolder) return assets;
  
  const files: string[] = [];
  mediaFolder.forEach((relativePath) => {
    files.push(relativePath);
  });
  
  for (const relativePath of files) {
    const file = zip.file(`word/media/${relativePath}`);
    if (file) {
      const data = await file.async("uint8array");
      // Store with path relative to output: media/image1.png
      assets.set(`media/${relativePath}`, data);
    }
  }
  
  return assets;
}

export async function docxToLdoc(input: ArrayBuffer | Uint8Array | Buffer, options?: DecompilerOptions): Promise<DecompileResult> {
  const zip = await JSZip.loadAsync(input);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("Invalid .docx: missing word/document.xml");

  const numberingXml = await zip.file("word/numbering.xml")?.async("text");
  const numInfo = parseNumbering(numberingXml);

  const stylesXml = await zip.file("word/styles.xml")?.async("text");
  const spacingInfo = parseSpacingFromStylesXml(stylesXml);
  const paragraphStyles = parseParagraphStyles(stylesXml);

  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("text");
  const rels = relsXml ? parseDocumentRels(relsXml) : new Map<string, string>();
  
  // Parse footnotes
  const footnotesXml = await zip.file("word/footnotes.xml")?.async("text");
  const footnotes = parseFootnotes(footnotesXml);
  
  // Extract media assets
  const assets = await extractMediaAssets(zip);

  const tree = xmlParser.parse(documentXml) as XmlNode[];
  const body = findPath(tree, ["w:document", "w:body"]);
  if (!body) throw new Error("Invalid .docx: missing w:body");

  const bodyChildren = body["w:body"] as XmlNode[];

  // Collect font/size statistics and compute dominant style
  const docDefaults = parseDocumentDefaults(stylesXml);
  const fontStats = collectFontStatistics(bodyChildren);
  const dominantStyle = computeDominantStyle(fontStats, docDefaults);

  // Extract all used styles from the document (flattened)
  const usedStyles = extractUsedStyles(stylesXml, bodyChildren);

  // Find final sectPr for layout and header/footer references
  const finalSectPr = findFinalSectPr(bodyChildren);
  let layout: LayoutInfo = {};
  let hfRefs: HeaderFooterRefs = {};

  if (finalSectPr) {
    layout = parseLayoutFromSectPr(finalSectPr);
    hfRefs = parseHeaderFooterRefs(finalSectPr);
  }

  // Build output
  const output: string[] = [];

  // Emit layout directives as @document block
  const hasNonDefaultMargins = layout.margins && !(
    Math.abs(twipsToInches(layout.margins.top) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.right) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.bottom) - 1) < 0.05 &&
    Math.abs(twipsToInches(layout.margins.left) - 1) < 0.05
  );
  
  // Check if we have styles to emit (beyond just body defaults)
  const hasNonBodyStyles = Array.from(usedStyles.keys()).some(
    id => id !== "Normal" && (
      usedStyles.get(id)?.align !== undefined ||
      usedStyles.get(id)?.bold !== undefined ||
      usedStyles.get(id)?.italic !== undefined
    )
  );
  const hasDominantStyles = dominantStyle.font || dominantStyle.sizePt || hasNonBodyStyles;
  const hasLayoutSettings = hasNonDefaultMargins || layout.landscape || (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) || hasDominantStyles;

  if (hasLayoutSettings) {
    output.push("@document");
    
    if (hasNonDefaultMargins && layout.margins) {
      const { top, right, bottom, left } = layout.margins;
      output.push("  margins:");
      output.push(`    top: ${formatInches(twipsToInches(top))}in`);
      output.push(`    right: ${formatInches(twipsToInches(right))}in`);
      output.push(`    bottom: ${formatInches(twipsToInches(bottom))}in`);
      output.push(`    left: ${formatInches(twipsToInches(left))}in`);
    }
    
    if (layout.landscape) {
      output.push("  orientation: landscape");
    }
    
    if (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) {
      output.push(`  spacing:`);
      output.push(`    line: ${spacingInfo.lineMultiplier}`);
    }
    
    // Emit all used styles
    if (hasDominantStyles) {
      // Collect all style lines first to check if any exist
      const styleLines: string[] = [];
      
      // Body style lines
      const bodyLines: string[] = [];
      if (dominantStyle.font) {
        bodyLines.push(`      font: ${dominantStyle.font}`);
      }
      if (dominantStyle.sizePt) {
        bodyLines.push(`      size: ${dominantStyle.sizePt}pt`);
      }
      if (bodyLines.length > 0) {
        styleLines.push("    body:", ...bodyLines);
      }
      
      // Other used styles (headings, etc.)
      for (const [styleId, style] of usedStyles) {
        if (styleId === "Normal") continue; // Already handled as body
        
        const ldocKey = styleIdToLdocKey(styleId);
        const lines = styleToLdocLines(ldocKey, style, dominantStyle);
        if (lines.length > 0) {
          styleLines.push(...lines);
        }
      }
      
      // Only emit styles: block if there are actual styles
      if (styleLines.length > 0) {
        output.push("  styles:");
        output.push(...styleLines);
      }
    }
    
    output.push("");
  }

  // Emit header if present
  if (hfRefs.defaultHeader) {
    const headerLines = await parseHeaderFooterContent(zip, hfRefs.defaultHeader, rels, numInfo, paragraphStyles, options, rels);
    const nonEmptyLines = headerLines.filter((l) => l.trim());
    if (nonEmptyLines.length > 0) {
      output.push("@header\n" + nonEmptyLines.map((l) => `  ${l}`).join("\n"));
    }
  }

  // Emit footer if present
  if (hfRefs.defaultFooter) {
    const footerLines = await parseHeaderFooterContent(zip, hfRefs.defaultFooter, rels, numInfo, paragraphStyles, options, rels);
    const nonEmptyLines = footerLines.filter((l) => l.trim());
    if (nonEmptyLines.length > 0) {
      output.push("@footer\n" + nonEmptyLines.map((l) => `  ${l}`).join("\n"));
    }
  }

  // Partition body children into sections based on sectPr in paragraph pPr
  type Section = {
    props?: SectionProps;
    children: XmlNode[];
  };

  const sections: Section[] = [];
  let currentSection: Section = { children: [] };

  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);

    if (key === "w:sectPr") {
      // Final sectPr - handled separately for layout
      continue;
    }

    if (key === "w:p") {
      // Check for sectPr in paragraph
      const pSectPr = findParagraphSectPr(child);
      if (pSectPr) {
        // This paragraph ends a section
        currentSection.children.push(child);
        currentSection.props = parseSectionProps(pSectPr);
        sections.push(currentSection);
        currentSection = { children: [] };
        continue;
      }
    }

    currentSection.children.push(child);
  }

  // Push remaining content as the final section
  if (currentSection.children.length > 0) {
    if (finalSectPr) {
      currentSection.props = parseSectionProps(finalSectPr);
    }
    sections.push(currentSection);
  }

  // Convert sections to LDOC
  const blocks: string[] = [];
  
  // Merge dominant style into options for paragraph processing
  const enhancedOptions: DecompilerOptions = {
    ...options,
    dominantStyle,
  };

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const isColumnsSection = section.props?.cols && section.props.cols > 1;

    if (isColumnsSection) {
      // Emit @columns block
      const cols = section.props!.cols!;
      let columnsLine = `@columns ${cols}`;

      if (section.props!.colSpace !== undefined) {
        const gapIn = formatInches(twipsToInches(section.props!.colSpace));
        columnsLine += ` gap=${gapIn}in`;
      }

      if (section.props!.colSep) {
        columnsLine += " separator";
      }

      // Collect content lines for columns block
      const contentLines = processChildren(section.children, numInfo, paragraphStyles, enhancedOptions, "  ", rels);
      const nonEmptyLines = contentLines.filter((l) => l.trim());

      // Emit as a single block
      blocks.push(columnsLine + "\n" + nonEmptyLines.join("\n") + "\n@end");
    } else {
      // Normal section - emit blocks with alignment grouping
      const lines = processChildren(section.children, numInfo, paragraphStyles, enhancedOptions, "", rels);
      blocks.push(...lines);
    }
  }

  // Combine output
  const finalOutput = [...output, ...blocks];

  // Emit footnote definitions at the end
  if (footnotes.size > 0) {
    finalOutput.push(""); // blank line before footnotes
    for (const [id, fn] of footnotes) {
      finalOutput.push(`[^${id}]: ${fn.content}`);
    }
  }

  // Join, preserve at most one blank line between blocks, clean up trailing whitespace
  const joined = finalOutput.join("\n");
  const trimmedTrailing = joined
    .split("\n")
    .map((line) => {
      // Preserve indentation-only blank lines inside modifier blocks.
      if (!line.trim()) return line;
      // Preserve double-space at end (hard break marker), strip other trailing whitespace
      const hardBreak = line.endsWith("  ");
      const trimmed = line.replace(/[ \t]+$/g, "");
      return hardBreak ? trimmed + "  " : trimmed;
    })
    .join("\n");

  const source = trimmedTrailing.trim();
  return { source, assets };
}
