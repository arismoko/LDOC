import { getOnlyKey, type XmlNode } from "./xml";
import {
  type ParagraphInfo,
  type DecompilerOptions,
  paragraphToLdoc,
} from "./converters/paragraph";
import { tableToLdoc } from "./converters/table";
import type { NumberingInfo } from "./parsers/numbering";
import type { ParagraphStyleMap } from "./parsers/styles";
import { formatTwipsAsPt } from "../shared/units";

/**
 * Format style attributes for v2 @style(...) directive.
 */
function formatStyleAttrs(
  attrs: Record<string, string>,
  spacing?: { after?: number; before?: number },
): string {
  const identRe = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const isNumber = (v: string) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v);
  const isLength = (v: string) => /^(?:\d+(?:\.\d+)?|\.\d+)(?:in|pt|cm|mm|twip)$/i.test(v);
  const formatValue = (v: string) => {
    if (v === "true" || v === "false") return v;
    if (isNumber(v) || isLength(v) || identRe.test(v)) return v;
    return JSON.stringify(v);
  };

  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === "true") {
      parts.push(k);
    } else {
      parts.push(`${k}: ${formatValue(v)}`);
    }
  }

  if (spacing?.after !== undefined)
    parts.push(`spacing-after: ${spacing.after}`);
  if (spacing?.before !== undefined)
    parts.push(`spacing-before: ${spacing.before}`);

  return parts.join(", ");
}

function spacingEqual(
  a?: { after?: number; before?: number },
  b?: { after?: number; before?: number },
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.after === b.after && a.before === b.before;
}

export function shouldEmitIndent(
  options: DecompilerOptions | undefined,
): boolean {
  const val = options?.emitIndent;
  if (val === "on" || val === true) return true;
  return false; // 'off', 'auto', false, undefined all suppress indent (default OFF)
}

// Helper to process a list of paragraph children and apply alignment grouping
export function processChildren(
  children: XmlNode[],
  numInfo: NumberingInfo,
  paragraphStyles: ParagraphStyleMap,
  options?: DecompilerOptions,
  indent: string = "",
  rels?: Map<string, string>,
): string[] {
  const result: string[] = [];
  const emitIndentDirectives = shouldEmitIndent(options);

  // First, collect all paragraph info
  const items: Array<
    | { type: "paragraph"; info: ParagraphInfo }
    | { type: "table"; content: string }
  > = [];
  for (const child of children) {
    const key = getOnlyKey(child);
    if (key === "w:p") {
      items.push({
        type: "paragraph",
        info: paragraphToLdoc(child, numInfo, paragraphStyles, options, rels),
      });
    } else if (key === "w:tbl") {
      items.push({
        type: "table",
        content: tableToLdoc(child, numInfo, paragraphStyles, options, rels),
      });
    }
  }

  const emitAligned = (
    paragraphInfos: ParagraphInfo[],
    baseIndent: string,
  ): string[] => {
    const out: string[] = [];
    let i = 0;
    while (i < paragraphInfos.length) {
      const info = paragraphInfos[i]!;

      // Group by spacing first
      const currentSpacing = info.spacing;
      const spacingGroup: number[] = [i];
      let j = i + 1;

      // Only group by spacing if we actually have spacing to emit
      // (If no spacing, we just process normally, potentially grouping by alignment)
      const hasSpacing =
        currentSpacing &&
        (currentSpacing.after !== undefined ||
          currentSpacing.before !== undefined);

      if (hasSpacing) {
        while (j < paragraphInfos.length) {
          const next = paragraphInfos[j]!;
          if (next.isHeading || next.isList) break;
          if (!spacingEqual(currentSpacing, next.spacing)) break;
          spacingGroup.push(j);
          j++;
        }
      } else {
        // If no spacing, we process one by one (or rather, the alignment loop will handle grouping)
        // But wait, if we don't group here, the alignment loop needs to know NOT to group across spacing boundaries?
        // Yes, so we should essentially treat "undefined spacing" as a group too,
        // OR just let the alignment loop handle it but verify spacing match.

        // Let's simplify: Always group by spacing first.
        while (j < paragraphInfos.length) {
          const next = paragraphInfos[j]!;
          if (next.isHeading || next.isList) break;
          if (!spacingEqual(currentSpacing, next.spacing)) break;
          spacingGroup.push(j);
          j++;
        }
      }

      // Determine indentation for inner content
      let innerIndent = baseIndent;
      if (hasSpacing) {
        const styleStr = formatStyleAttrs({}, currentSpacing);
        out.push(`${baseIndent}@style(${styleStr})`);
        innerIndent += "  ";
      }

      // Process alignment within this spacing group
      const groupInfos = spacingGroup.map((k) => paragraphInfos[k]!);

      let k = 0;
      while (k < groupInfos.length) {
        const subInfo = groupInfos[k]!;
        const alignment = subInfo.alignment;

        if (
          alignment &&
          !subInfo.isHeading &&
          !subInfo.isList &&
          !subInfo.isEmpty
        ) {
          const alignGroup: number[] = [k];
          let l = k + 1;
          while (l < groupInfos.length) {
            const next = groupInfos[l]!;
            if (next.isHeading || next.isList) break;
            if (next.isEmpty) {
              alignGroup.push(l);
              l++;
              continue;
            }
            if (next.alignment !== alignment) break;
            alignGroup.push(l);
            l++;
          }

          const nonEmptyCount = alignGroup.filter(
            (idx) => !groupInfos[idx]!.isEmpty,
          ).length;
          if (nonEmptyCount >= 2) {
            out.push(`${innerIndent}@style(align: ${alignment})`);
            for (let gi = 0; gi < alignGroup.length; gi++) {
              const idx = alignGroup[gi]!;
              const p = groupInfos[idx]!;
              if (p.isEmpty) {
                out.push(""); // Add blank line to trigger EmptyParagraphNode
                out.push(`${innerIndent}  `);
                continue;
              }
              for (const anchor of p.anchors ?? []) {
                out.push(`${innerIndent}  @anchor(${anchor})`);
              }
              const lines = p.line.split("\n");
              for (const line of lines) {
                out.push(`${innerIndent}  ${line}`);
              }
              const hasMore = alignGroup
                .slice(gi + 1)
                .some((m) => !groupInfos[m]!.isEmpty);
              if (hasMore) out.push(`${innerIndent}  `);
            }
            k = l;
            continue;
          }
        }

        // Single paragraph (or no alignment grouping)
        for (const anchor of subInfo.anchors ?? []) {
          out.push(`${innerIndent}@anchor(${anchor})`);
        }
        let line = subInfo.line;

        if (subInfo.isEmpty) {
          // Force empty paragraph by emitting extra blank line
          // This ensures we get enough newlines to trigger EmptyParagraphNode in parser
          out.push("");
          out.push("");
          out.push(innerIndent + line);
        } else if (subInfo.styleAttrs && !subInfo.isEmpty) {
          // Merge styleAttrs with alignment if present
          const mergedAttrs = { ...subInfo.styleAttrs };
          if (subInfo.alignment === "center" || subInfo.alignment === "right") {
            mergedAttrs.align = subInfo.alignment;
          }
          const styleStr = formatStyleAttrs(mergedAttrs);
          out.push(styleStr ? `${innerIndent}@style(${styleStr})` : `${innerIndent}@style`);
          out.push(`${innerIndent}  ${line}`);
        } else if (subInfo.alignment === "center" || subInfo.alignment === "right") {
          // Emit @style(align: ...) block for aligned single paragraphs
          out.push(`${innerIndent}@style(align: ${subInfo.alignment})`);
          out.push(`${innerIndent}  ${line}`);
        } else {
          out.push(innerIndent + line);
        }
        k++;
      }

      i = j;
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
      // Emit anchors before list item
        for (const anchor of item.info.anchors ?? []) {
          result.push(indent + `@anchor(${anchor})`);
        }
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
      result.push(`${indent}@indent(length: ${len})`);
      result.push(...emitAligned(run, `${indent}  `));
    } else {
      const only = run[0]!;
      const alignNeedsNesting =
        only.alignment === "center" || only.alignment === "right";
      if (!only.isEmpty && !alignNeedsNesting) {
        // Emit anchors before the @indent line (inline form)
        for (const anchor of only.anchors ?? []) {
          result.push(`${indent}@anchor(${anchor})`);
        }
        result.push(`${indent}@indent(length: ${len}): ${only.line}`);
      } else {
        // emitAligned will handle anchors
        result.push(`${indent}@indent(length: ${len})`);
        result.push(...emitAligned(run, `${indent}  `));
      }
    }

    i = j;
  }

  return result;
}
