import { getOnlyKey, type XmlNode, attrVal, findFirst } from "../xml";
import { normalizeWs } from "./run";
import { paragraphText, paragraphToLdoc, type DecompilerOptions, type ParagraphInfo } from "./paragraph";
import { joinBlockContent, type BlockParagraph } from "./block-content";
import { processChildren } from "../generator";
import type { NumberingInfo } from "../parsers/numbering";
import type { ParagraphStyleMap } from "../parsers/styles";
import { formatTwipsAsInches, formatTwipsAsPt } from "../../shared/units";

/** Parsed cell margins (twips) */
interface CellMargins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Parsed row height info */
interface RowHeight {
  value: number;
  rule: "auto" | "atLeast" | "exact";
}

interface CellInfo {
  paragraphNodes: XmlNode[]; // Store raw nodes for delegation
  text: string; // Keep for simple cells
  colspan: number;
  vMerge: "restart" | "continue" | null;
  // Computed
  rowspan: number;
  isCovered: boolean;
  // Phase 1: styling
  padding?: CellMargins;
  background?: string; // hex without #
}

interface RowInfo {
  cells: CellInfo[];
  height?: RowHeight;
  isHeader?: boolean;
}

/**
 * Check if table has visible borders.
 * Returns true if w:tblBorders exists with at least one non-nil border.
 */
function parseTableBorders(tblNode: XmlNode): boolean {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const tblPr = findFirst(tblChildren, "w:tblPr");
  if (!tblPr) return false;
  const prChildren = tblPr["w:tblPr"] as XmlNode[];
  const borders = findFirst(prChildren, "w:tblBorders");
  if (!borders) return false;
  const borderChildren = borders["w:tblBorders"] as XmlNode[];
  // Check if any border has a visible style (not "nil" or "none")
  for (const b of borderChildren ?? []) {
    const val = attrVal(b, "@_w:val");
    if (val && val !== "nil" && val !== "none") {
      return true;
    }
  }
  return false;
}

function parseTableIndent(tblNode: XmlNode): number | undefined {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const tblPr = findFirst(tblChildren, "w:tblPr");
  if (!tblPr) return undefined;
  const prChildren = tblPr["w:tblPr"] as XmlNode[];
  const ind = findFirst(prChildren, "w:tblInd");
  const w = attrVal(ind, "@_w:w");
  if (!w) return undefined;
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse cell padding from w:tcMar
 */
function parseCellMargins(tcPrChildren: XmlNode[]): CellMargins | undefined {
  for (const prop of tcPrChildren) {
    const pk = getOnlyKey(prop);
    if (pk === "w:tcMar") {
      const margins: CellMargins = {};
      const marChildren = prop["w:tcMar"] as XmlNode[];
      for (const m of marChildren ?? []) {
        const mk = getOnlyKey(m);
        if (mk === "w:top") {
          const w = attrVal(m, "@_w:w");
          if (w !== undefined) margins.top = parseInt(w, 10);
        } else if (mk === "w:right" || mk === "w:end") {
          const w = attrVal(m, "@_w:w");
          if (w !== undefined) margins.right = parseInt(w, 10);
        } else if (mk === "w:bottom") {
          const w = attrVal(m, "@_w:w");
          if (w !== undefined) margins.bottom = parseInt(w, 10);
        } else if (mk === "w:left" || mk === "w:start") {
          const w = attrVal(m, "@_w:w");
          if (w !== undefined) margins.left = parseInt(w, 10);
        }
      }
      if (margins.top !== undefined || margins.right !== undefined ||
          margins.bottom !== undefined || margins.left !== undefined) {
        return margins;
      }
    }
  }
  return undefined;
}

/**
 * Parse cell background from w:shd
 * Returns undefined for default header shading (F2F2F2) since compiler adds it automatically
 */
function parseCellBackground(tcPrChildren: XmlNode[]): string | undefined {
  for (const prop of tcPrChildren) {
    const pk = getOnlyKey(prop);
    if (pk === "w:shd") {
      const fill = attrVal(prop, "@_w:fill");
      if (fill && fill !== "auto" && /^[0-9A-Fa-f]{6}$/.test(fill)) {
        const upper = fill.toUpperCase();
        // Skip default header shading - the compiler adds F2F2F2 for headers automatically
        if (upper === "F2F2F2") return undefined;
        return upper;
      }
    }
  }
  return undefined;
}

/**
 * Parse row height from w:trPr/w:trHeight
 */
function parseRowHeight(trChildren: XmlNode[]): RowHeight | undefined {
  for (const child of trChildren) {
    const k = getOnlyKey(child);
    if (k === "w:trPr") {
      const trPrChildren = child["w:trPr"] as XmlNode[];
      for (const prop of trPrChildren ?? []) {
        const pk = getOnlyKey(prop);
        if (pk === "w:trHeight") {
          const val = attrVal(prop, "@_w:val");
          const hRule = attrVal(prop, "@_w:hRule");
          if (val) {
            const value = parseInt(val, 10);
            let rule: "auto" | "atLeast" | "exact" = "atLeast";
            if (hRule === "auto") rule = "auto";
            else if (hRule === "exact") rule = "exact";
            return { value, rule };
          }
        }
      }
    }
  }
  return undefined;
}

function parseRowIsHeader(trChildren: XmlNode[]): boolean {
  for (const child of trChildren) {
    const k = getOnlyKey(child);
    if (k === "w:trPr") {
      const trPrChildren = child["w:trPr"] as XmlNode[];
      const tblHeader = findFirst(trPrChildren, "w:tblHeader");
      if (tblHeader) return true;
    }
  }
  return false;
}

function parseCellProperties(tcChildren: XmlNode[]): {
  colspan: number;
  vMerge: "restart" | "continue" | null;
  padding?: CellMargins;
  background?: string;
} {
  let colspan = 1;
  let vMerge: "restart" | "continue" | null = null;
  let padding: CellMargins | undefined;
  let background: string | undefined;

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
      // Parse padding and background
      padding = parseCellMargins(tcPrChildren);
      background = parseCellBackground(tcPrChildren);
    }
  }

  return { colspan, vMerge, padding, background };
}

// Strip fully-bold markdown from header cells (since header implies bold headers)
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

function parseTableGrid(tblNode: XmlNode): number[] | undefined {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const tblGrid = findFirst(tblChildren, "w:tblGrid");
  if (!tblGrid) return undefined;

  const gridCols = tblGrid["w:tblGrid"] as XmlNode[];
  if (!gridCols || gridCols.length === 0) return undefined;

  const widths: number[] = [];
  for (const col of gridCols) {
    if (getOnlyKey(col) === "w:gridCol") {
      const w = attrVal(col, "@_w:w");
      if (w) {
        widths.push(parseInt(w, 10));
      } else {
        // Default width? Or skip?
        // If w is missing, it might be auto.
        // For now, let's just push 0 or handle it?
        // If we have mixed explicit/implicit, it's tricky.
        // But usually w:gridCol has w:w.
        widths.push(0);
      }
    }
  }
  
  // If all are 0 or empty, return undefined
  if (widths.length === 0 || widths.every(w => w === 0)) return undefined;
  
  return widths;
}

export function tableToLdoc(
  tblNode: XmlNode,
  numInfo: NumberingInfo,
  paragraphStyles: ParagraphStyleMap,
  options?: DecompilerOptions,
  rels?: Map<string, string>
): string {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const rows: RowInfo[] = [];

  // Extract column widths
  const colWidths = parseTableGrid(tblNode);
  const tblIndent = parseTableIndent(tblNode);
  const hasBorders = parseTableBorders(tblNode);

  // Pass 1: Build Grid
  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k !== "w:tr") continue;
    const trChildren = tr["w:tr"] as XmlNode[];
    const rowCells: CellInfo[] = [];

    // Parse row height/header
    const rowHeight = parseRowHeight(trChildren);
    const isHeaderRow = parseRowIsHeader(trChildren);

    for (const tc of trChildren ?? []) {
      const kk = getOnlyKey(tc);
      if (kk !== "w:tc") continue;
      const tcChildren = tc["w:tc"] as XmlNode[];

      const { colspan, vMerge, padding, background } = parseCellProperties(tcChildren);

      const paragraphNodes: XmlNode[] = [];
      const paras: BlockParagraph[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          paragraphNodes.push(p);
          const t = paragraphText(p);
          // Treat hard-break-only content ("  \n" -> line ending with two spaces) as non-empty.
          // This matters when a paragraph contains only w:br/w:cr: it is not an empty paragraph.
          const normalized = t.endsWith("\n") ? t.replace(/\n+$/g, "") : t;
          const isEmpty = normalized.trim().length === 0 && !normalized.endsWith("  ");
          paras.push({ content: normalized, isEmpty });
        }
      }

      // Don't trim end here; trailing two-space hard-break markers are significant.
      const cellText = normalizeWs(joinBlockContent(paras), false, false);

      // Strip bold from header row cells
      const finalText = isHeaderRow ? stripHeaderBold(cellText) : cellText;

      const cell: CellInfo = {
        paragraphNodes,
        text: finalText,
        colspan,
        vMerge,
        rowspan: 1,
        isCovered: false,
        padding,
        background,
      };

      rowCells.push(cell);
    }
    rows.push({ cells: rowCells, height: rowHeight, isHeader: isHeaderRow });
  }

  // Pass 1.5: Expand grid for alignment (virtual grid)
  const expandedGrid: (CellInfo | null)[][] = [];
  for (const row of rows) {
    const expandedRow: (CellInfo | null)[] = [];
    for (const cell of row.cells) {
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
  const tableArgs: string[] = [];
  if (colWidths && colWidths.length > 0) {
    tableArgs.push(`widths: [${colWidths.map(w => formatTwipsAsInches(w)).join(", ")}]`);
  }
  if (tblIndent !== undefined && tblIndent !== 0) {
    tableArgs.push(`indent: ${formatTwipsAsPt(tblIndent)}`);
  }
  if (hasBorders) {
    tableArgs.push("border: true");
  }
  let headerLine = "@table";
  if (tableArgs.length > 0) {
    headerLine += `(${tableArgs.join(", ")})`;
  }
  const output: string[] = [headerLine];
  
  for (const rowInfo of rows) {
    // Build row attributes
    const rowAttrParts: string[] = [];
    if (rowInfo.isHeader) {
      rowAttrParts.push("header");
    }
    if (rowInfo.height) {
      rowAttrParts.push(`height: ${formatTwipsAsPt(rowInfo.height.value)}`);
      rowAttrParts.push(`heightRule: ${rowInfo.height.rule}`);
    }
    const rowAttrs = rowAttrParts.length > 0 ? `(${rowAttrParts.join(", ")})` : "";
    output.push(`  @row${rowAttrs}`);

    for (const cell of rowInfo.cells) {
      if (cell.isCovered) continue; // Skip cells merged into a rowspan above

      const attrParts: string[] = [];
      if (cell.colspan > 1) attrParts.push(`colspan: ${cell.colspan}`);
      if (cell.rowspan > 1) attrParts.push(`rowspan: ${cell.rowspan}`);
      
      // Cell padding
      if (cell.padding) {
        const p = cell.padding;
        const paddingStr = formatPadding(p.top, p.right, p.bottom, p.left);
        if (paddingStr) {
          attrParts.push(`padding: ${paddingStr}`);
        }
      }
      
      // Cell background
      if (cell.background) {
        attrParts.push(`background: "#${cell.background}"`);
      }
      
      const attrs = attrParts.length > 0 ? `(${attrParts.join(", ")})` : "";
      
      const text = cell.text;
      const isMultiline = text.includes("\n");
      const paragraphs = cell.paragraphNodes;
      
      // Use shorthand for simple single-line cells (only if no special attrs like padding/background)
      // Must be single paragraph, simple (no alignment), and short enough
      let isSimple = false;
      const hasStyleAttrs = cell.padding !== undefined || cell.background !== undefined;
      if (paragraphs.length === 1 && !isMultiline && text.length < 80 && !hasStyleAttrs) {
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
            const tableOptions: DecompilerOptions | undefined = options ? { ...options, inTable: true } : { inTable: true };
            const cellLines = processChildren(
              paragraphs,
              numInfo,
              paragraphStyles,
              tableOptions,
              "      ", // 6 spaces indentation
              rels
            );

            // If the cell starts with one or more empty DOCX paragraphs, we need
            // an extra blank line to allow the parser's `pushBlankLines` rule
            // (3+ newlines => empty_paragraph) to encode leading empties.
            // Between the @cell line and the first indented content line we already
            // have 1 newline; we add 1 more to make the math work for leading empties.
            let leadEmpty = 0;
            while (leadEmpty < cellLines.length && cellLines[leadEmpty] === "") {
              leadEmpty++;
            }
            if (leadEmpty > 0) {
              output.push("");
            }
            output.push(...cellLines);
            
            // If processChildren returns lines, add them
            // But wait, processChildren adds indentation to the lines.
            // We passed "      " as base indent.
            // So cellLines are already indented.
          }
      }
    }
  }

  return output.join("\n");
}

/**
 * Format padding as a compact string:
 * - single value if all equal: "6pt"
 * - [v, h] if top==bottom and left==right: "[6pt, 12pt]"
 * - [t, r, b, l] otherwise: "[1pt, 2pt, 3pt, 4pt]"
 */
function formatPadding(top?: number, right?: number, bottom?: number, left?: number): string | undefined {
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined;
  }
  const t = top ?? 0;
  const r = right ?? 0;
  const b = bottom ?? 0;
  const l = left ?? 0;

  if (t === b && l === r && t === l) {
    // All equal
    return formatTwipsAsPt(t);
  }
  if (t === b && l === r) {
    // [vertical, horizontal]
    return `[${formatTwipsAsPt(t)}, ${formatTwipsAsPt(l)}]`;
  }
  // [top, right, bottom, left]
  return `[${formatTwipsAsPt(t)}, ${formatTwipsAsPt(r)}, ${formatTwipsAsPt(b)}, ${formatTwipsAsPt(l)}]`;
}
