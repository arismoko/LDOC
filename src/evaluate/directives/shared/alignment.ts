/**
 * Shared alignment utilities used by @align and @header/@footer handlers.
 */

import type { Block, StyleRef } from "../../../types/document-ir.ts";

export type HorizontalAlign = "left" | "center" | "right";

export function withTextAlign(styleRef: StyleRef | undefined, align: HorizontalAlign): StyleRef {
  return {
    ...(styleRef ?? {}),
    inline: {
      ...(styleRef?.inline ?? {}),
      textAlign: align,
    },
  };
}

export function applyAlignmentToBlock(block: Block, align: HorizontalAlign): Block {
  switch (block.type) {
    case "Paragraph":
      return { ...block, style: withTextAlign(block.style, align) };
    case "Heading":
      return { ...block, style: withTextAlign(block.style, align) };
    case "Blockquote":
      return {
        ...block,
        content: block.content.map((child) => applyAlignmentToBlock(child, align)),
      };
    case "Section":
      return {
        ...block,
        content: block.content.map((child) => applyAlignmentToBlock(child, align)),
      };
    case "List":
      return {
        ...block,
        style: withTextAlign(block.style, align),
        items: block.items.map((item) => ({
          ...item,
          style: withTextAlign(item.style, align),
          children: item.children.map((child) => applyAlignmentToBlock(child, align)),
        })),
      };
    case "Table":
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: cell.content.map((child) => applyAlignmentToBlock(child, align)),
          })),
        })),
      };
    default:
      return block;
  }
}

export function applyAlignmentToBlocks(blocks: Block[], align: HorizontalAlign): Block[] {
  return blocks.map((block) => applyAlignmentToBlock(block, align));
}

export function alignmentFromRegion(name: "left" | "center" | "right"): HorizontalAlign {
  return name;
}
