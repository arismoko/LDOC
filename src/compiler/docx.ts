// DOCX Compiler for Legal Document DSL

import {
  Document,
  Packer,
  Paragraph,
  Header,
  Footer,
  PageOrientation,
  Table,
} from "docx";

import type { ISectionOptions } from "docx";

import type {
  Node,
  DocumentNode,
  DocHeaderFooterNode,
  ColumnsRegionNode,
  ImageNode,
} from "../parser/ast";

// Import from extracted modules
import type { StyleConfig, TextStyle } from "./styles";
import {
  buildDocumentStyles,
  getBodyStyle,
  getHeaderStyle,
  getFooterStyle,
} from "./styles";

import { expandDefinesAndUses } from "./expansion";

import {
  extractLayoutFromDocument,
  extractStylesFromDocument,
} from "./settings";

import { BookmarkManager } from "./bookmarks";
import { inlineText } from "./text";

import {
  createNumberingConfig,
} from "./numbering";

import type { CompilationContext } from "./context";
import { createContext } from "./context";
import { DocxNodeVisitor } from "./visitors";
import { SectionBuilder } from "./section-builder";
import { walkTree } from "../parser/ast";

export class DocxCompiler {
  private ctx: CompilationContext;

  constructor(variables: Record<string, any> = {}) {
    this.ctx = createContext(variables);
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

    // Reset context
    this.ctx = createContext(this.ctx.variables);

    // Set numbering scheme from AST
    this.ctx.numberingScheme = ast.numberingScheme ?? "default";

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

    // Expand @define/@use, resolve @import, and prune control flow before indexing anchors and compiling
    const expandedAst = await expandDefinesAndUses(ast, this.ctx.variables);

    // Index footnotes and pre-fetch images
    // We need to find all FootnoteDefinitionNodes in the AST and map them to IDs.
    // Footnote definitions are usually at the top level of the body.
    // We assign IDs starting from 1.
    let footnoteId = 1;
    
    // Filter definitions from body and index them
    const filteredBody: Node[] = [];
    for (const node of expandedAst.body) {
      if (node.type === "footnote_def") {
        const defNode = node as any; // Cast to avoid type issues if not fully propagated
        this.ctx.footnoteMap.set(defNode.label, footnoteId++);
        if (!this.ctx.footnoteDefinitions) {
          this.ctx.footnoteDefinitions = new Map();
        }
        this.ctx.footnoteDefinitions.set(defNode.label, defNode);
      } else {
        filteredBody.push(node);
      }
    }
    expandedAst.body = filteredBody;

    // Pre-fetch images (URLs)
    const imageUrls: string[] = [];
    walkTree(expandedAst, (node) => {
      if (node.type === "image") {
        const img = node as ImageNode;
        if (img.src.startsWith("http://") || img.src.startsWith("https://")) {
          imageUrls.push(img.src);
        }
      }
    });

    if (imageUrls.length > 0) {
      log(`compile:prefetching ${imageUrls.length} images`);
      await Promise.all(
        imageUrls.map(async (url) => {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
            const buffer = await res.arrayBuffer();
            this.ctx.imageCache.set(url, Buffer.from(buffer));
          } catch (e) {
            console.error(`[ldoc] Failed to pre-fetch image ${url}:`, e);
            // We'll handle the missing image in the visitor
          }
        })
      );
      log(`compile:prefetch-complete`);
    }

    log(`compile:expanded body=${expandedAst.body.length}`);

    // Index anchors before compilation (supports forward refs)
    this.ctx.bookmarkManager.indexAnchors(expandedAst, (nodes) => inlineText(nodes));

    log(`compile:indexAnchors keys=${this.ctx.bookmarkManager.size}`);

    // Extract layout and styles from @document block (new approach)
    const layout = extractLayoutFromDocument(expandedAst.document);
    this.ctx.defaultSpacing = layout.spacing;
    const styleConfig = extractStylesFromDocument(expandedAst.document);
    this.ctx.styleConfig = styleConfig;
    const { body, headers, footers } = this.extractHeadersFooters(expandedAst.body);

    log(`compile:layout+headers body=${body.length}`);

    // NOTE: @document does not auto-render a visible title.

    // Build base page properties for all sections
    const basePageProps: any = {};
    if (layout.margins) {
      basePageProps.margin = layout.margins;
    }
    // Always set page size to avoid docx library defaulting to A4
    basePageProps.size = {
      width: layout.pageWidthTwip,
      height: layout.pageHeightTwip,
      ...(layout.landscape ? { orientation: PageOrientation.LANDSCAPE } : {}),
    };

    const hasEven = Boolean(headers.even || footers.even);

    // Create section builder
    const sectionBuilder = new SectionBuilder(basePageProps, headers, footers);

    // Compile body nodes
    const isAnchorRenderable = (n: Node): boolean =>
      n.type === "header" ||
      n.type === "paragraph" ||
      n.type === "numbered_item" ||
      n.type === "bullet_item" ||
      n.type === "modifier" ||
      n.type === "table" ||
      n.type === "page_break" ||
      n.type === "columns_region";

    let pendingAnchors: string[] = [];
    
    // Main body compilation loop
    for (const node of body) {
      if (node.type === "anchor") {
        const scope = (node as any).scope as string | undefined;
        const name = (node as any).name as string;
        pendingAnchors.push(scope && !name.includes(".") ? `${scope}.${name}` : name);
        continue;
      }

      // Handle columns_region specially
      if (node.type === "columns_region") {
        const colNode = node as ColumnsRegionNode;

        // Compile children of the columns region
        const columnsChildren: (Paragraph | Table)[] = [];
        let colPendingAnchors: string[] = [];
        for (const child of colNode.children) {
          if (child.type === "anchor") {
            const scope = (child as any).scope as string | undefined;
            const name = (child as any).name as string;
            colPendingAnchors.push(scope && !name.includes(".") ? `${scope}.${name}` : name);
            continue;
          }

          if (!isAnchorRenderable(child)) {
            // Compile without bookmarks
            const visitor = new DocxNodeVisitor(this.ctx);
            columnsChildren.push(...visitor.visit(child));
            continue;
          }

          const bookmarkIds = colPendingAnchors.length
            ? (colPendingAnchors
                .map((a) => this.ctx.bookmarkManager.getBookmark(a))
                .filter(Boolean) as string[])
            : undefined;

          const visitor = new DocxNodeVisitor(this.ctx, bookmarkIds);
          columnsChildren.push(...visitor.visit(child));
          colPendingAnchors = [];
        }

        // Add columns section via builder
        sectionBuilder.addColumns(
          columnsChildren,
          colNode.columnCount,
          colNode.gapTwip,
          colNode.separator
        );

        // After columns, we'll create another section that reverts to single column
        // This will be done when the next content is added or at the end
        continue;
      }

      // Skip non-renderables without consuming pending anchors
      if (!isAnchorRenderable(node)) {
        const visitor = new DocxNodeVisitor(this.ctx);
        sectionBuilder.addChildren(visitor.visit(node));
        continue;
      }

      const bookmarkIds = pendingAnchors.length
        ? (pendingAnchors
            .map((a) => this.ctx.bookmarkManager.getBookmark(a))
            .filter(Boolean) as string[])
        : undefined;

      const visitor = new DocxNodeVisitor(this.ctx, bookmarkIds);
      sectionBuilder.addChildren(visitor.visit(node));
      pendingAnchors = [];
    }

    // Finalize sections
    const sections = sectionBuilder.finish();

    log(`compile:body-compiled sections=${sections.length}`);

    const allowUndefined = Boolean((this.ctx.variables.document as any)?.allow_undefined);

    if (!allowUndefined && this.ctx.missingCrossRefs.size > 0) {
      const missing = Array.from(this.ctx.missingCrossRefs).sort();
      throw new Error(`Unresolved cross-references:\n- ${missing.join("\n- ")}`);
    }

    if (!allowUndefined && this.ctx.missingVariables.size > 0) {
      const missing = Array.from(this.ctx.missingVariables.entries())
        .map(([k, v]) => `${k} (line ${v.line}, col ${v.column})`)
        .sort();
      throw new Error(`Unresolved variables:\n- ${missing.join("\n- ")}`);
    }

    log("compile:validation-ok");

    const docTitle = (this.ctx.variables.document as any)?.title;
    const docSubject = (this.ctx.variables.document as any)?.subject;
    const docCreator = (this.ctx.variables.document as any)?.creator;
    const docKeywords = (this.ctx.variables.document as any)?.keywords;

    // Build document styles from @styles directives
    const docStyles = buildDocumentStyles(this.ctx.styleConfig);

    const doc = new Document({
      numbering: this.ctx.numberingConfig,
      evenAndOddHeaderAndFooters: hasEven,
      title: typeof docTitle === "string" ? docTitle : undefined,
      subject: typeof docSubject === "string" ? docSubject : undefined,
      creator: typeof docCreator === "string" ? docCreator : undefined,
      keywords: typeof docKeywords === "string" ? docKeywords : undefined,
      styles: docStyles,
      sections,
      footnotes: this.buildFootnotes(),
    });

    log("compile:doc-constructed");

    const buf = await Packer.toBuffer(doc);
    log(`compile:packed bytes=${buf.length}`);
    return buf;
  }

  private buildFootnotes(): Record<string, { children: Paragraph[] }> | undefined {
    if (!this.ctx.footnoteDefinitions || this.ctx.footnoteDefinitions.size === 0) {
      return undefined;
    }

    const footnotes: Record<string, { children: Paragraph[] }> = {};
    const bodyStyle = getBodyStyle(this.ctx.styleConfig);

    for (const [label, node] of this.ctx.footnoteDefinitions) {
      const id = this.ctx.footnoteMap.get(label);
      if (id === undefined) continue;

      const paragraphs: Paragraph[] = [];
      const visitor = new DocxNodeVisitor(this.ctx, undefined, bodyStyle);

      for (const child of node.content) {
        const results = visitor.visit(child);
        for (const res of results) {
          if (res instanceof Paragraph) {
            paragraphs.push(res);
          }
        }
      }
      
      // Ensure at least one paragraph
      if (paragraphs.length === 0) {
        paragraphs.push(new Paragraph({}));
      }

      footnotes[id.toString()] = { children: paragraphs };
    }

    return footnotes;
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

    const compileHF = (node: DocHeaderFooterNode | undefined, baseStyle: TextStyle): (Paragraph | Table)[] => {
      if (!node) return [];
      const parts: (Paragraph | Table)[] = [];
      // Use visitor for header/footer content
      // Note: Header/Footer content is usually paragraphs/tables
      // We need to pass the base style (Header/Footer style)
      // The visitor doesn't take baseStyle in constructor, but we can pass it via currentStyle
      const visitor = new DocxNodeVisitor(this.ctx, undefined, baseStyle);
      
      for (const child of node.content) {
        parts.push(...visitor.visit(child));
      }
      // Ensure at least one paragraph so Word shows the header/footer region
      if (parts.length === 0) parts.push(new Paragraph({}));
      return parts;
    };

    const headerStyle = getHeaderStyle(this.ctx.styleConfig);
    const footerStyle = getFooterStyle(this.ctx.styleConfig);

    const headers: any = {
      default: headerNodes.default ? new Header({ children: compileHF(headerNodes.default, headerStyle) }) : undefined,
      first: headerNodes.first ? new Header({ children: compileHF(headerNodes.first, headerStyle) }) : undefined,
      even: headerNodes.even ? new Header({ children: compileHF(headerNodes.even, headerStyle) }) : undefined,
    };

    const footers: any = {
      default: footerNodes.default ? new Footer({ children: compileHF(footerNodes.default, footerStyle) }) : undefined,
      first: footerNodes.first ? new Footer({ children: compileHF(footerNodes.first, footerStyle) }) : undefined,
      even: footerNodes.even ? new Footer({ children: compileHF(footerNodes.even, footerStyle) }) : undefined,
    };

    return { body: keep, headers, footers };
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
