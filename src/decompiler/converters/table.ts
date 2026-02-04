import { getOnlyKey, type XmlNode } from "../xml";
import { normalizeWs } from "./run";
import { paragraphText } from "./paragraph";

interface CellInfo {
  text: string;
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

export function tableToLdoc(tblNode: XmlNode): string {
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

      const paras: string[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          const t = paragraphText(p);
          paras.push(t);
        }
      }
      const cellText = normalizeWs(paras.join("\n\n")); // Double newline for paragraphs

      // Strip bold from header row cells (first row)
      const finalText = isFirstRow ? stripHeaderBold(cellText) : cellText;

      const cell: CellInfo = {
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
      
      // Use shorthand for simple single-line cells
      if (!isMultiline && text.length < 80) {
         output.push(`    @cell${attrs}: ${text}`);
      } else {
         // Block form
         output.push(`    @cell${attrs}`);
         if (text.trim()) {
           // Indent text
           const lines = text.split("\n");
           for (const line of lines) {
             output.push(`      ${line}`);
           }
         }
      }
    }
  }

  return output.join("\n");
}
