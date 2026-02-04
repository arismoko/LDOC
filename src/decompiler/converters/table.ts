import { getOnlyKey, type XmlNode } from "../xml";
import { normalizeWs } from "./run";
import { paragraphText, paragraphToLdoc, type DecompilerOptions, type ParagraphInfo } from "./paragraph";
import { joinBlockContent, stringsToBlockContent } from "./block-content";
import { processChildren } from "../generator";
import type { NumberingInfo } from "../parsers/numbering";
import type { ParagraphStyleMap } from "../parsers/styles";

interface CellInfo {
  paragraphNodes: XmlNode[]; // Store raw nodes for delegation
  text: string; // Keep for simple cells
  colspan: number;
  vMerge: "restart" | "continue" | null;
  // Computed
  rowspan: number;
  isCovered: boolean;
}

function parseCellProperties(tcChildren: XmlNode[]): { colspan: number; vMerge: "restart" | "continue" | null } {
  let colspan = 1;
  let vMerge: "restart" | "continue" | null = null;

  for (const child of tcChildren) {
    const k = getOnlyKey(child);
    if (k === "w:tcPr") {
      const tcPrChildren = child["w:tcPr"] as XmlNode[];
      for (const prop of tcPrChildren ?? []) {
        const pk = getOnlyKey(prop);
        if (pk === "w:gridSpan") {
          const attrs = prop["@"] as Record<string, string> | undefined;
          if (attrs?.["w:val"]) {
            colspan = parseInt(attrs["w:val"], 10) || 1;
          }
        }
        if (pk === "w:vMerge") {
          const attrs = prop["@"] as Record<string, string> | undefined;
          if (attrs?.["w:val"] === "restart") {
            vMerge = "restart";
          } else {
            vMerge = "continue"; // No val or val != restart implies continue
          }
        }
      }
    }
  }

  return { colspan, vMerge };
}

// Strip fully-bold markdown from header cells (since @table implies bold headers)
function stripHeaderBold(text: string): string {
  const match = text.match(/^\*\*(.+)\*\*$/);
  return match ? match[1]! : text;
}

// Helper to check if a paragraph is "simple" (no alignment, no special styles)
function isSimpleCell(info: ParagraphInfo): boolean {
  // Check if spacing is just the default { after: 0 } which tables imply
  const isDefaultSpacing = !info.spacing || (
    info.spacing.after === 0 && 
    info.spacing.before === undefined
  );

  return (
    !info.alignment &&
    !info.isHeading &&
    !info.isList &&
    !info.isBlockquote &&
    !info.styleAttrs &&
    isDefaultSpacing &&
    (info.indentLeftTwips ?? 0) === 0
  );
}

export function tableToLdoc(
  tblNode: XmlNode,
  numInfo: NumberingInfo,
  paragraphStyles: ParagraphStyleMap,
  options?: DecompilerOptions,
  rels?: Map<string, string>
): string {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const grid: CellInfo[][] = [];
  let isFirstRow = true;

  // Pass 1: Build Grid
  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k !== "w:tr") continue;
    const trChildren = tr["w:tr"] as XmlNode[];
    const row: CellInfo[] = [];

    for (const tc of trChildren ?? []) {
      const kk = getOnlyKey(tc);
      if (kk !== "w:tc") continue;
      const tcChildren = tc["w:tc"] as XmlNode[];

      const { colspan, vMerge } = parseCellProperties(tcChildren);

      const paragraphNodes: XmlNode[] = [];
      const paras: string[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          paragraphNodes.push(p);
          const t = paragraphText(p);
          paras.push(t);
        }
      }
      
      const cellText = normalizeWs(joinBlockContent(stringsToBlockContent(paras)));

      // Strip bold from header row cells (first row)
      const finalText = isFirstRow ? stripHeaderBold(cellText) : cellText;

      const cell: CellInfo = {
        paragraphNodes,
        text: finalText,
        colspan,
        vMerge,
        rowspan: 1,
        isCovered: false,
      };

      row.push(cell);
    }
    grid.push(row);
    isFirstRow = false;
  }

  // Pass 1.5: Expand grid for alignment (virtual grid)
  const expandedGrid: (CellInfo | null)[][] = [];
  for (const row of grid) {
    const expandedRow: (CellInfo | null)[] = [];
    for (const cell of row) {
      expandedRow.push(cell);
      for (let i = 1; i < cell.colspan; i++) {
        expandedRow.push(null); // Covered by colspan
      }
    }
    expandedGrid.push(expandedRow);
  }

  // Pass 2: Calculate Rowspans
  for (let r = 0; r < expandedGrid.length; r++) {
    const row = expandedGrid[r];
    if (!row) continue;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue; // Covered by colspan

      if (cell.vMerge === "restart") {
        let span = 1;
        // Look down
        while (r + span < expandedGrid.length) {
          const nextRow = expandedGrid[r + span];
          if (!nextRow) break;

          const nextCell = nextRow[c];
          
          if (nextCell && nextCell.vMerge === "continue") {
            nextCell.isCovered = true;
            span++;
          } else {
            break;
          }
        }
        cell.rowspan = span;
      }
    }
  }

  // Pass 3: Emit
  const output: string[] = ["@table"];
  
  for (const row of grid) {
    output.push("  @row");
    for (const cell of row) {
      if (cell.isCovered) continue; // Skip cells merged into a rowspan above

      let attrs = "";
      if (cell.colspan > 1) attrs += ` colspan=${cell.colspan}`;
      if (cell.rowspan > 1) attrs += ` rowspan=${cell.rowspan}`;
      
      const text = cell.text;
      const isMultiline = text.includes("\n");
      const paragraphs = cell.paragraphNodes;
      
      // Use shorthand for simple single-line cells
      // Must be single paragraph, simple (no alignment), and short enough
      let isSimple = false;
      if (paragraphs.length === 1 && !isMultiline && text.length < 80) {
        const firstParaInfo = paragraphToLdoc(paragraphs[0]!, numInfo, paragraphStyles, options, rels);
        isSimple = isSimpleCell(firstParaInfo);
      }

      if (isSimple) {
         output.push(`    @cell${attrs}: ${text}`);
      } else {
         // Block form: delegate to processChildren
         output.push(`    @cell${attrs}`);
         
         // If we have content, delegate to processChildren
         if (paragraphs.length > 0) {
           const cellLines = processChildren(
             paragraphs,
             numInfo,
             paragraphStyles,
             options,
             "      ", // 6 spaces indentation
             rels
           );
           
           // If processChildren returns lines, add them
           // But wait, processChildren adds indentation to the lines.
           // We passed "      " as base indent.
           // So cellLines are already indented.
           output.push(...cellLines);
         }
      }
    }
  }

  return output.join("\n");
}
