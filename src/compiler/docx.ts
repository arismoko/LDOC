// DOCX Compiler for Legal Document DSL

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Bookmark,
  InternalHyperlink,
  Header,
  Footer,
  PageNumber,
  PageOrientation,
  LineRuleType,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  BorderStyle,
  ShadingType,
  WidthType,
  TableLayoutType,
  convertInchesToTwip,
  INumberingOptions,
  IParagraphOptions,
  IRunOptions,
} from "docx";

import {
  Node,
  DocumentNode,
  DocHeaderFooterNode,
  DocLayoutNode,
  AnchorNode,
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
  CrossRefNode,
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

const BOX_DEFAULTS = {
  border: {
    style: BorderStyle.SINGLE,
    // size is in eighths of a point; 8 = 1pt
    size: 8,
    color: "999999",
  },
  shading: {
    type: ShadingType.CLEAR,
    fill: "F5F5F5",
  },
  padding: {
    top: convertInchesToTwip(0.15),
    bottom: convertInchesToTwip(0.15),
    left: convertInchesToTwip(0.25),
    right: convertInchesToTwip(0.25),
  },
} as const;

export class DocxCompiler {
  private ctx: CompilerContext;
  private numberingConfig: INumberingOptions;

  private defaultSpacing?: { before?: number; after?: number; line?: number };

  private bookmarkByKey: Map<string, string> = new Map();
  private bookmarkNames: Set<string> = new Set();
  private missingCrossRefs: Set<string> = new Set();
  private missingVariables: Map<string, { line: number; column: number }> = new Map();

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
    const debug = process.env.LDOC_DEBUG === "1";
    const t0 = Date.now();
    const log = (label: string) => {
      if (!debug) return;
      const ms = Date.now() - t0;
      console.error(`[ldoc] +${ms}ms ${label}`);
    };

    log("compile:start");

    this.bookmarkByKey = new Map();
    this.bookmarkNames = new Set();
    this.missingCrossRefs = new Set();
    this.missingVariables = new Map();

    log("compile:state-reset");

    // Extract document-level settings/metadata
    if (!this.ctx.variables.document || typeof this.ctx.variables.document !== "object") {
      this.ctx.variables.document = {};
    }
    if (ast.document && typeof ast.document === "object") {
      this.ctx.variables.document = { ...(this.ctx.variables.document as any), ...ast.document };
    }

    log("compile:document-vars");

    // Extract variables from meta
    if (ast.meta) {
      this.ctx.variables = { ...this.ctx.variables, ...this.flattenMeta(ast.meta.data) };
    }

    if (debug) {
      console.error(`[ldoc] meta.parties=`, (this.ctx.variables as any).parties);
    }

    log("compile:meta-vars");

    // Expand @define/@use before indexing anchors and compiling
    const expandedAst = this.expandDefinesAndUses(ast);

    log(`compile:expanded body=${expandedAst.body.length}`);

    // Index anchors before compilation (supports forward refs)
    this.indexAnchors(expandedAst);

    log(`compile:indexAnchors keys=${this.bookmarkByKey.size}`);

    const children: (Paragraph | Table)[] = [];

    const { body: bodyWithoutLayout, layout } = this.extractLayout(expandedAst.body);
    this.defaultSpacing = layout.spacing;
    const { body, headers, footers } = this.extractHeadersFooters(bodyWithoutLayout);

    log(`compile:layout+headers body=${body.length}`);

    // NOTE: @document does not auto-render a visible title.

    // Compile body
    const isAnchorRenderable = (n: Node): boolean =>
      n.type === "header" ||
      n.type === "paragraph" ||
      n.type === "numbered_item" ||
      n.type === "bullet_item" ||
      n.type === "modifier" ||
      n.type === "table" ||
      n.type === "page_break";

    let pendingAnchors: string[] = [];
    for (const node of body) {
      if (node.type === "anchor") {
        const scope = (node as any).scope as string | undefined;
        const name = (node as any).name as string;
        pendingAnchors.push(scope && !name.includes(".") ? `${scope}.${name}` : name);
        continue;
      }

      // Skip non-renderables without consuming pending anchors
      if (!isAnchorRenderable(node)) {
        const compiled = this.compileNode(node);
        children.push(...compiled);
        continue;
      }

      const bookmarkIds = pendingAnchors.length
        ? (pendingAnchors
            .map((a) => this.bookmarkByKey.get(this.normalizeRefKey(a)))
            .filter(Boolean) as string[])
        : undefined;

      const compiled = this.compileNode(node, {}, undefined, undefined, bookmarkIds);
      children.push(...compiled);
      pendingAnchors = [];
    }

    log(`compile:body-compiled blocks=${children.length}`);

    const allowUndefined = Boolean((this.ctx.variables.document as any)?.allow_undefined);

    if (!allowUndefined && this.missingCrossRefs.size > 0) {
      const missing = Array.from(this.missingCrossRefs).sort();
      throw new Error(`Unresolved cross-references:\n- ${missing.join("\n- ")}`);
    }

    if (!allowUndefined && this.missingVariables.size > 0) {
      const missing = Array.from(this.missingVariables.entries())
        .map(([k, v]) => `${k} (line ${v.line}, col ${v.column})`)
        .sort();
      throw new Error(`Unresolved variables:\n- ${missing.join("\n- ")}`);
    }

    log("compile:validation-ok");

    const hasFirst = Boolean(headers.first || footers.first);
    const hasEven = Boolean(headers.even || footers.even);

    const sectionHeaders: any = {};
    const sectionFooters: any = {};
    if (headers.default) sectionHeaders.default = headers.default;
    if (headers.first) sectionHeaders.first = headers.first;
    if (headers.even) sectionHeaders.even = headers.even;
    if (footers.default) sectionFooters.default = footers.default;
    if (footers.first) sectionFooters.first = footers.first;
    if (footers.even) sectionFooters.even = footers.even;

    const docTitle = (this.ctx.variables.document as any)?.title;
    const docSubject = (this.ctx.variables.document as any)?.subject;
    const docCreator = (this.ctx.variables.document as any)?.creator;
    const docKeywords = (this.ctx.variables.document as any)?.keywords;

    const sectionPage: any = {};
    if (layout.margins) {
      sectionPage.margin = layout.margins;
    }
    if (layout.landscape) {
      sectionPage.size = {
        orientation: PageOrientation.LANDSCAPE,
        width: layout.pageWidthTwip,
        height: layout.pageHeightTwip,
      };
    }

    const doc = new Document({
      numbering: this.numberingConfig,
      evenAndOddHeaderAndFooters: hasEven,
      title: typeof docTitle === "string" ? docTitle : undefined,
      subject: typeof docSubject === "string" ? docSubject : undefined,
      creator: typeof docCreator === "string" ? docCreator : undefined,
      keywords: typeof docKeywords === "string" ? docKeywords : undefined,
      sections: [
        {
          properties: {
            titlePage: hasFirst,
            ...(Object.keys(sectionPage).length ? { page: sectionPage } : {}),
          },
          headers: Object.keys(sectionHeaders).length ? sectionHeaders : undefined,
          footers: Object.keys(sectionFooters).length ? sectionFooters : undefined,
          children,
        },
      ],
    });

    log("compile:doc-constructed");

    const buf = await Packer.toBuffer(doc);
    log(`compile:packed bytes=${buf.length}`);
    return buf;
  }

  private expandDefinesAndUses(ast: DocumentNode): DocumentNode {
    type Def = { params: string[]; template: Node[] };

    const defines = new Map<string, Def>();
    const bodyWithoutDefines: Node[] = [];

    const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

    for (const node of ast.body) {
      if (node.type === "define") {
        const name = (node as any).name as string;
        if (defines.has(name)) throw new Error(`Duplicate @define: ${name}`);
        defines.set(name, {
          params: ((node as any).params ?? []) as string[],
          template: ((node as any).template ?? []) as Node[],
        });
        continue;
      }
      bodyWithoutDefines.push(node);
    }

    const applyFilters = (value: string, filters: string[]): string => {
      let result = String(value);
      for (const filter of filters) {
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
    };

    const substituteParamsInInline = (nodes: any[], params: Set<string>, args: Record<string, string>): any[] => {
      return nodes.map((n) => {
        if (n.type === "variable" && Array.isArray(n.path) && n.path.length === 1) {
          const key = n.path[0];
          if (params.has(key)) {
            if (!(key in args)) {
              // leave as-is; unresolved variable validation will catch it
              return n;
            }
            return {
              type: "text",
              line: n.line,
              column: n.column,
              value: applyFilters(String(args[key]), n.filters ?? []),
            };
          }
        }
        if (n.type === "emphasis" && Array.isArray(n.content)) {
          return { ...n, content: substituteParamsInInline(n.content, params, args) };
        }
        return n;
      });
    };

    const rewriteParams = (node: any, params: Set<string>, args: Record<string, string>): any => {
      if (!node || typeof node !== "object") return node;
      if (node.type === "paragraph") {
        return { ...node, content: substituteParamsInInline(node.content ?? [], params, args) };
      }
      if (node.type === "header") {
        return { ...node, content: substituteParamsInInline(node.content ?? [], params, args) };
      }
      if (node.type === "numbered_item" || node.type === "bullet_item") {
        return {
          ...node,
          content: substituteParamsInInline(node.content ?? [], params, args),
          children: (node.children ?? []).map((c: any) => rewriteParams(c, params, args)),
        };
      }
      if (node.type === "modifier") {
        return { ...node, content: (node.content ?? []).map((c: any) => rewriteParams(c, params, args)) };
      }
      if (node.type === "table") {
        return {
          ...node,
          rows: (node.rows ?? []).map((r: any) => ({
            ...r,
            cells: (r.cells ?? []).map((cell: any[]) => substituteParamsInInline(cell ?? [], params, args)),
          })),
        };
      }
      if (node.type === "doc_header" || node.type === "doc_footer") {
        return { ...node, content: (node.content ?? []).map((c: any) => rewriteParams(c, params, args)) };
      }
      return node;
    };

    const hasAnchorNodes = (nodes: Node[]): boolean => {
      const stack: any[] = [...nodes];
      while (stack.length) {
        const n: any = stack.pop();
        if (!n || typeof n !== "object") continue;
        if (n.type === "anchor") return true;
        if (Array.isArray(n.content)) stack.push(...n.content);
        if (Array.isArray(n.children)) stack.push(...n.children);
        if (Array.isArray(n.body)) stack.push(...n.body);
        if (Array.isArray(n.rows)) stack.push(...n.rows);
      }
      return false;
    };

    const applyScope = (nodes: any[], scope: string): any[] => {
      const visit = (n: any): any => {
        if (!n || typeof n !== "object") return n;
        n.scope = scope;
        if (Array.isArray(n.content)) n.content = n.content.map(visit);
        if (Array.isArray(n.children)) n.children = n.children.map(visit);
        if (Array.isArray(n.body)) n.body = n.body.map(visit);
        if (Array.isArray(n.rows)) n.rows = n.rows.map(visit);
        if (n.type === "table_row" && Array.isArray(n.cells)) {
          n.cells = n.cells.map((cell: any[]) => cell.map(visit));
        }
        return n;
      };
      return nodes.map(visit);
    };

    const usedLabels = new Set<string>();
    const autoCounts = new Map<string, number>();

    const expandSeq = (nodes: Node[], callStack: string[] = [], depth = 0, scopePrefix?: string): Node[] => {
      if (depth > 50) throw new Error("@use expansion too deep (possible recursion)");
      const out: Node[] = [];
      for (const node of nodes) {
        if ((node as any).type !== "use") {
          out.push(node);
          continue;
        }

        const useName = (node as any).name as string;
        const useArgs = ((node as any).args ?? {}) as Record<string, string>;
        const useLabel = ((node as any).label ?? undefined) as string | undefined;
        const def = defines.get(useName);
        if (!def) throw new Error(`Unknown @use: ${useName}`);

        if (callStack.includes(useName)) {
          throw new Error(`Recursive @use detected: ${[...callStack, useName].join(" -> ")}`);
        }

        // Validate args
        const paramSet = new Set(def.params);
        for (const k of Object.keys(useArgs)) {
          if (!paramSet.has(k)) {
            throw new Error(`@use ${useName}: unknown param '${k}'`);
          }
        }

        const missingParams = def.params.filter((p) => !(p in useArgs));
        if (missingParams.length > 0) {
          throw new Error(`@use ${useName}: missing required param(s): ${missingParams.join(", ")}`);
        }

        const templateHasAnchors = hasAnchorNodes(def.template);

        // Sugar: if no label is provided, auto-generate one (stable within a single compilation).
        const label =
          useLabel ??
          (() => {
            const n = (autoCounts.get(useName) ?? 0) + 1;
            autoCounts.set(useName, n);
            return `${useName}_${n}`;
          })();

        const fullScope = scopePrefix ? `${scopePrefix}.${label}` : label;
        if (fullScope && usedLabels.has(fullScope)) {
          throw new Error(`Duplicate @use label: ${fullScope}`);
        }
        if (fullScope) usedLabels.add(fullScope);

        const cloned = def.template.map((n) => clone(n));
        const rewritten = def.params.length > 0 ? cloned.map((n: any) => rewriteParams(n, paramSet, useArgs)) : cloned;
        const scoped = fullScope ? applyScope(rewritten as any, fullScope) : (rewritten as any);
        const expanded = expandSeq(scoped as any, [...callStack, useName], depth + 1, fullScope);
        out.push(...expanded);
      }
      return out;
    };

    const expandedBody = expandSeq(bodyWithoutDefines);
    return { ...ast, body: expandedBody };
  }

  private applyDefaultSpacing(options: IParagraphOptions): void {
    if (!this.defaultSpacing) return;
    if (options.spacing) return;

    const spacing: any = {};
    if (this.defaultSpacing.before !== undefined) spacing.before = this.defaultSpacing.before;
    if (this.defaultSpacing.after !== undefined) spacing.after = this.defaultSpacing.after;
    if (this.defaultSpacing.line !== undefined) {
      spacing.line = this.defaultSpacing.line;
      spacing.lineRule = LineRuleType.AUTO;
    }

    if (Object.keys(spacing).length > 0) {
      options.spacing = spacing;
    }
  }

  private compileNode(
    node: Node,
    style: TextStyle = {},
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
  ): (Paragraph | Table)[] {
    switch (node.type) {
      case "header":
        return [this.compileHeader(node, alignment, indentLeftTwip, forcedBookmarks)];

      case "numbered_item":
        return this.compileNumberedItem(node, style, alignment, forcedBookmarks);

      case "bullet_item":
        return this.compileBulletItem(node, style, alignment, forcedBookmarks);

      case "modifier":
        return this.compileModifier(node, style, alignment, indentLeftTwip, forcedBookmarks);

      case "empty_paragraph":
        if (forcedBookmarks && forcedBookmarks.length > 0) {
          const first = this.makeBookmarkParagraph(forcedBookmarks, indentLeftTwip);
          const rest = Array.from({ length: Math.max(0, node.count) }, () =>
            new Paragraph({ indent: indentLeftTwip ? { left: indentLeftTwip } : undefined })
          );
          return [first, ...rest];
        }
        return Array.from({ length: Math.max(0, node.count) }, () =>
          new Paragraph({ indent: indentLeftTwip ? { left: indentLeftTwip } : undefined })
        );

      case "paragraph":
        return [this.compileParagraph(node, style, alignment, indentLeftTwip, forcedBookmarks)];

      case "table":
        return [this.compileTable(node, forcedBookmarks, indentLeftTwip)];

      case "page_break":
        if (forcedBookmarks && forcedBookmarks.length > 0) {
          return [
            this.makeBookmarkParagraph(forcedBookmarks, indentLeftTwip),
            new Paragraph({ children: [new PageBreak()], indent: indentLeftTwip ? { left: indentLeftTwip } : undefined }),
          ];
        }
        return [new Paragraph({ children: [new PageBreak()], indent: indentLeftTwip ? { left: indentLeftTwip } : undefined })];

      case "comment":
        return []; // Comments are not rendered

      case "doc_layout":
        return [];

      case "anchor":
        return [];

      default:
        return [];
    }
  }

  private makeBookmarkParagraph(bookmarkIds: string[], indentLeftTwip?: number): Paragraph {
    let children: any[] = [new TextRun({ text: "" })];
    for (let i = bookmarkIds.length - 1; i >= 0; i--) {
      children = [new Bookmark({ id: bookmarkIds[i], children })];
    }
    const options: IParagraphOptions = { children, indent: indentLeftTwip ? { left: indentLeftTwip } : undefined };
    this.applyDefaultSpacing(options);
    return new Paragraph(options);
  }

  private extractLayout(body: Node[]): {
    body: Node[];
    layout: {
      margins?: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number };
      spacing?: { before?: number; after?: number; line?: number };
      landscape: boolean;
      pageWidthTwip: number;
      pageHeightTwip: number;
    };
  } {
    // Defaults: Letter portrait unless landscape enabled
    const LETTER_PORTRAIT = { width: 12240, height: 15840 };
    const LETTER_LANDSCAPE = { width: 15840, height: 12240 };
    const A4_PORTRAIT = { width: Math.round(8.27 * 1440), height: Math.round(11.69 * 1440) };
    const A4_LANDSCAPE = { width: A4_PORTRAIT.height, height: A4_PORTRAIT.width };

    let pageSize: "letter" | "a4" = "letter";

    const layout: any = {
      landscape: false,
      pageWidthTwip: LETTER_PORTRAIT.width,
      pageHeightTwip: LETTER_PORTRAIT.height,
    };

    const keep: Node[] = [];
    for (const n of body) {
      if (n.type !== "doc_layout") {
        keep.push(n);
        continue;
      }

      const dl = n as any as DocLayoutNode;
      switch (dl.kind) {
        case "margins": {
          layout.margins = this.parseMargins(dl.args);
          break;
        }
        case "spacing": {
          layout.spacing = this.parseSpacing(dl.args);
          break;
        }
        case "landscape": {
          const arg = (dl.args || "").trim().toLowerCase();
          if (arg === "a4") pageSize = "a4";
          if (arg === "letter" || arg === "") pageSize = pageSize;
          layout.landscape = true;
          break;
        }
        case "columns": {
          throw new Error("@columns is parsed but not implemented yet");
        }
      }
    }

    const size = pageSize === "a4" ? (layout.landscape ? A4_LANDSCAPE : A4_PORTRAIT) : (layout.landscape ? LETTER_LANDSCAPE : LETTER_PORTRAIT);
    layout.pageWidthTwip = size.width;
    layout.pageHeightTwip = size.height;

    return { body: keep, layout };
  }

  private parseLengthToTwip(raw: string): number {
    const m = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)(in|cm|mm|pt)$/i);
    if (!m) {
      throw new Error(`Invalid length: ${raw}. Use units like 1in, 2cm, 12pt.`);
    }
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    switch (unit) {
      case "in":
        return Math.round(value * 1440);
      case "cm":
        return Math.round(value * 1440 / 2.54);
      case "mm":
        return Math.round(value * 1440 / 25.4);
      case "pt":
        return Math.round(value * 20);
      default:
        throw new Error(`Unsupported unit: ${unit}`);
    }
  }

  private parseMargins(args: string): { top: number; right: number; bottom: number; left: number; header?: number; footer?: number } {
    const parts = (args || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      throw new Error("@margins requires values, e.g. @margins 1in or @margins 1in 1.25in 1in 1.25in");
    }

    const kv: Record<string, number> = {};
    const vals: number[] = [];
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq !== -1) {
        const k = p.slice(0, eq).toLowerCase();
        const v = p.slice(eq + 1);
        kv[k] = this.parseLengthToTwip(v);
      } else {
        vals.push(this.parseLengthToTwip(p));
      }
    }

    let top: number, right: number, bottom: number, left: number;
    if (vals.length === 1) {
      top = right = bottom = left = vals[0];
    } else if (vals.length === 2) {
      top = bottom = vals[0];
      left = right = vals[1];
    } else if (vals.length === 3) {
      top = vals[0];
      left = right = vals[1];
      bottom = vals[2];
    } else if (vals.length === 4) {
      [top, right, bottom, left] = vals;
    } else if (vals.length === 0) {
      // allow only key=value forms
      top = right = bottom = left = this.parseLengthToTwip("1in");
    } else {
      throw new Error("@margins supports 1-4 positional values (CSS-like), plus optional header=/footer=");
    }

    const out: any = { top, right, bottom, left };
    if (kv.header !== undefined) out.header = kv.header;
    if (kv.footer !== undefined) out.footer = kv.footer;
    return out;
  }

  private parseSpacing(args: string): { before?: number; after?: number; line?: number } {
    const raw = (args || "").trim();
    if (!raw) throw new Error("@spacing requires args, e.g. @spacing 1.5 or @spacing before=6pt after=6pt line=1.5");

    const parts = raw.split(/\s+/).filter(Boolean);
    const out: any = {};
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq === -1) {
        // line multiplier
        const mult = parseFloat(p);
        if (!Number.isFinite(mult) || mult <= 0) throw new Error(`Invalid line spacing: ${p}`);
        out.line = Math.round(mult * 240);
        continue;
      }
      const k = p.slice(0, eq).toLowerCase();
      const v = p.slice(eq + 1);
      if (k === "line") {
        const mult = parseFloat(v);
        if (!Number.isFinite(mult) || mult <= 0) throw new Error(`Invalid line spacing: ${v}`);
        out.line = Math.round(mult * 240);
      } else if (k === "before") {
        out.before = this.parseLengthToTwip(v);
      } else if (k === "after") {
        out.after = this.parseLengthToTwip(v);
      } else {
        throw new Error(`Unknown @spacing key: ${k}`);
      }
    }
    return out;
  }

  private compileHeader(
    node: HeaderNode,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
  ): Paragraph {
    const headingLevel = this.getHeadingLevel(node.level);

    const text = this.inlineText(node.content);
    const key = this.normalizeRefKey(text);
    const anchor = this.bookmarkByKey.get(key);
    const children = this.compileInlineNodes(node.content, {}, (node as any).scope);

    let wrappedChildren: any[] = children;
    if (forcedBookmarks && forcedBookmarks.length > 0) {
      for (let i = forcedBookmarks.length - 1; i >= 0; i--) {
        wrappedChildren = [new Bookmark({ id: forcedBookmarks[i], children: wrappedChildren })];
      }
    }
    if (anchor) {
      wrappedChildren = [new Bookmark({ id: anchor, children: wrappedChildren })];
    }

    const options: IParagraphOptions = {
      children: wrappedChildren,
      heading: headingLevel,
      alignment: alignment ?? AlignmentType.LEFT,
      indent: indentLeftTwip ? { left: indentLeftTwip } : undefined,
    };

    this.applyDefaultSpacing(options);
    return new Paragraph(options);
  }

  private compileNumberedItem(
    node: NumberedItemNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    forcedBookmarks?: string[]
  ): (Paragraph | Table)[] {
    const results: (Paragraph | Table)[] = [];

    // Determine numbering reference based on style
    const reference = this.getNumberingReference(node.style);
    const level = node.level - 1; // 0-indexed

    const listChildren = this.wrapBookmarkForListItem(node, style, forcedBookmarks);
    results.push(
      new Paragraph({
        children: listChildren,
        numbering: { reference, level },
        alignment,
        spacing: this.defaultSpacing
          ? {
              ...(this.defaultSpacing.before !== undefined ? { before: this.defaultSpacing.before } : {}),
              ...(this.defaultSpacing.after !== undefined ? { after: this.defaultSpacing.after } : {}),
              ...(this.defaultSpacing.line !== undefined
                ? { line: this.defaultSpacing.line, lineRule: LineRuleType.AUTO }
                : {}),
            }
          : undefined,
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
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    forcedBookmarks?: string[]
  ): (Paragraph | Table)[] {
    const results: (Paragraph | Table)[] = [];

    const bulletChildren = this.wrapBookmarkForBulletItem(node, style, forcedBookmarks);
    results.push(
      new Paragraph({
        children: bulletChildren,
        numbering: { reference: "bullets", level: node.level - 1 },
        alignment,
        spacing: this.defaultSpacing
          ? {
              ...(this.defaultSpacing.before !== undefined ? { before: this.defaultSpacing.before } : {}),
              ...(this.defaultSpacing.after !== undefined ? { after: this.defaultSpacing.after } : {}),
              ...(this.defaultSpacing.line !== undefined
                ? { line: this.defaultSpacing.line, lineRule: LineRuleType.AUTO }
                : {}),
            }
          : undefined,
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
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
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
        // Indent all paragraphs in this block (0.5in per level)
        indent = (indent ?? 0) + convertInchesToTwip(0.5 * (node.count ?? 1));
        break;
      case "outdent":
        // Outdent all paragraphs in this block (0.5in per level)
        indent = Math.max(0, (indent ?? 0) - convertInchesToTwip(0.5 * (node.count ?? 1)));
        break;
      case "box":
        return [this.compileBox(node, style, alignment, indent, forcedBookmarks)];
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

    let pending = forcedBookmarks;
    for (const child of node.content) {
      results.push(...this.compileNode(child, style, alignment, indent, pending));
      pending = undefined;
    }

    return results;
  }

  private compileBox(
    node: ModifierNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
  ): Table {
    const children: (Paragraph | Table)[] = [];
    if (forcedBookmarks && forcedBookmarks.length > 0) {
      children.push(this.makeBookmarkParagraph(forcedBookmarks));
    }
    for (const child of node.content) {
      children.push(...this.compileNode(child, style, alignment, indentLeftTwip));
    }

    if (children.length === 0) {
      children.push(new Paragraph({}));
    }

    const border = {
      style: BOX_DEFAULTS.border.style,
      size: BOX_DEFAULTS.border.size,
      color: BOX_DEFAULTS.border.color,
    };

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      indent: indentLeftTwip ? { size: indentLeftTwip, type: WidthType.DXA } : undefined,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              children,
              shading: BOX_DEFAULTS.shading,
              margins: BOX_DEFAULTS.padding,
              borders: {
                top: border,
                bottom: border,
                left: border,
                right: border,
              },
            }),
          ],
        }),
      ],
    });
  }

  private compileParagraph(
    node: ParagraphNode,
    style: TextStyle,
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType],
    indentLeftTwip?: number,
    forcedBookmarks?: string[]
  ): Paragraph {
    const options: IParagraphOptions = {
      children: this.wrapBookmarkForParagraph(node, style, forcedBookmarks),
      alignment: alignment ?? AlignmentType.LEFT,
      indent: indentLeftTwip ? { left: indentLeftTwip } : undefined,
    };

    this.applyDefaultSpacing(options);

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

  private compileTable(node: TableNode, forcedBookmarks?: string[], indentLeftTwip?: number): Table {
    const rows = node.rows.map((row, index) => {
      const cells = row.cells.map((cellContent) => {
        let paragraphChildren: any[] = this.compileInlineNodes(cellContent, {}, (node as any).scope);
        if (forcedBookmarks && forcedBookmarks.length > 0 && index === 0) {
          for (let i = forcedBookmarks.length - 1; i >= 0; i--) {
            paragraphChildren = [new Bookmark({ id: forcedBookmarks[i], children: paragraphChildren })];
          }
          forcedBookmarks = undefined;
        }
        return new TableCell({
          children: [
            new Paragraph({
              children: paragraphChildren,
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
      indent: indentLeftTwip ? { size: indentLeftTwip, type: WidthType.DXA } : undefined,
    });
  }

  private compileInlineNodes(nodes: InlineNode[], baseStyle: TextStyle = {}, scope?: string): any[] {
    const runs: any[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "text":
          runs.push(this.createTextRun(node.value, baseStyle));
          break;

        case "variable":
          if (node.path.length === 1 && node.path[0] === "page") {
            runs.push(new TextRun({ children: [PageNumber.CURRENT] }));
            break;
          }
          if (node.path.length === 1 && node.path[0] === "pages") {
            runs.push(new TextRun({ children: [PageNumber.TOTAL_PAGES] }));
            break;
          }
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
          runs.push(...this.compileInlineNodes(node.content, emphasisStyle, scope));
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
          const raw = node.target;
          const anchor = this.resolveAnchor(raw, scope);
          if (!anchor) {
            this.missingCrossRefs.add(raw.trim());
            runs.push(this.createTextRun(raw, { ...baseStyle, italics: true }));
            break;
          }

          runs.push(
            new InternalHyperlink({
              anchor,
              children: [
                new TextRun({
                  text: raw,
                  style: "Hyperlink",
                }),
              ],
            })
          );
          break;
      }
    }

    return runs;
  }

  private wrapBookmarkForParagraph(node: ParagraphNode, style: TextStyle, forcedBookmarks?: string[]): any[] {
    const children = this.compileInlineNodes(node.content, style, (node as any).scope);
    let wrapped: any[] = children;
    if (forcedBookmarks && forcedBookmarks.length > 0) {
      for (let i = forcedBookmarks.length - 1; i >= 0; i--) {
        wrapped = [new Bookmark({ id: forcedBookmarks[i], children: wrapped })];
      }
    }

    // Only auto-bookmark heading-styled paragraphs
    if (!style.heading) return wrapped;

    const text = this.inlineText(node.content);
    const anchor = this.bookmarkByKey.get(this.normalizeRefKey(text));
    return anchor ? [new Bookmark({ id: anchor, children: wrapped })] : wrapped;
  }

  private wrapBookmarkForListItem(node: NumberedItemNode, style: TextStyle, forcedBookmarks?: string[]): any[] {
    let children: any[] = this.compileInlineNodes(node.content, style, (node as any).scope);
    if (forcedBookmarks && forcedBookmarks.length > 0) {
      for (let i = forcedBookmarks.length - 1; i >= 0; i--) {
        children = [new Bookmark({ id: forcedBookmarks[i], children })];
      }
    }
    const label = this.numberingLabel(node.style);
    if (!label) return children;
    const anchor = this.bookmarkByKey.get(this.normalizeRefKey(label));
    return anchor ? [new Bookmark({ id: anchor, children })] : children;
  }

  private wrapBookmarkForBulletItem(node: BulletItemNode, style: TextStyle, forcedBookmarks?: string[]): any[] {
    let children: any[] = this.compileInlineNodes(node.content, style, (node as any).scope);
    if (forcedBookmarks && forcedBookmarks.length > 0) {
      for (let i = forcedBookmarks.length - 1; i >= 0; i--) {
        children = [new Bookmark({ id: forcedBookmarks[i], children })];
      }
    }
    // Bullets have no stable label by default
    return children;
  }

  private resolveAnchor(raw: string, scope?: string): string | undefined {
    const trimmed = raw.trim();

    // If already qualified (Label.foo), don't auto-scope
    const isQualified = trimmed.includes(".");

    const tryKey = (label: string) => this.bookmarkByKey.get(this.normalizeRefKey(label));

    if (scope && !isQualified) {
      const scoped = `${scope}.${trimmed}`;
      const hit = tryKey(scoped);
      if (hit) return hit;
    }

    const direct = tryKey(trimmed);
    if (direct) return direct;

    // Try stripping common prefixes
    const stripped = trimmed
      .trim()
      .replace(/^section\s+/i, "")
      .replace(/^article\s+/i, "")
      .replace(/^exhibit\s+/i, "")
      .trim();

    if (scope && !isQualified) {
      const hit = tryKey(`${scope}.${stripped}`);
      if (hit) return hit;
    }
    return tryKey(stripped);
  }

  private indexAnchors(ast: DocumentNode): void {
    const duplicate: string[] = [];

    const define = (lookup: string, bookmarkName: string, source?: { line: number; column: number }, scope?: string): void => {
      const scopedLookup = scope && !lookup.includes(".") ? `${scope}.${lookup}` : lookup;
      const key = this.normalizeRefKey(scopedLookup);
      if (!key) return;
      const existing = this.bookmarkByKey.get(key);
      if (existing && existing !== bookmarkName) {
        duplicate.push(source ? `${lookup} (line ${source.line}, col ${source.column})` : lookup);
        return;
      }
      this.bookmarkByKey.set(key, bookmarkName);
    };

    const newBookmarkName = (label: string): string => {
      const base = this.bookmarkSafeName(label);
      let name = base;
      let i = 2;
      while (this.bookmarkNames.has(name)) {
        name = `${base}_${i++}`;
        if (name.length > 40) name = name.slice(0, 40);
      }
      this.bookmarkNames.add(name);
      return name;
    };

    const isAnchorRenderable = (n: Node): boolean =>
      n.type === "header" ||
      n.type === "paragraph" ||
      n.type === "numbered_item" ||
      n.type === "bullet_item" ||
      n.type === "modifier" ||
      n.type === "table" ||
      n.type === "page_break";

    const walkSeq = (nodes: Node[], style: TextStyle = {}): void => {
      let pendingAnchors: AnchorNode[] = [];

      const attachPending = (bookmark: string, scope?: string) => {
        if (pendingAnchors.length === 0) return;
        for (const a of pendingAnchors) {
          define(a.name.trim(), bookmark, { line: a.line, column: a.column }, scope);
        }
        pendingAnchors = [];
      };

      const bookmarkForPending = (): string | null => {
        if (pendingAnchors.length === 0) return null;
        // If an anchor name is already defined (e.g. a heading already created it), reuse it.
        for (const a of pendingAnchors) {
          const key = this.normalizeRefKey(a.name.trim());
          const existing = this.bookmarkByKey.get(key);
          if (existing) return existing;
        }
        return newBookmarkName(pendingAnchors[0].name.trim());
      };

      for (const node of nodes) {
        if (node.type === "anchor") {
          pendingAnchors.push(node as any);
          continue;
        }

        // Do not attach anchors to non-renderables (blank lines, comments, layout directives, etc.)
        if (!isAnchorRenderable(node)) {
          continue;
        }

        switch (node.type) {
          case "header": {
            const text = this.inlineText(node.content);
            const bookmark = newBookmarkName(text);
            const scope = (node as any).scope as string | undefined;
            define(text, bookmark, undefined, scope);
            attachPending(bookmark, scope);
            break;
          }
          case "numbered_item": {
            const label = this.numberingLabel(node.style);
            if (label) {
              const bookmark = newBookmarkName(label);
              const scope = (node as any).scope as string | undefined;
              define(label, bookmark, undefined, scope);
              if (/^\d/.test(label)) {
                define(`Section ${label}`, bookmark, undefined, scope);
                define(`Article ${label}`, bookmark, undefined, scope);
              }
              attachPending(bookmark, scope);
            } else if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }
            walkSeq(node.children, style);
            break;
          }
          case "bullet_item": {
            if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }
            walkSeq(node.children, style);
            break;
          }
          case "modifier": {
            const next: TextStyle = { ...style };
            if (node.modifier === "h1") next.heading = 1;
            if (node.modifier === "h2") next.heading = 2;
            if (node.modifier === "h3") next.heading = 3;
            if (node.modifier === "h4") next.heading = 4;
            if (node.modifier === "h5") next.heading = 5;
            if (node.modifier === "h6") next.heading = 6;

            if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }

            walkSeq(node.content, next);
            break;
          }
          case "paragraph": {
            if (style.heading) {
              const text = this.inlineText(node.content);
              const bookmark = newBookmarkName(text);
              const scope = (node as any).scope as string | undefined;
              define(text, bookmark, undefined, scope);
              attachPending(bookmark, scope);
            } else if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }
            break;
          }
          case "table": {
            if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }
            break;
          }
          case "page_break": {
            if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              const scope = (node as any).scope as string | undefined;
              if (bookmark) attachPending(bookmark, scope);
            }
            break;
          }
          default:
            if (pendingAnchors.length > 0) {
              const bookmark = bookmarkForPending();
              if (bookmark) attachPending(bookmark);
            }
            break;
        }
      }
    };

    walkSeq(ast.body, {});

    if (duplicate.length > 0) {
      const uniq = Array.from(new Set(duplicate)).sort();
      throw new Error(`Duplicate anchors:\n- ${uniq.join("\n- ")}`);
    }
  }

  private registerAnchor(labelForLookup: string, labelForName: string): void {
    const key = this.normalizeRefKey(labelForLookup);
    if (!key) return;
    if (this.bookmarkByKey.has(key)) return;

    const base = this.bookmarkSafeName(labelForName);
    let name = base;
    let i = 2;
    while (this.bookmarkNames.has(name)) {
      name = `${base}_${i++}`;
      if (name.length > 40) name = name.slice(0, 40);
    }
    this.bookmarkNames.add(name);
    this.bookmarkByKey.set(key, name);
  }

  private bookmarkSafeName(label: string): string {
    // Word bookmark rules: start with letter, only [A-Za-z0-9_], no spaces.
    const slug = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+/, "")
      .replace(/_+$/, "");
    const core = slug || "anchor";
    const prefixed = /^[a-z]/.test(core) ? core : `a_${core}`;
    const clipped = prefixed.length > 40 ? prefixed.slice(0, 40) : prefixed;
    return clipped;
  }

  private normalizeRefKey(label: string): string {
    return label
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .toLowerCase();
  }

  private numberingLabel(style: NumberingStyle): string | undefined {
    switch (style.type) {
      case "decimal_sub":
        return style.pattern;
      default:
        return undefined;
    }
  }

  private inlineText(nodes: InlineNode[]): string {
    let s = "";
    for (const n of nodes) {
      if (n.type === "text") s += n.value;
      else if (n.type === "variable") s += `{{${n.name}}}`;
      else if (n.type === "defined_term") s += `"${n.term}"`;
      else if (n.type === "cross_ref") s += `[[${n.target}]]`;
      else if (n.type === "blank") s += "_".repeat(n.length);
      else if (n.type === "emphasis") s += this.inlineText(n.content);
    }
    return s.trim();
  }

  private createTextRun(text: string, style: TextStyle): TextRun {
    const options: IRunOptions = { text };

    if (style.bold) options.bold = true;
    if (style.italics) options.italics = true;
    if (style.allCaps) options.allCaps = true;
    if (style.size) options.size = style.size;

    return new TextRun(options);
  }

  private extractHeadersFooters(body: Node[]): {
    body: Node[];
    headers: { default?: Header; first?: Header; even?: Header };
    footers: { default?: Footer; first?: Footer; even?: Footer };
  } {
    const keep: Node[] = [];

    const headerNodes: Record<string, DocHeaderFooterNode | undefined> = {
      default: undefined,
      first: undefined,
      even: undefined,
    };
    const footerNodes: Record<string, DocHeaderFooterNode | undefined> = {
      default: undefined,
      first: undefined,
      even: undefined,
    };

    for (const n of body) {
      if (n.type === "doc_header") {
        headerNodes[(n as any).scope] = n as any;
        continue;
      }
      if (n.type === "doc_footer") {
        footerNodes[(n as any).scope] = n as any;
        continue;
      }
      keep.push(n);
    }

    const compileHF = (node?: DocHeaderFooterNode): (Paragraph | Table)[] => {
      if (!node) return [];
      const parts: (Paragraph | Table)[] = [];
      for (const child of node.content) {
        parts.push(...this.compileNode(child));
      }
      // Ensure at least one paragraph so Word shows the header/footer region
      if (parts.length === 0) parts.push(new Paragraph({}));
      return parts;
    };

    const headers: any = {
      default: headerNodes.default ? new Header({ children: compileHF(headerNodes.default) }) : undefined,
      first: headerNodes.first ? new Header({ children: compileHF(headerNodes.first) }) : undefined,
      even: headerNodes.even ? new Header({ children: compileHF(headerNodes.even) }) : undefined,
    };

    const footers: any = {
      default: footerNodes.default ? new Footer({ children: compileHF(footerNodes.default) }) : undefined,
      first: footerNodes.first ? new Footer({ children: compileHF(footerNodes.first) }) : undefined,
      even: footerNodes.even ? new Footer({ children: compileHF(footerNodes.even) }) : undefined,
    };

    return { body: keep, headers, footers };
  }

  private resolveVariable(node: VariableNode): string {
    let value: any = this.ctx.variables;

    for (const key of node.path) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        const label = node.path.join(".");
        if (!this.missingVariables.has(label)) {
          this.missingVariables.set(label, { line: node.line, column: node.column });
        }
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
