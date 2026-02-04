import { getOnlyKey, type XmlNode } from "../xml";
import { normalizeWs } from "./run";
import { paragraphText } from "./paragraph";

function escapeTableCell(cell: string): string {
  const safe = cell.replace(/\"/g, "'").replace(/"/g, "'");
  // Need quotes if: contains comma, starts/ends with whitespace, or is exactly ">" or "^"
  const needsQuotes = /,/.test(safe) || /^\s/.test(safe) || /\s$/.test(safe) || safe === ">" || safe === "^";
  return needsQuotes ? `"${safe}"` : safe;
}

interface CellInfo {
  text: string;
  colspan: number;
  vMerge: "restart" | "continue" | null;
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
          // w:gridSpan has @w:val attribute
          const attrs = prop["@"] as Record<string, string> | undefined;
          if (attrs?.["w:val"]) {
            colspan = parseInt(attrs["w:val"], 10) || 1;
          }
        }
        if (pk === "w:vMerge") {
          // w:vMerge: if has @w:val="restart" -> restart, else -> continue
          const attrs = prop["@"] as Record<string, string> | undefined;
          if (attrs?.["w:val"] === "restart") {
            vMerge = "restart";
          } else {
            // No val or val is not "restart" means continue
            vMerge = "continue";
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
  const rows: string[] = [];
  let isFirstRow = true;

  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k !== "w:tr") continue;
    const trChildren = tr["w:tr"] as XmlNode[];
    const cellInfos: CellInfo[] = [];

    for (const tc of trChildren ?? []) {
      const kk = getOnlyKey(tc);
      if (kk !== "w:tc") continue;
      const tcChildren = tc["w:tc"] as XmlNode[];

      // Get cell properties (colspan, vMerge)
      const { colspan, vMerge } = parseCellProperties(tcChildren);

      // Get cell text
      const paras: string[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          const t = paragraphText(p);
          if (t) paras.push(t);
        }
      }
      const cellText = normalizeWs(paras.join(" "));

      // Strip bold from header row cells (first row)
      const finalText = isFirstRow ? stripHeaderBold(cellText) : cellText;
      cellInfos.push({ text: finalText, colspan, vMerge });
    }

    // Convert cellInfos to LDOC cell strings
    const cells: string[] = [];
    for (const info of cellInfos) {
      if (info.vMerge === "continue") {
        // This is a rowspan continuation - emit "^"
        cells.push("^");
      } else {
        // Normal cell or vMerge restart
        cells.push(escapeTableCell(info.text));
      }

      // If colspan > 1, emit additional ">" markers
      for (let i = 1; i < info.colspan; i++) {
        cells.push(">");
      }
    }

    rows.push(`[${cells.join(", ")}]`);
    isFirstRow = false;
  }

  // Emit as an indented @table block (matches parser expectation)
  const indented = rows.map((r) => `  ${r}`).join("\n");
  return `@table\n${indented}`;
}
