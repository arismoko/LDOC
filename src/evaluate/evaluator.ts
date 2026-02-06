/**
 * Main evaluator - transforms bound CST to Document IR.
 */

import type {
  CSTDocument,
  CSTNode,
  CSTDirective,
  CSTParagraph,
  CSTHeader,
  CSTList,
  CSTListItem,
  CSTBlockquote,
  CSTHorizontalRule,
  CSTFootnoteDef,
  CSTInline,
  CSTText,
  CSTVariable,
  CSTEmphasis,
  CSTLink,
  CSTImage,
  CSTFootnoteRef,
  CSTCrossRef,
  CSTHardBreak,
  CSTTab,
  CSTDefinedTerm,
  CSTBlank,
} from "../types/cst.ts";
import type {
  Document,
  DocumentMetadata,
  Block,
  Paragraph,
  Heading,
  List,
  ListItem,
  Table,
  TableRow,
  TableCell,
  Blockquote,
  HorizontalRule,
  Footnote,
  Inline,
  Text,
  Bold,
  Italic,
  Strikethrough,
  Highlight,
  Code,
  Link,
  Image,
  FootnoteRef,
  CrossRef,
  HardBreak,
  Tab,
  Styled,
  EvaluateResult,
} from "../types/document-ir.ts";
import type { SymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { DiagnosticCode, error, warning } from "../types/diagnostics.ts";
import { resolveInterpolation } from "./interpolation.ts";
import { processIf, processForeach, processRepeat } from "./control-flow.ts";
import { processUse, processSlot, processSet } from "./expander.ts";
import { parseDocumentConfig, configToPageLayout } from "./document-config.ts";

/**
 * Parse a length string (e.g., "2.5in", "72pt") to twips.
 */
function parseLength(value: string): number {
  const match = value.match(/^([\d.]+)(in|pt|cm|mm|twip)?$/);
  if (!match) return 0;
  const num = parseFloat(match[1] ?? "0");
  const unit = match[2] ?? "pt";
  switch (unit) {
    case "in": return num * 1440;
    case "pt": return num * 20;
    case "cm": return num * 567;
    case "mm": return num * 56.7;
    case "twip": return num;
    default: return num * 20;
  }
}

/**
 * Evaluation context passed through the transform.
 */
export interface EvaluatorContext {
  symbols: SymbolTable;
  globals: Record<string, unknown>;
  locals: Record<string, unknown>;
  diagnostics: Diagnostic[];
  metadata: DocumentMetadata;
  footnotes: Footnote[];
  depth: number;
  maxDepth: number;
  maxIterations: number;
}

/**
 * Function type for recursive node transformation.
 */
export type TransformFunction = (node: CSTNode, ctx: EvaluatorContext) => Block[];

/**
 * Options for the evaluator.
 */
export interface EvaluateOptions {
  /** Initial variables */
  variables?: Record<string, unknown>;
  /** Maximum macro expansion depth */
  maxDepth?: number;
  /** Maximum iterations for @foreach/@repeat */
  maxIterations?: number;
}

/**
 * Main evaluator class.
 */
export class Evaluator {
  private ctx: EvaluatorContext;

  constructor(symbols: SymbolTable, options: EvaluateOptions = {}) {
    this.ctx = {
      symbols,
      globals: { ...options.variables },
      locals: {},
      diagnostics: [],
      metadata: { custom: {} },
      footnotes: [],
      depth: 0,
      maxDepth: options.maxDepth ?? 50,
      maxIterations: options.maxIterations ?? 100,
    };

    // Copy variables from symbol table to globals
    for (const [name, sym] of symbols.variables) {
      this.ctx.globals[name] = sym.value;
    }
  }

  /**
   * Evaluate a CST document to produce Document IR.
   */
  evaluate(cst: CSTDocument): EvaluateResult {
    const blocks: Block[] = [];

    for (const node of cst.children) {
      blocks.push(...this.transformNode(node, this.ctx));
    }

    // Collect footnotes from symbol table
    for (const [label, sym] of this.ctx.symbols.footnotes) {
      const content: Block[] = [];
      for (const node of sym.content) {
        content.push(...this.transformNode(node, this.ctx));
      }
      this.ctx.footnotes.push({
        type: "Footnote",
        label,
        content,
        loc: sym.definedAt,
      });
    }

    const document: Document = {
      type: "Document",
      metadata: this.ctx.metadata,
      blocks,
    };

    return {
      document,
      diagnostics: this.ctx.diagnostics,
    };
  }

  /**
   * Transform a CST node to IR blocks.
   */
  private transformNode(node: CSTNode, ctx: EvaluatorContext): Block[] {
    switch (node.type) {
      case "Directive":
        return this.transformDirective(node, ctx);
      case "Paragraph":
        return [this.transformParagraph(node, ctx)];
      case "Header":
        return [this.transformHeader(node, ctx)];
      case "List":
        return [this.transformList(node, ctx)];
      case "Blockquote":
        return [this.transformBlockquote(node, ctx)];
      case "HorizontalRule":
        return [this.transformHorizontalRule(node)];
      case "FootnoteDef":
        // Footnotes are collected separately
        return [];
      case "BlankLine":
        // Blank lines don't produce IR
        return [];
      default:
        // Inline nodes shouldn't appear at block level
        return [];
    }
  }

  /**
   * Transform a directive to IR blocks.
   */
  private transformDirective(directive: CSTDirective, ctx: EvaluatorContext): Block[] {
    switch (directive.name) {
      case "use":
        return processUse(directive, ctx, this.transformNode.bind(this));

      case "if":
        return processIf(directive, ctx, this.transformNode.bind(this));

      case "foreach":
        return processForeach(directive, ctx, this.transformNode.bind(this));

      case "repeat":
        return processRepeat(directive, ctx, this.transformNode.bind(this));

      case "slot":
        return processSlot(directive, ctx, this.transformNode.bind(this));

      case "set":
        processSet(directive, ctx);
        return [];

      case "define":
        // Definitions are already collected in bind phase
        return [];

      case "style":
        // If @style has a body, it's a style application (modifier)
        // If no body, it's a style definition (collected in bind phase)
        if (directive.body && directive.body.length > 0) {
          return this.transformStyleModifier(directive, ctx);
        }
        return [];

      case "document":
        this.processDocument(directive, ctx);
        return [];

      case "import":
        // Imports are already processed in bind phase
        return [];

      case "anchor":
        // Anchors are collected in bind phase
        return [];

      case "header":
        this.processHeaderFooter(directive, ctx, "header");
        return [];

      case "footer":
        this.processHeaderFooter(directive, ctx, "footer");
        return [];

      case "firstpage":
        // @firstpage is a modifier, check if followed by @header/@footer
        // For now, treat as a no-op (the @header/@footer after it handles it)
        return [];

      case "evenpage":
        // @evenpage is a modifier, treat as no-op
        return [];

      case "pagebreak":
        return [{ type: "PageBreak", loc: directive.loc }];

      case "columnbreak":
        return [{ type: "ColumnBreak", loc: directive.loc }];

      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return this.transformHeadingDirective(directive, ctx);

      case "table":
        return this.transformTableDirective(directive, ctx);

      case "row":
        // @row should only appear inside @table - if standalone, emit warning
        ctx.diagnostics.push(
          warning(
            DiagnosticCode.EXPRESSION_ERROR,
            "@row directive must be inside @table",
            directive.loc
          )
        );
        return [];

      case "cell":
        // @cell should only appear inside @row - if standalone, emit warning
        ctx.diagnostics.push(
          warning(
            DiagnosticCode.EXPRESSION_ERROR,
            "@cell directive must be inside @row",
            directive.loc
          )
        );
        return [];

      default:
        // Unknown directive - emit warning and process body
        ctx.diagnostics.push(
          warning(
            DiagnosticCode.EXPRESSION_ERROR,
            `Unknown directive '@${directive.name}'`,
            directive.loc
          )
        );
        if (directive.body) {
          const results: Block[] = [];
          for (const child of directive.body) {
            results.push(...this.transformNode(child, ctx));
          }
          return results;
        }
        return [];
    }
  }

  /**
   * Transform @h1-@h6 directive to Heading IR.
   */
  private transformHeadingDirective(directive: CSTDirective, ctx: EvaluatorContext): Block[] {
    // Extract level from directive name (h1 -> 1, h2 -> 2, etc.)
    const levelStr = directive.name.slice(1);
    const level = parseInt(levelStr, 10) as 1 | 2 | 3 | 4 | 5 | 6;
    
    // Collect inline content from body
    const content: Inline[] = [];
    
    if (directive.body) {
      for (const node of directive.body) {
        if (node.type === "Paragraph") {
          content.push(...this.transformInlines(node.content, ctx));
        } else {
          // For other block types, recursively transform
          // This handles nested content
          const blocks = this.transformNode(node, ctx);
          // Extract text from blocks (simplified - just take paragraph content)
          for (const block of blocks) {
            if (block.type === "Paragraph") {
              content.push(...block.content);
            }
          }
        }
      }
    }
    
    const heading: Heading = {
      type: "Heading",
      level,
      content,
      loc: directive.loc,
    };
    
    return [heading];
  }

  /**
   * Transform @table directive to Table IR.
   */
  private transformTableDirective(directive: CSTDirective, ctx: EvaluatorContext): Block[] {
    const rows: TableRow[] = [];
    
    // Extract column widths from arguments if present
    let columnWidths: number[] | undefined;
    for (const arg of directive.arguments) {
      if (arg.type === "NamedArg" && arg.name === "widths") {
        const value = this.extractValue(arg.value);
        if (Array.isArray(value)) {
          columnWidths = value.map((v: unknown) => {
            if (typeof v === "string") {
              return parseLength(v);
            }
            return typeof v === "number" ? v : 0;
          });
        }
      }
    }
    
    // Process body - collect @row directives
    if (directive.body) {
      for (const node of directive.body) {
        if (node.type === "Directive" && node.name === "row") {
          const row = this.transformRowDirective(node, ctx);
          if (row) {
            rows.push(row);
          }
        } else if (node.type === "Paragraph" || node.type === "BlankLine") {
          // Skip blank lines and stray paragraphs in tables
        } else {
          // Unexpected content in table
          ctx.diagnostics.push(
            warning(
              DiagnosticCode.EXPRESSION_ERROR,
              `Unexpected ${node.type} inside @table`,
              node.loc
            )
          );
        }
      }
    }
    
    const table: Table = {
      type: "Table",
      rows,
      loc: directive.loc,
    };
    
    if (columnWidths) {
      table.columnWidths = columnWidths;
    }
    
    return [table];
  }

  /**
   * Transform @row directive to TableRow IR.
   */
  private transformRowDirective(directive: CSTDirective, ctx: EvaluatorContext): TableRow | null {
    const cells: TableCell[] = [];
    
    // Process body - collect @cell directives
    if (directive.body) {
      for (const node of directive.body) {
        if (node.type === "Directive" && node.name === "cell") {
          const cell = this.transformCellDirective(node, ctx);
          if (cell) {
            cells.push(cell);
          }
        } else if (node.type === "Paragraph" || node.type === "BlankLine") {
          // Skip blank lines and stray paragraphs
        } else {
          // Unexpected content in row
          ctx.diagnostics.push(
            warning(
              DiagnosticCode.EXPRESSION_ERROR,
              `Unexpected ${node.type} inside @row`,
              node.loc
            )
          );
        }
      }
    }
    
    return {
      type: "TableRow",
      cells,
      loc: directive.loc,
    };
  }

  /**
   * Transform @cell directive to TableCell IR.
   */
  private transformCellDirective(directive: CSTDirective, ctx: EvaluatorContext): TableCell | null {
    const content: Block[] = [];
    
    // Check for inline content (e.g., @cell: content)
    // This is indicated by having arguments with positional content
    
    // Process body
    if (directive.body) {
      for (const node of directive.body) {
        content.push(...this.transformNode(node, ctx));
      }
    }
    
    // Handle inline cell content (@cell: text)
    // The parser may put inline content as arguments
    for (const arg of directive.arguments) {
      if (arg.type === "PositionalArg") {
        const value = this.extractValue(arg.value);
        if (typeof value === "string" && value.trim()) {
          content.push({
            type: "Paragraph",
            content: [{ type: "Text", value: String(value) }],
            loc: directive.loc,
          });
        }
      }
    }
    
    return {
      type: "TableCell",
      content,
      loc: directive.loc,
    };
  }

  /**
   * Process @document directive - extract metadata from arguments and opaque body.
   */
  private processDocument(directive: CSTDirective, ctx: EvaluatorContext): void {
    // Process arguments (inline syntax)
    for (const arg of directive.arguments) {
      if (arg.type === "NamedArg") {
        const value = this.extractValue(arg.value);
        switch (arg.name) {
          case "title":
            ctx.metadata.title = String(value ?? "");
            break;
          case "author":
            ctx.metadata.author = String(value ?? "");
            break;
          case "date":
            ctx.metadata.date = String(value ?? "");
            break;
          default:
            ctx.metadata.custom[arg.name] = value;
        }
      }
    }

    // Process opaque body (YAML-like syntax from decompiler)
    if (directive.opaqueBody) {
      const config = parseDocumentConfig(directive.opaqueBody);
      
      // Extract title, author, date from config
      if (config.title && !ctx.metadata.title) {
        ctx.metadata.title = String(config.title);
      }
      if (config.author && !ctx.metadata.author) {
        ctx.metadata.author = String(config.author);
      }
      if (config.date && !ctx.metadata.date) {
        ctx.metadata.date = String(config.date);
      }
      
      // Extract page layout
      const layout = configToPageLayout(config);
      if (layout) {
        ctx.metadata.layout = layout;
      }
      
      // Store remaining config in custom metadata
      for (const [key, value] of Object.entries(config)) {
        if (!["title", "author", "date", "margins", "orientation"].includes(key)) {
          ctx.metadata.custom[key] = value;
        }
      }
    }
  }

  /**
   * Process @header/@footer directive - store in metadata.
   */
  private processHeaderFooter(
    directive: CSTDirective, 
    ctx: EvaluatorContext,
    type: "header" | "footer"
  ): void {
    // Determine which variant (default, first, even)
    let variant: "default" | "first" | "even" = "default";
    
    // Check for firstpage or evenpage in arguments
    // Can be a named arg like firstpage=true or a positional identifier
    for (const arg of directive.arguments) {
      if (arg.type === "NamedArg") {
        const value = this.extractValue(arg.value);
        if ((arg.name === "firstpage" || arg.name === "first") && value === true) {
          variant = "first";
        } else if ((arg.name === "evenpage" || arg.name === "even") && value === true) {
          variant = "even";
        }
      } else if (arg.type === "PositionalArg") {
        // Check for identifier like "firstpage" or "evenpage"
        if (arg.value.type === "Identifier") {
          const name = (arg.value as { type: "Identifier"; name: string }).name;
          if (name === "firstpage" || name === "first") {
            variant = "first";
          } else if (name === "evenpage" || name === "even") {
            variant = "even";
          }
        }
      }
    }
    
    // Transform body content
    const content: Block[] = [];
    if (directive.body) {
      for (const node of directive.body) {
        content.push(...this.transformNode(node, ctx));
      }
    }
    
    // Create the HeaderFooter object
    const headerFooter = {
      type: "HeaderFooter" as const,
      kind: type,
      content,
      loc: directive.loc,
    };
    
    // Initialize the config object if needed and store
    if (type === "header") {
      if (!ctx.metadata.headers) {
        ctx.metadata.headers = {};
      }
      ctx.metadata.headers[variant] = headerFooter;
    } else {
      if (!ctx.metadata.footers) {
        ctx.metadata.footers = {};
      }
      ctx.metadata.footers[variant] = headerFooter;
    }
  }

  /**
   * Transform @style modifier (style application, not definition).
   * Applies style properties to contained paragraphs/blocks.
   */
  private transformStyleModifier(directive: CSTDirective, ctx: EvaluatorContext): Block[] {
    // Extract style properties from arguments
    const styleProps = this.extractStyleProps(directive.arguments);
    
    // Check for named style reference (style: Header)
    const styleName = styleProps.style as string | undefined;
    
    // Build the StyleRef
    const styleRef: { name?: string; inline?: Record<string, unknown> } = {};
    if (styleName) {
      styleRef.name = styleName;
      delete styleProps.style; // Don't include in inline props
    }
    if (Object.keys(styleProps).length > 0) {
      styleRef.inline = styleProps;
    }
    
    // Transform body content
    const blocks: Block[] = [];
    if (directive.body) {
      for (const node of directive.body) {
        const transformed = this.transformNode(node, ctx);
        // Apply style to each block
        for (const block of transformed) {
          if (block.type === "Paragraph" || block.type === "Heading") {
            // Merge styles: existing style + new style
            const existingStyle = (block as any).style ?? {};
            (block as any).style = {
              name: styleRef.name ?? existingStyle.name,
              inline: { ...existingStyle.inline, ...styleRef.inline },
            };
          }
          blocks.push(block);
        }
      }
    }
    
    return blocks;
  }

  /**
   * Transform a paragraph.
   */
  private transformParagraph(para: CSTParagraph, ctx: EvaluatorContext): Paragraph {
    return {
      type: "Paragraph",
      content: this.transformInlines(para.content, ctx),
      loc: para.loc,
    };
  }

  /**
   * Transform a header.
   */
  private transformHeader(header: CSTHeader, ctx: EvaluatorContext): Heading {
    return {
      type: "Heading",
      level: header.level,
      content: this.transformInlines(header.content, ctx),
      loc: header.loc,
    };
  }

  /**
   * Transform a list.
   */
  private transformList(list: CSTList, ctx: EvaluatorContext): List {
    return {
      type: "List",
      ordered: list.ordered,
      items: list.items.map((item) => this.transformListItem(item, ctx)),
      loc: list.loc,
    };
  }

  /**
   * Transform a list item.
   */
  private transformListItem(item: CSTListItem, ctx: EvaluatorContext): ListItem {
    const children: Block[] = [];
    for (const child of item.children) {
      children.push(...this.transformNode(child, ctx));
    }

    return {
      type: "ListItem",
      content: this.transformInlines(item.content, ctx),
      children,
      loc: item.loc,
    };
  }

  /**
   * Transform a blockquote.
   */
  private transformBlockquote(bq: CSTBlockquote, ctx: EvaluatorContext): Blockquote {
    const content: Block[] = [];
    for (const child of bq.content) {
      content.push(...this.transformNode(child, ctx));
    }

    return {
      type: "Blockquote",
      content,
      loc: bq.loc,
    };
  }

  /**
   * Transform a horizontal rule.
   */
  private transformHorizontalRule(hr: CSTHorizontalRule): HorizontalRule {
    return {
      type: "HorizontalRule",
      loc: hr.loc,
    };
  }

  /**
   * Transform inline content.
   */
  private transformInlines(inlines: CSTInline[], ctx: EvaluatorContext): Inline[] {
    const results: Inline[] = [];

    for (const inline of inlines) {
      const transformed = this.transformInline(inline, ctx);
      if (transformed) {
        results.push(transformed);
      }
    }

    return results;
  }

  /**
   * Transform a single inline node.
   */
  private transformInline(inline: CSTInline, ctx: EvaluatorContext): Inline | null {
    switch (inline.type) {
      case "Text":
        return this.transformText(inline, ctx);

      case "Variable":
        return this.transformVariable(inline, ctx);

      case "Emphasis":
        return this.transformEmphasis(inline, ctx);

      case "Link":
        return this.transformLink(inline, ctx);

      case "Image":
        return this.transformImage(inline);

      case "FootnoteRef":
        return this.transformFootnoteRef(inline);

      case "CrossRef":
        return this.transformCrossRef(inline);

      case "HardBreak":
        return { type: "HardBreak", loc: inline.loc };

      case "Tab":
        return { type: "Tab", loc: inline.loc };

      case "DefinedTerm":
        // Defined terms become styled text
        return this.transformDefinedTerm(inline, ctx);

      case "Blank":
        // Blanks become underlined placeholder text
        return this.transformBlank(inline);

      case "InlineDirective":
        // Handle inline directives like @style(...)
        return this.transformInlineDirective(inline, ctx);

      default:
        return null;
    }
  }

  /**
   * Transform text node - may contain interpolations.
   */
  private transformText(text: CSTText, ctx: EvaluatorContext): Text {
    // Check for interpolations in the text
    const value = text.value.includes("{{")
      ? resolveInterpolation(text.value.replace(/\{\{([^}]+)\}\}/, "$1"), ctx.locals, ctx.globals)
      : text.value;

    return {
      type: "Text",
      value,
      loc: text.loc,
    };
  }

  /**
   * Transform variable node.
   */
  private transformVariable(variable: CSTVariable, ctx: EvaluatorContext): Text {
    const value = resolveInterpolation(variable.expression, ctx.locals, ctx.globals);
    return {
      type: "Text",
      value,
      loc: variable.loc,
    };
  }

  /**
   * Transform emphasis node.
   */
  private transformEmphasis(emph: CSTEmphasis, ctx: EvaluatorContext): Inline {
    const content = this.transformInlines(emph.content, ctx);

    switch (emph.kind) {
      case "bold":
        return { type: "Bold", content, loc: emph.loc };
      case "italic":
        return { type: "Italic", content, loc: emph.loc };
      case "strikethrough":
        return { type: "Strikethrough", content, loc: emph.loc };
      case "highlight":
        return { type: "Highlight", content, loc: emph.loc };
      case "code":
        // Code is special - content should be a single text node
        const codeText = content
          .filter((c): c is Text => c.type === "Text")
          .map((c) => c.value)
          .join("");
        return { type: "Code", value: codeText, loc: emph.loc };
      default:
        // Fallback to styled
        return { type: "Styled", content, style: {}, loc: emph.loc };
    }
  }

  /**
   * Transform link node.
   */
  private transformLink(link: CSTLink, ctx: EvaluatorContext): Link {
    return {
      type: "Link",
      content: this.transformInlines(link.text, ctx),
      url: link.url,
      title: link.title,
      loc: link.loc,
    };
  }

  /**
   * Transform image node.
   */
  private transformImage(img: CSTImage): Image {
    return {
      type: "Image",
      src: img.src,
      alt: img.alt,
      title: img.title,
      loc: img.loc,
    };
  }

  /**
   * Transform footnote reference.
   */
  private transformFootnoteRef(ref: CSTFootnoteRef): FootnoteRef {
    return {
      type: "FootnoteRef",
      label: ref.label,
      loc: ref.loc,
    };
  }

  /**
   * Transform cross-reference.
   */
  private transformCrossRef(ref: CSTCrossRef): CrossRef {
    return {
      type: "CrossRef",
      target: ref.target,
      loc: ref.loc,
    };
  }

  /**
   * Transform defined term to styled text.
   */
  private transformDefinedTerm(term: CSTDefinedTerm, _ctx: EvaluatorContext): Styled {
    return {
      type: "Styled",
      content: [{ type: "Text", value: term.term }],
      style: { bold: true },
      loc: term.loc,
    };
  }

  /**
   * Transform blank (fill-in) to underlined space.
   */
  private transformBlank(blank: CSTBlank): Styled {
    const spaces = "_".repeat(blank.width);
    return {
      type: "Styled",
      content: [{ type: "Text", value: spaces }],
      style: { underline: true },
      loc: blank.loc,
    };
  }

  /**
   * Transform inline directive.
   */
  private transformInlineDirective(
    directive: { type: "InlineDirective"; name: string; arguments: unknown[]; content: CSTInline[] },
    ctx: EvaluatorContext
  ): Inline | null {
    // For now, just transform content and apply as styled if it's @style
    if (directive.name === "style") {
      const style = this.extractStyleProps(directive.arguments);
      return {
        type: "Styled",
        content: this.transformInlines(directive.content, ctx),
        style,
      };
    }

    // Unknown inline directive - just return content
    const content = this.transformInlines(directive.content, ctx);
    return content.length === 1 ? content[0]! : { type: "Styled", content, style: {} };
  }

  /**
   * Extract style properties from directive arguments.
   */
  private extractStyleProps(args: unknown[]): Record<string, unknown> {
    const style: Record<string, unknown> = {};
    
    for (const arg of args) {
      if (arg && typeof arg === "object") {
        const a = arg as Record<string, unknown>;
        if (a.type === "NamedArg") {
          const value = this.extractValue(a.value as { type: string });
          style[a.name as string] = value;
        }
      }
    }

    return style;
  }

  /**
   * Extract value from CST value node.
   */
  private extractValue(value: { type: string } | undefined): unknown {
    if (!value) return undefined;
    const v = value as Record<string, unknown>;
    switch (v.type) {
      case "StringLiteral":
        return v.value;
      case "NumberLiteral":
        return v.value;
      case "BooleanLiteral":
        return v.value;
      case "Identifier":
        if (v.name === "true") return true;
        if (v.name === "false") return false;
        return v.name;
      case "Expression":
        return v.raw;
      default:
        return undefined;
    }
  }
}

/**
 * Evaluate a bound CST document.
 */
export function evaluate(
  cst: CSTDocument,
  symbols: SymbolTable,
  options: EvaluateOptions = {}
): EvaluateResult {
  return new Evaluator(symbols, options).evaluate(cst);
}
