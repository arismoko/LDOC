import { TextRun, InternalHyperlink, ExternalHyperlink, PageNumber, Tab, FootnoteReferenceRun, ImageRun } from "docx";
import type { InlineNode, NodeVisitor, TextNode, VariableNode, CrossRefNode, DefinedTermNode, BlankNode, EmphasisNode, LinkNode, StrikethroughNode, InlineCodeNode, FootnoteReferenceNode, ImageNode, InlineStyleNode, HighlightNode } from "../../parser/ast";
import sizeOf from "image-size";
import fs from "node:fs";
import type { CompilationContext } from "../context";
import { resolveVariable, createTextRuns } from "../text";
import type { TextStyle } from "../styles";
import { ptToHalfPoints, PT_VALUE_REGEX, parseLengthToTwip } from "../../shared/units";
import { isHighlightColor, DEFAULT_HIGHLIGHT_COLOR } from "../../shared/highlight";

function parseHexColor(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!m) return null;
  return (m[1] ?? "").toUpperCase();
}

export class InlineNodeVisitor implements NodeVisitor<any[]> {
  constructor(
    private ctx: CompilationContext,
    private baseStyle: TextStyle = {},
    private scope?: string
  ) {}

  visitText(node: TextNode): any[] {
    return createTextRuns(node.value, this.baseStyle);
  }

  visitVariable(node: VariableNode): any[] {
    if (node.path.length === 1 && node.path[0] === "page") {
      return [new TextRun({ children: [PageNumber.CURRENT] })];
    }
    if (node.path.length === 1 && node.path[0] === "pages") {
      return [new TextRun({ children: [PageNumber.TOTAL_PAGES] })];
    }

    const varCtx = {
      variables: this.ctx.variables,
      missingVariables: this.ctx.missingVariables,
    };
    const value = resolveVariable(node, varCtx);
    return createTextRuns(value, this.baseStyle);
  }

  visitEmphasis(node: EmphasisNode): any[] {
    const emphasisStyle = { ...this.baseStyle };
    if (node.style === "bold" || node.style === "bold_italic") {
      emphasisStyle.bold = true;
    }
    if (node.style === "italic" || node.style === "bold_italic") {
      emphasisStyle.italics = true;
    }
    
    const visitor = new InlineNodeVisitor(this.ctx, emphasisStyle, this.scope);
    return node.content.flatMap(child => visitor.visit(child));
  }

  visitDefinedTerm(node: DefinedTermNode): any[] {
    const termStyle = { ...this.baseStyle };
    if (node.isDefinition) {
      termStyle.bold = true;
    }
    return createTextRuns(`"${node.term}"`, termStyle);
  }

  visitBlank(node: BlankNode): any[] {
    return createTextRuns("_".repeat(node.length), this.baseStyle);
  }

  visitHardBreak(node: any): any[] {
    return [new TextRun({ break: 1 })];
  }

  visitLink(node: LinkNode): any[] {
    return [
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: node.text,
            style: "Hyperlink",
          }),
        ],
        link: node.url,
      }),
    ];
  }

  visitImage(node: ImageNode): any[] {
    try {
      let buffer: Uint8Array;

      // Check if it's a URL
      if (node.src.startsWith("http://") || node.src.startsWith("https://")) {
        const cached = this.ctx.imageCache.get(node.src);
        if (!cached) {
          this.ctx.missingVariables.set(`Image fetch failed: ${node.src}`, { line: node.line, column: node.column });
          return [new TextRun({ text: `[Image fetch failed: ${node.src}]`, color: "FF0000" })];
        }
        buffer = cached;
      } else {
        // Local file
        if (!fs.existsSync(node.src)) {
          this.ctx.missingVariables.set(`Image not found: ${node.src}`, { line: node.line, column: node.column });
          return [new TextRun({ text: `[Image not found: ${node.src}]`, color: "FF0000" })];
        }
        buffer = fs.readFileSync(node.src);
      }

      const dimensions = sizeOf(Buffer.from(buffer));

      if (!dimensions.width || !dimensions.height) {
        throw new Error("Could not determine image dimensions");
      }

      // Default max width (e.g. 6 inches = 576px at 96dpi, or just use px)
      // docx uses pixels for width/height in transformation
      // Let's limit width to 500px if it's larger, preserving aspect ratio
      let width = dimensions.width;
      let height = dimensions.height;
      const MAX_WIDTH = 500;

      if (width > MAX_WIDTH) {
        const ratio = MAX_WIDTH / width;
        width = MAX_WIDTH;
        height = Math.round(height * ratio);
      }

      return [
        new ImageRun({
          data: buffer,
          transformation: {
            width,
            height,
          },
          type: "png", // Default to png
        }),
      ];
    } catch (e) {
      console.error(`Error processing image ${node.src}:`, e);
      return [new TextRun({ text: `[Error loading image: ${node.src}]`, color: "FF0000" })];
    }
  }

  visitStrikethrough(node: StrikethroughNode): any[] {
    const strikeStyle = { ...this.baseStyle, strike: true };
    const visitor = new InlineNodeVisitor(this.ctx, strikeStyle, this.scope);
    return node.content.flatMap(child => visitor.visit(child));
  }

  visitInlineCode(node: InlineCodeNode): any[] {
    // Render as monospaced text with a light gray background?
    // DOCX doesn't do inline code background easily without shading.
    // Let's just use Courier New font.
    const codeStyle = { ...this.baseStyle, font: "Courier New" };
    return createTextRuns(node.value, codeStyle);
  }

  visitFootnoteReference(node: FootnoteReferenceNode): any[] {
    // We need to find the ID for this label.
    // The ID mapping is stored in the context.
    const id = this.ctx.footnoteMap?.get(node.label);
    
    if (id === undefined) {
      // Missing definition
      this.ctx.missingVariables.set(`Footnote: ${node.label}`, { line: node.line, column: node.column });
      const errorStyle = { ...this.baseStyle, color: "FF0000" };
      return createTextRuns(`[^${node.label}]`, errorStyle);
    }

    return [new FootnoteReferenceRun(id)];
  }

  visitCrossRef(node: CrossRefNode): any[] {
    const raw = node.target;
    const anchor = this.ctx.bookmarkManager.resolveAnchor(raw, this.scope);
    
    if (!anchor) {
      this.ctx.missingCrossRefs.add(raw.trim());
      return createTextRuns(raw, { ...this.baseStyle, italics: true });
    }

    return [
      new InternalHyperlink({
        anchor,
        children: [
          new TextRun({
            text: raw,
            style: "Hyperlink",
          }),
        ],
      }),
    ];
  }

  visitInlineStyle(node: InlineStyleNode): any[] {
    // Build style from attributes
    const styleOverrides = { ...this.baseStyle };

    // Font
    if (node.attributes.font) {
      styleOverrides.font = node.attributes.font;
    }

    // Size (convert pt to half-points)
    if (node.attributes.size) {
      const sizeMatch = node.attributes.size.match(PT_VALUE_REGEX);
      if (sizeMatch && sizeMatch[1]) {
        styleOverrides.size = ptToHalfPoints(parseFloat(sizeMatch[1]));
      }
    }

    // Color (strip # if present)
    if (node.attributes.color) {
      const colorMatch = node.attributes.color.match(/^#?([0-9A-Fa-f]{6})$/);
      if (colorMatch && colorMatch[1]) {
        styleOverrides.color = colorMatch[1].toUpperCase();
      }
    }

    // Text formatting flags
    if (node.attributes.bold !== undefined) {
      styleOverrides.bold = node.attributes.bold === "true" || node.attributes.bold === "";
    }
    if (node.attributes.italic !== undefined) {
      styleOverrides.italics = node.attributes.italic === "true" || node.attributes.italic === "";
    }
    if (node.attributes.underline !== undefined) {
      styleOverrides.underline = node.attributes.underline === "true" || node.attributes.underline === "";
    }
    if (node.attributes.strike !== undefined) {
      styleOverrides.strike = node.attributes.strike === "true" || node.attributes.strike === "";
    }
    if (node.attributes.caps !== undefined) {
      styleOverrides.allCaps = node.attributes.caps === "true" || node.attributes.caps === "";
    }
    if (node.attributes["small-caps"] !== undefined) {
      styleOverrides.smallCaps = node.attributes["small-caps"] === "true" || node.attributes["small-caps"] === "";
    }
    if (node.attributes.subscript !== undefined) {
      styleOverrides.subscript = node.attributes.subscript === "true" || node.attributes.subscript === "";
    }
    if (node.attributes.superscript !== undefined) {
      styleOverrides.superscript = node.attributes.superscript === "true" || node.attributes.superscript === "";
    }

    // Create new visitor with merged style
    const visitor = new InlineNodeVisitor(this.ctx, styleOverrides, this.scope);
    return node.content.flatMap(child => visitor.visit(child));
  }

  visitHighlight(node: HighlightNode): any[] {
    // Map color or default to yellow
    const highlightColor = node.color && isHighlightColor(node.color) 
      ? node.color 
      : DEFAULT_HIGHLIGHT_COLOR;
    
    const highlightStyle = { ...this.baseStyle, highlight: highlightColor };
    const visitor = new InlineNodeVisitor(this.ctx, highlightStyle, this.scope);
    return node.content.flatMap(child => visitor.visit(child));
  }

  visit(node: InlineNode): any[] {
    switch (node.type) {
      case "text": return this.visitText(node);
      case "variable": return this.visitVariable(node);
      case "emphasis": return this.visitEmphasis(node);
      case "defined_term": return this.visitDefinedTerm(node);
      case "blank": return this.visitBlank(node);
      case "hard_break": return this.visitHardBreak(node);
      case "link": return this.visitLink(node);
      case "image": return this.visitImage(node);
      case "strikethrough": return this.visitStrikethrough(node);
      case "inline_code": return this.visitInlineCode(node);
      case "footnote_ref": return this.visitFootnoteReference(node);
      case "cross_ref": return this.visitCrossRef(node);
      case "inline_style": return this.visitInlineStyle(node);
      case "highlight": return this.visitHighlight(node);
      default: return [];
    }
  }
}

export function compileInlineNodes(
  nodes: InlineNode[],
  ctx: CompilationContext,
  baseStyle: TextStyle = {},
  scope?: string
): any[] {
  const visitor = new InlineNodeVisitor(ctx, baseStyle, scope);
  return nodes.flatMap(node => visitor.visit(node));
}
