/**
 * Table Extraction
 *
 * Extracts table data from DOCX XML without generating LDOC syntax.
 */

import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";
import { extractParagraph } from "./paragraph";
import type { ParagraphStyleMap } from "../parsers/styles";
import type {
  ExtractedTable,
  ExtractedTableRow,
  ExtractedTableCell,
  ExtractedCellMargins,
  ExtractedRowHeight,
  ExtractedParagraph,
} from "./types";

/**
 * Check if table has visible borders.
 */
function extractTableBorders(tblNode: XmlNode): boolean {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const tblPr = findFirst(tblChildren, "w:tblPr");
  if (!tblPr) return false;
  const prChildren = tblPr["w:tblPr"] as XmlNode[];
  const borders = findFirst(prChildren, "w:tblBorders");
  if (!borders) return false;
  const borderChildren = borders["w:tblBorders"] as XmlNode[];
  
  for (const b of borderChildren ?? []) {
    const val = attrVal(b, "@_w:val");
    if (val && val !== "nil" && val !== "none") {
      return true;
    }
  }
  return false;
}

/**
 * Extract table indent in twips.
 */
function extractTableIndent(tblNode: XmlNode): number | undefined {
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
 * Extract column widths from w:tblGrid.
 */
function extractColumnWidths(tblNode: XmlNode): number[] | undefined {
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
        widths.push(0);
      }
    }
  }

  if (widths.length === 0 || widths.every(w => w === 0)) return undefined;
  return widths;
}

/**
 * Extract cell margins from w:tcMar.
 */
function extractCellMargins(tcPrChildren: XmlNode[]): ExtractedCellMargins | undefined {
  for (const prop of tcPrChildren) {
    const pk = getOnlyKey(prop);
    if (pk === "w:tcMar") {
      const margins: ExtractedCellMargins = {};
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
 * Extract cell background from w:shd.
 * Returns undefined for default header shading (F2F2F2).
 */
function extractCellBackground(tcPrChildren: XmlNode[]): string | undefined {
  for (const prop of tcPrChildren) {
    const pk = getOnlyKey(prop);
    if (pk === "w:shd") {
      const fill = attrVal(prop, "@_w:fill");
      if (fill && fill !== "auto" && /^[0-9A-Fa-f]{6}$/.test(fill)) {
        const upper = fill.toUpperCase();
        // Skip default header shading
        if (upper === "F2F2F2") return undefined;
        return upper;
      }
    }
  }
  return undefined;
}

/**
 * Extract row height from w:trPr/w:trHeight.
 */
function extractRowHeight(trChildren: XmlNode[]): ExtractedRowHeight | undefined {
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

/**
 * Check if row is a header row.
 */
function extractRowIsHeader(trChildren: XmlNode[]): boolean {
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

/**
 * Extract cell properties from w:tcPr.
 */
function extractCellProperties(tcChildren: XmlNode[]): {
  colspan: number;
  vMerge: "restart" | "continue" | null;
  padding?: ExtractedCellMargins;
  background?: string;
} {
  let colspan = 1;
  let vMerge: "restart" | "continue" | null = null;
  let padding: ExtractedCellMargins | undefined;
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
            vMerge = "continue";
          }
        }
      }
      padding = extractCellMargins(tcPrChildren);
      background = extractCellBackground(tcPrChildren);
    }
  }

  return { colspan, vMerge, padding, background };
}

/**
 * Extract a table cell.
 */
function extractTableCell(
  tcNode: XmlNode,
  styles: ParagraphStyleMap,
  rels?: Map<string, string>
): ExtractedTableCell {
  const tcChildren = tcNode["w:tc"] as XmlNode[];
  const { colspan, vMerge, padding, background } = extractCellProperties(tcChildren);

  const paragraphs: ExtractedParagraph[] = [];
  for (const p of tcChildren ?? []) {
    const pk = getOnlyKey(p);
    if (pk === "w:p") {
      paragraphs.push(extractParagraph(p, styles, rels));
    }
  }

  return {
    paragraphs,
    colspan,
    vMerge,
    rowspan: 1, // Computed in post-processing
    isCovered: false, // Computed in post-processing
    padding,
    background,
  };
}

/**
 * Extract a table row.
 */
function extractTableRow(
  trNode: XmlNode,
  styles: ParagraphStyleMap,
  rels?: Map<string, string>
): ExtractedTableRow {
  const trChildren = trNode["w:tr"] as XmlNode[];
  const cells: ExtractedTableCell[] = [];

  for (const tc of trChildren ?? []) {
    const kk = getOnlyKey(tc);
    if (kk === "w:tc") {
      cells.push(extractTableCell(tc, styles, rels));
    }
  }

  return {
    cells,
    height: extractRowHeight(trChildren),
    isHeader: extractRowIsHeader(trChildren),
  };
}

/**
 * Compute rowspans from vertical merge markers.
 * Modifies cells in place.
 */
function computeRowspans(rows: ExtractedTableRow[]): void {
  // Expand grid for alignment (virtual grid)
  const expandedGrid: (ExtractedTableCell | null)[][] = [];
  for (const row of rows) {
    const expandedRow: (ExtractedTableCell | null)[] = [];
    for (const cell of row.cells) {
      expandedRow.push(cell);
      for (let i = 1; i < cell.colspan; i++) {
        expandedRow.push(null);
      }
    }
    expandedGrid.push(expandedRow);
  }

  // Calculate rowspans
  for (let r = 0; r < expandedGrid.length; r++) {
    const row = expandedGrid[r];
    if (!row) continue;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;

      if (cell.vMerge === "restart") {
        let span = 1;
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
}

/**
 * Extract a table from DOCX XML.
 */
export function extractTable(
  tblNode: XmlNode,
  styles: ParagraphStyleMap,
  rels?: Map<string, string>
): ExtractedTable {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const rows: ExtractedTableRow[] = [];

  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k === "w:tr") {
      rows.push(extractTableRow(tr, styles, rels));
    }
  }

  // Compute rowspans from vertical merge markers
  computeRowspans(rows);

  return {
    type: "table",
    rows,
    columnWidths: extractColumnWidths(tblNode),
    indent: extractTableIndent(tblNode),
    hasBorders: extractTableBorders(tblNode),
  };
}
