import JSZip from "jszip";
import { xmlParser, findFirst, findPath, getOnlyKey, type XmlNode } from "./xml";
import { parseNumbering, type NumberingInfo } from "./parsers/numbering";
import { parseSpacingFromStylesXml, parseParagraphStyles, parseDocumentDefaults, extractUsedStyles, styleIdToLdocKey, styleToLdocLines, type ParagraphStyleMap } from "./parsers/styles";
import { collectFontStatistics, computeDominantStyle, type FontSizeStats } from "./statistics";
import { parseDocumentRels, parseLayoutFromSectPr, parseHeaderFooterRefs, parseSectionProps, findFinalSectPr, findParagraphSectPr, type LayoutInfo, type HeaderFooterRefs, type SectionProps } from "./parsers/layout";
import { parseFootnotes, type FootnoteInfo } from "./parsers/footnotes";
import { type DecompilerOptions } from "./converters/paragraph";
import { processChildren } from "./generator";
import { twipsToInches, formatInches, formatTwipsAsPt } from "../shared/units";

export type { DecompilerOptions };

export type DecompileResult = {
  source: string;
  assets: Map<string, Uint8Array>;
};

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
  
  // Use unified processChildren pipeline for proper alignment/spacing/anchor support
  return processChildren(rootChildren ?? [], numInfo, styles, options, "", docRels);
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
  const footnotes = parseFootnotes(footnotesXml, numInfo, paragraphStyles, options, rels);
  
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
  // Default header/footer distances in docx lib are ~720 twips (0.5in)
  const DEFAULT_HF_DISTANCE = 720;
  const hasNonDefaultHfDistances = layout.margins && (
    (layout.margins.header !== undefined && Math.abs(layout.margins.header - DEFAULT_HF_DISTANCE) > 50) ||
    (layout.margins.footer !== undefined && Math.abs(layout.margins.footer - DEFAULT_HF_DISTANCE) > 50)
  );
  const hasNonDefaultMargins = layout.margins && (
    Math.abs(twipsToInches(layout.margins.top) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.right) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.bottom) - 1) >= 0.05 ||
    Math.abs(twipsToInches(layout.margins.left) - 1) >= 0.05 ||
    hasNonDefaultHfDistances
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
  const hasLayoutSettings =
    hasNonDefaultMargins ||
    layout.landscape ||
    (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) ||
    spacingInfo?.beforeTwip !== undefined ||
    spacingInfo?.afterTwip !== undefined ||
    hasDominantStyles;

  if (hasLayoutSettings) {
    output.push("@document");
    
    if (hasNonDefaultMargins && layout.margins) {
      const { top, right, bottom, left } = layout.margins;
      output.push("  margins:");
      output.push(`    top: ${formatInches(twipsToInches(top))}in`);
      output.push(`    right: ${formatInches(twipsToInches(right))}in`);
      output.push(`    bottom: ${formatInches(twipsToInches(bottom))}in`);
      output.push(`    left: ${formatInches(twipsToInches(left))}in`);
      if (layout.margins.header !== undefined && Math.abs(layout.margins.header - DEFAULT_HF_DISTANCE) > 50) {
        output.push(`    header: ${formatInches(twipsToInches(layout.margins.header))}in`);
      }
      if (layout.margins.footer !== undefined && Math.abs(layout.margins.footer - DEFAULT_HF_DISTANCE) > 50) {
        output.push(`    footer: ${formatInches(twipsToInches(layout.margins.footer))}in`);
      }
    }
    
    if (layout.landscape) {
      output.push("  orientation: landscape");
    }
    
    if (
      (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) ||
      spacingInfo?.beforeTwip !== undefined ||
      spacingInfo?.afterTwip !== undefined
    ) {
      output.push(`  spacing:`);
      if (spacingInfo?.lineMultiplier && spacingInfo.lineMultiplier !== 1.0) {
        output.push(`    line: ${spacingInfo.lineMultiplier}`);
      }
      if (spacingInfo?.beforeTwip !== undefined) {
        output.push(`    before: ${formatTwipsAsPt(spacingInfo.beforeTwip)}`);
      }
      if (spacingInfo?.afterTwip !== undefined) {
        output.push(`    after: ${formatTwipsAsPt(spacingInfo.afterTwip)}`);
      }
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
      // Add default alignment if justify (most common non-default)
      if (spacingInfo?.align === "justify") {
        bodyLines.push(`      align: justify`);
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
  const emitHeaderFooterBlock = async (
    prefix: "" | "@firstpage " | "@evenpage ",
    kind: "header" | "footer",
    rId: string,
  ): Promise<void> => {
    const lines = await parseHeaderFooterContent(zip, rId, rels, numInfo, paragraphStyles, options, rels);
    
    // Filter out whitespace-only content (@tab, @nbsp, @br are not meaningful content)
    const whitespaceTokens = /^@(tab|nbsp|br)$/;
    const hasContent = (l: string): boolean => {
      const trimmed = l.trim();
      if (!trimmed) return false;
      // Check if line is just a whitespace token, possibly nested in @style
      const withoutStyle = trimmed.replace(/@style\([^)]*\)\s*/g, "").trim();
      return withoutStyle !== "" && !whitespaceTokens.test(withoutStyle);
    };
    
    const meaningfulLines = lines.filter(hasContent);
    
    // Skip header/footer blocks with no meaningful content
    if (meaningfulLines.length === 0) {
      return;
    }

    const header = `${prefix}@${kind}`.trim();
    const nonEmptyLines = lines.filter((l) => l.trim());
    output.push(header + "\n" + nonEmptyLines.map((l) => `  ${l}`).join("\n") + "\n@end");
  };

  if (hfRefs.defaultHeader) await emitHeaderFooterBlock("", "header", hfRefs.defaultHeader);
  if (hfRefs.firstHeader) await emitHeaderFooterBlock("@firstpage ", "header", hfRefs.firstHeader);
  if (hfRefs.evenHeader) await emitHeaderFooterBlock("@evenpage ", "header", hfRefs.evenHeader);

  if (hfRefs.defaultFooter) await emitHeaderFooterBlock("", "footer", hfRefs.defaultFooter);
  if (hfRefs.firstFooter) await emitHeaderFooterBlock("@firstpage ", "footer", hfRefs.firstFooter);
  if (hfRefs.evenFooter) await emitHeaderFooterBlock("@evenpage ", "footer", hfRefs.evenFooter);

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
      const parts: string[] = [String(cols)];

      if (section.props!.colSpace !== undefined) {
        const gapIn = formatInches(twipsToInches(section.props!.colSpace));
        parts.push(`gap: ${gapIn}in`);
      }

      if (section.props!.colSep) {
        parts.push("separator");
      }

      const columnsLine = `@columns(${parts.join(", ")})`;

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
  // If body begins with blank lines, add one extra to preserve leading empty paragraphs.
  // In LDOC semantics, 3+ newlines are needed to encode empty paragraphs; the boundary
  // between @document preamble and body otherwise under-counts by one.
  const bodyBlocks = blocks.length > 0 && blocks[0] === "" ? ["", ...blocks] : blocks;
  const finalOutput = [...output, ...bodyBlocks];

  // Emit footnote definitions at the end
  if (footnotes.size > 0) {
    finalOutput.push(""); // blank line before footnotes
    for (const [id, fn] of footnotes) {
      if (fn.contentLines.length === 1) {
        // Single line: [^id]: line
        finalOutput.push(`[^${id}]: ${fn.contentLines[0]}`);
      } else {
        // Multi-line:
        // [^id]:
        //   Line 1
        //   Line 2
        finalOutput.push(`[^${id}]:`);
        for (const line of fn.contentLines) {
          finalOutput.push(`  ${line}`);
        }
      }
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
