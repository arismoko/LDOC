import { TextRun, InternalHyperlink, PageNumber, Tab } from "docx";
import type { InlineNode, NodeVisitor, TextNode, VariableNode, CrossRefNode, DefinedTermNode, BlankNode, EmphasisNode } from "../../parser/ast";
import type { CompilationContext } from "../context";
import { resolveVariable, createTextRuns } from "../text";
import type { TextStyle } from "../styles";

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

  visit(node: InlineNode): any[] {
    switch (node.type) {
      case "text": return this.visitText(node);
      case "variable": return this.visitVariable(node);
      case "emphasis": return this.visitEmphasis(node);
      case "defined_term": return this.visitDefinedTerm(node);
      case "blank": return this.visitBlank(node);
      case "cross_ref": return this.visitCrossRef(node);
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
