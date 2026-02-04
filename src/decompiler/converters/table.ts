import { getOnlyKey, type XmlNode } from "../xml";
import { normalizeWs } from "./run";
import { paragraphText } from "./paragraph";

function escapeTableCell(cell: string): string {
  const safe = cell.replace(/\"/g, "'").replace(/"/g, "'");
  const needsQuotes = /,/.test(safe) || /^\s/.test(safe) || /\s$/.test(safe);
  return needsQuotes ? `"${safe}"` : safe;
}

export function tableToLdoc(tblNode: XmlNode): string {
  const tblChildren = tblNode["w:tbl"] as XmlNode[];
  const rows: string[] = [];

  for (const tr of tblChildren ?? []) {
    const k = getOnlyKey(tr);
    if (k !== "w:tr") continue;
    const trChildren = tr["w:tr"] as XmlNode[];
    const cells: string[] = [];
    for (const tc of trChildren ?? []) {
      const kk = getOnlyKey(tc);
      if (kk !== "w:tc") continue;
      const tcChildren = tc["w:tc"] as XmlNode[];
      const paras: string[] = [];
      for (const p of tcChildren ?? []) {
        const pk = getOnlyKey(p);
        if (pk === "w:p") {
          const t = paragraphText(p);
          if (t) paras.push(t);
        }
      }
      const cellText = normalizeWs(paras.join(" "));
      cells.push(escapeTableCell(cellText));
    }
    rows.push(`[${cells.join(", ")}]`);
  }

  // Emit as an indented @table block (matches parser expectation)
  const indented = rows.map((r) => `  ${r}`).join("\n");
  return `@table\n${indented}`;
}
