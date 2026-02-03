// DOCX Compiler for Legal Document DSL

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  BorderStyle,
  WidthType,
  convertInchesToTwip,
  INumberingOptions,
  IParagraphOptions,
  IRunOptions,
} from "docx";

import {
  Node,
  DocumentNode,
  HeaderNode,
  NumberedItemNode,
  BulletItemNode,
  ModifierNode,
  EmptyParagraphNode,
  ParagraphNode,
  TableNode,
  TableRowNode,
  InlineNode,
  TextNode,
  VariableNode,
  EmphasisNode,
  BlankNode,
  PageBreakNode,
  NumberingStyle,
  walkTree,
} from "../parser/ast";

interface CompilerContext {
  variables: Record<string, any>;
  numberingCounters: Map<string, number>;
  definedTerms: Set<string>;
}

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  allCaps?: boolean;
  size?: number;
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
}

export class DocxCompiler {
  private ctx: CompilerContext;
  private numberingConfig: INumberingOptions;

  constructor(variables: Record<string, any> = {}) {
    this.ctx = {
      variables,
      numberingCounters: new Map(),
      definedTerms: new Set(),
    };

    this.numberingConfig = this.createNumberingConfig();
  }

  private createNumberingConfig(): INumberingOptions {
    return {
      config: [
        // Legal style: 1., (a), (i), (A)
        {
          reference: "legal-default",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: "(%2)",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: "(%3)",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 3,
              format: LevelFormat.UPPER_LETTER,
              text: "(%4)",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
        // Decimal hierarchy: 1., 1.1., 1.1.1.
        {
          reference: "legal-decimal",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: "%1.%2.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.35) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.DECIMAL,
              text: "%1.%2.%3.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.45) },
                },
              },
            },
            {
              level: 3,
              format: LevelFormat.DECIMAL,
              text: "%1.%2.%3.%4.",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(2), hanging: convertInchesToTwip(0.55) },
                },
              },
            },
          ],
        },
        // Bullet list
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: "\u25E6",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: "\u25AA",
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) },
                },
              },
            },
          ],
        },
      ],
    };
  }

  async compile(ast: DocumentNode): Promise<Buffer> {
    // Extract variables from meta
    if (ast.meta) {
      this.ctx.variables = { ...this.ctx.variables, ...this.flattenMeta(ast.meta.data) };
    }

    const children: (Paragraph | Table)[] = [];

    // Document title
    if (ast.title) {
      children.push(
        new Paragraph({
          text: ast.title.toUpperCase(),
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        })
      );
    }

    // Compile body
    for (const node of ast.body) {
      const compiled = this.compileNode(node);
      children.push(...compiled);
    }

    const doc = new Document({
      numbering: this.numberingConfig,
      sections: [
        {
          children,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  private compileNode(
    node: Node,
    style: TextStyle = {},
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number
  ): (Paragraph | Table)[] {
    switch (node.type) {
      case "header":
        return [this.compileHeader(node, alignment, indentLeftTwip)];

      case "numbered_item":
        return this.compileNumberedItem(node, style, alignment);

      case "bullet_item":
        return this.compileBulletItem(node, style, alignment);

      case "modifier":
        return this.compileModifier(node, style, alignment, indentLeftTwip);

      case "empty_paragraph":
        return Array.from({ length: Math.max(0, node.count) }, () =>
          new Paragraph({ indent: indentLeftTwip ? { left: indentLeftTwip } : undefined })
        );

      case "paragraph":
        return [this.compileParagraph(node, style, alignment, indentLeftTwip)];

      case "table":
        return [this.compileTable(node)];

      case "page_break":
        return [new Paragraph({ children: [new PageBreak()], indent: indentLeftTwip ? { left: indentLeftTwip } : undefined })];

      case "comment":
        return []; // Comments are not rendered

      default:
        return [];
    }
  }

  private compileHeader(
    node: HeaderNode,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number
  ): Paragraph {
    const headingLevel = this.getHeadingLevel(node.level);

    return new Paragraph({
      children: this.compileInlineNodes(node.content),
      heading: headingLevel,
      alignment: alignment ?? AlignmentType.LEFT,
      indent: indentLeftTwip ? { left: indentLeftTwip } : undefined,
    });
  }

  private compileNumberedItem(
    node: NumberedItemNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  ): (Paragraph | Table)[] {
    const results: (Paragraph | Table)[] = [];

    // Determine numbering reference based on style
    const reference = this.getNumberingReference(node.style);
    const level = node.level - 1; // 0-indexed

    results.push(
      new Paragraph({
        children: this.compileInlineNodes(node.content, style),
        numbering: { reference, level },
        alignment,
      })
    );

    const continuationIndent = this.getListTextIndentTwip(level);

    // Compile children
    for (const child of node.children) {
      if (child.type === "numbered_item" || child.type === "bullet_item") {
        results.push(...this.compileNode(child, style, alignment));
      } else {
        results.push(...this.compileNode(child, style, alignment, continuationIndent));
      }
    }

    return results;
  }

  private compileBulletItem(
    node: BulletItemNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  ): (Paragraph | Table)[] {
    const results: (Paragraph | Table)[] = [];

    results.push(
      new Paragraph({
        children: this.compileInlineNodes(node.content, style),
        numbering: { reference: "bullets", level: node.level - 1 },
        alignment,
      })
    );

    const continuationIndent = this.getListTextIndentTwip(node.level - 1);

    for (const child of node.children) {
      if (child.type === "numbered_item" || child.type === "bullet_item") {
        results.push(...this.compileNode(child, style, alignment));
      } else {
        results.push(...this.compileNode(child, style, alignment, continuationIndent));
      }
    }

    return results;
  }

  private compileModifier(
    node: ModifierNode,
    parentStyle: TextStyle,
    parentAlignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number
  ): (Paragraph | Table)[] {
    const results: (Paragraph | Table)[] = [];

    let style = { ...parentStyle };
    let alignment = parentAlignment;
    let indent = indentLeftTwip;

    switch (node.modifier) {
      case "center":
        alignment = AlignmentType.CENTER;
        break;
      case "right":
        alignment = AlignmentType.RIGHT;
        break;
      case "bold":
        style.bold = true;
        break;
      case "italic":
        style.italics = true;
        break;
      case "caps":
        style.allCaps = true;
        break;
      case "small":
        style.size = 20; // 10pt
        break;
      case "indent":
        // Indent all paragraphs in this block (0.5in per @indent level)
        indent = (indent ?? 0) + convertInchesToTwip(0.5);
        break;
      case "box":
        // TODO: Implement box styling
        break;
      case "h1":
        style.heading = 1;
        break;
      case "h2":
        style.heading = 2;
        break;
      case "h3":
        style.heading = 3;
        break;
      case "h4":
        style.heading = 4;
        break;
      case "h5":
        style.heading = 5;
        break;
      case "h6":
        style.heading = 6;
        break;
    }

    for (const child of node.content) {
      results.push(...this.compileNode(child, style, alignment, indent));
    }

    return results;
  }

  private compileParagraph(
    node: ParagraphNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number
  ): Paragraph {
    const options: IParagraphOptions = {
      children: this.compileInlineNodes(node.content, style),
      alignment: alignment ?? AlignmentType.LEFT,
      indent: indentLeftTwip ? { left: indentLeftTwip } : undefined,
    };

    // Apply heading style if set
    if (style.heading) {
      options.heading = this.getHeadingLevel(style.heading);
    }

    return new Paragraph(options);
  }

  private getListTextIndentTwip(levelIndex: number): number {
    // Matches numbering config left indents (0->0.5in, 1->1.0in, ...).
    const inches = 0.5 * (levelIndex + 1);
    return convertInchesToTwip(inches);
  }

  private compileTable(node: TableNode): Table {
    const rows = node.rows.map((row, index) => {
      const cells = row.cells.map((cellContent) => {
        return new TableCell({
          children: [
            new Paragraph({
              children: this.compileInlineNodes(cellContent),
            }),
          ],
        });
      });

      return new TableRow({
        children: cells,
        tableHeader: index === 0,
      });
    });

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  }

  private compileInlineNodes(nodes: InlineNode[], baseStyle: TextStyle = {}): TextRun[] {
    const runs: TextRun[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "text":
          runs.push(this.createTextRun(node.value, baseStyle));
          break;

        case "variable":
          const value = this.resolveVariable(node);
          runs.push(this.createTextRun(value, baseStyle));
          break;

        case "emphasis":
          const emphasisStyle = { ...baseStyle };
          if (node.style === "bold" || node.style === "bold_italic") {
            emphasisStyle.bold = true;
          }
          if (node.style === "italic" || node.style === "bold_italic") {
            emphasisStyle.italics = true;
          }
          runs.push(...this.compileInlineNodes(node.content, emphasisStyle));
          break;

        case "defined_term":
          const termStyle = { ...baseStyle };
          if (node.isDefinition) {
            termStyle.bold = true;
          }
          runs.push(this.createTextRun(`"${node.term}"`, termStyle));
          break;

        case "blank":
          runs.push(this.createTextRun("_".repeat(node.length), baseStyle));
          break;

        case "cross_ref":
          // TODO: Add hyperlink support
          runs.push(this.createTextRun(node.target, { ...baseStyle, italics: true }));
          break;
      }
    }

    return runs;
  }

  private createTextRun(text: string, style: TextStyle): TextRun {
    const options: IRunOptions = { text };

    if (style.bold) options.bold = true;
    if (style.italics) options.italics = true;
    if (style.allCaps) options.allCaps = true;
    if (style.size) options.size = style.size;

    return new TextRun(options);
  }

  private resolveVariable(node: VariableNode): string {
    let value: any = this.ctx.variables;

    for (const key of node.path) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        return `{{${node.name}}}`; // Unresolved variable
      }
    }

    // Apply filters
    let result = String(value);
    for (const filter of node.filters) {
      switch (filter) {
        case "upper":
          result = result.toUpperCase();
          break;
        case "lower":
          result = result.toLowerCase();
          break;
        case "capitalize":
          result = result.charAt(0).toUpperCase() + result.slice(1);
          break;
      }
    }

    return result;
  }

  private getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
    switch (level) {
      case 1:
        return HeadingLevel.HEADING_1;
      case 2:
        return HeadingLevel.HEADING_2;
      case 3:
        return HeadingLevel.HEADING_3;
      case 4:
        return HeadingLevel.HEADING_4;
      case 5:
        return HeadingLevel.HEADING_5;
      case 6:
        return HeadingLevel.HEADING_6;
      default:
        return HeadingLevel.HEADING_1;
    }
  }

  private getNumberingReference(style: NumberingStyle): string {
    if (style.type === "decimal_sub") {
      return "legal-decimal";
    }
    return "legal-default";
  }

  private flattenMeta(data: Record<string, any>, prefix = ""): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        Object.assign(result, this.flattenMeta(value, fullKey));
        result[key] = value; // Also keep nested object for path access
      } else {
        result[fullKey] = value;
        result[key] = value;
      }
    }

    return result;
  }
}

// Convenience function
export async function compile(ast: DocumentNode, variables?: Record<string, any>): Promise<Buffer> {
  const compiler = new DocxCompiler(variables);
  return compiler.compile(ast);
}
