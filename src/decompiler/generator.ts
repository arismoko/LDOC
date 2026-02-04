import { getOnlyKey, type XmlNode } from "./xml";
import { type ParagraphInfo, type DecompilerOptions, paragraphToLdoc } from "./converters/paragraph";
import { tableToLdoc } from "./converters/table";
import type { NumberingInfo } from "./parsers/numbering";
import type { ParagraphStyleMap } from "./parsers/styles";

export function formatTwipsAsPt(twips: number): string {
  const pt = twips / 20;
  return `${pt
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")}pt`;
}

export function shouldEmitIndent(options: DecompilerOptions | undefined): boolean {
  const val = options?.emitIndent;
  if (val === 'on' || val === true) return true;
  return false; // 'off', 'auto', false, undefined all suppress indent (default OFF)
}

// Helper to process a list of paragraph children and apply alignment grouping
export function processChildren(
  children: XmlNode[],
  numInfo: NumberingInfo,
  paragraphStyles: ParagraphStyleMap,
  options?: DecompilerOptions,
  indent: string = ""
): string[] {
  const result: string[] = [];
  const emitIndentDirectives = shouldEmitIndent(options);
  
  // First, collect all paragraph info
  const items: Array<{ type: "paragraph"; info: ParagraphInfo } | { type: "table"; content: string }> = [];
  for (const child of children) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      items.push({ type: "paragraph", info: paragraphToLdoc(child, numInfo, paragraphStyles, options) });
    } else if (key === "w:tbl") {
      items.push({ type: "table", content: tableToLdoc(child) });
    }
  }

  const emitAligned = (paragraphInfos: ParagraphInfo[], baseIndent: string): string[] => {
    const out: string[] = [];
    let i = 0;
    while (i < paragraphInfos.length) {
      const info = paragraphInfos[i]!;
      const alignment = info.alignment;

      if (alignment && !info.isHeading && !info.isList && !info.isEmpty) {
        const group: number[] = [i];
        let j = i + 1;
        while (j < paragraphInfos.length) {
          const next = paragraphInfos[j]!;
          if (next.isHeading || next.isList) break;
          if (next.isEmpty) {
            group.push(j);
            j++;
            continue;
          }
          if (next.alignment !== alignment) break;
          group.push(j);
          j++;
        }

        const nonEmptyCount = group.filter((idx) => !paragraphInfos[idx]!.isEmpty).length;
        if (nonEmptyCount >= 2) {
          out.push(`${baseIndent}@${alignment}`);
          for (let gi = 0; gi < group.length; gi++) {
            const idx = group[gi]!;
            const p = paragraphInfos[idx]!;
            // Preserve block indentation on empty lines, otherwise blocks break.
            if (p.isEmpty) {
              out.push(`${baseIndent}  `);
              continue;
            }

            out.push(`${baseIndent}  ${p.line}`);

            // In LDOC, a single newline is a soft wrap for plain paragraphs.
            // Insert an indented blank separator so each DOCX paragraph stays its own paragraph.
            const hasMore = group.slice(gi + 1).some((k) => !paragraphInfos[k]!.isEmpty);
            if (hasMore) out.push(`${baseIndent}  `);
          }
          i = j;
          continue;
        }
      }

      let line = info.line;
      if (info.alignment === "center" && !info.isEmpty) line = `@center ${line}`;
      else if (info.alignment === "right" && !info.isEmpty) line = `@right ${line}`;
      out.push(baseIndent + line);
      i++;
    }
    return out;
  };

  // Indent grouping first, then alignment grouping inside each indent group
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (item.type === "table") {
      result.push(indent + item.content.split("\n").join("\n" + indent));
      i++;
      continue;
    }

    // Lists should not be wrapped in @indent; they carry indentation via numbering.
    if (item.info.isList) {
      result.push(indent + item.info.line);
      i++;
      continue;
    }

    const indentTwips = item.info.indentLeftTwips ?? 0;
    // When emitIndent is off, treat all paragraphs as having zero indent (skip indent grouping)
    if (indentTwips <= 0 || !emitIndentDirectives) {
      // Collect a run of non-list paragraphs with indent=0 (or all when emitIndent=off) and process with alignment grouping
      const run: ParagraphInfo[] = [];
      let j = i;
      while (j < items.length) {
        const next = items[j]!;
        if (next.type !== "paragraph") break;
        if (next.info.isList) break;
        // When emitIndent is off, don't break on indent changes
        if (emitIndentDirectives && (next.info.indentLeftTwips ?? 0) > 0) break;
        run.push(next.info);
        j++;
      }
      result.push(...emitAligned(run, indent));
      i = j;
      continue;
    }

    // Collect a run of non-list paragraphs with the same indent
    const run: ParagraphInfo[] = [item.info];
    let j = i + 1;
    while (j < items.length) {
      const next = items[j]!;
      if (next.type !== "paragraph") break;
      if (next.info.isList) break;
      if ((next.info.indentLeftTwips ?? 0) !== indentTwips) break;
      run.push(next.info);
      j++;
    }

    const nonEmptyCount = run.filter((p) => !p.isEmpty).length;
    const len = formatTwipsAsPt(indentTwips);
    if (nonEmptyCount >= 2) {
      result.push(`${indent}@indent=${len}`);
      result.push(...emitAligned(run, `${indent}  `));
    } else {
      const only = run[0]!;
      const alignNeedsNesting = only.alignment === "center" || only.alignment === "right";
      if (!only.isEmpty && !alignNeedsNesting) {
        result.push(`${indent}@indent=${len} ${only.line}`);
      } else {
        result.push(`${indent}@indent=${len}`);
        result.push(...emitAligned(run, `${indent}  `));
      }
    }

    i = j;
  }

  return result;
}
