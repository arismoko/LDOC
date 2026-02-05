// Bookmark Manager: anchor indexing and wrapping helpers

import { Bookmark, Paragraph, TextRun } from "docx";
import type { IParagraphOptions } from "docx";

import type {
  Node,
  DocumentNode,
  AnchorNode,
  InlineNode,
  NumberingStyle,
} from "../parser/ast";

import { bookmarkSafeName, normalizeRefKey } from "../shared/bookmark-utils";
import { numberingLabel } from "./numbering";
import type { TextStyle } from "./styles";

/**
 * Manages bookmark state (key->name mappings) and provides
 * indexing + wrapping utilities for cross-references.
 */
export class BookmarkManager {
  private bookmarkByKey: Map<string, string> = new Map();
  private bookmarkNames: Set<string> = new Set();

  /** Clear all bookmark state. Call before each compile. */
  reset(): void {
    this.bookmarkByKey = new Map();
    this.bookmarkNames = new Set();
  }

  /** Number of registered bookmark keys. */
  get size(): number {
    return this.bookmarkByKey.size;
  }

  /** Get the bookmark name for a normalized key. */
  getBookmark(key: string): string | undefined {
    return this.bookmarkByKey.get(normalizeRefKey(key));
  }

  /**
   * Resolve a raw cross-reference target to a bookmark name.
   * Tries scoped lookup first if scope is provided.
   */
  resolveAnchor(raw: string, scope?: string): string | undefined {
    const trimmed = raw.trim();

    // If already qualified (Label.foo), don't auto-scope
    const isQualified = trimmed.includes(".");

    const tryKey = (label: string) => this.bookmarkByKey.get(normalizeRefKey(label));

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

  /**
   * Register an anchor with fallback name generation.
   * Silently skips if key already registered.
   */
  registerAnchor(labelForLookup: string, labelForName: string): void {
    const key = normalizeRefKey(labelForLookup);
    if (!key) return;
    if (this.bookmarkByKey.has(key)) return;

    const base = bookmarkSafeName(labelForName);
    let name = base;
    let i = 2;
    while (this.bookmarkNames.has(name)) {
      name = `${base}_${i++}`;
      if (name.length > 40) name = name.slice(0, 40);
    }
    this.bookmarkNames.add(name);
    this.bookmarkByKey.set(key, name);
  }

  /**
   * Index all anchors in the AST before compilation.
   * Requires an inlineTextFn callback to extract text from inline nodes.
   */
  indexAnchors(ast: DocumentNode, inlineTextFn: (nodes: InlineNode[]) => string): void {
    const duplicate: string[] = [];

    const define = (
      lookup: string,
      bookmarkName: string,
      source?: { line: number; column: number },
      scope?: string
    ): void => {
      const scopedLookup = scope && !lookup.includes(".") ? `${scope}.${lookup}` : lookup;
      const key = normalizeRefKey(scopedLookup);
      if (!key) return;
      const existing = this.bookmarkByKey.get(key);
      if (existing && existing !== bookmarkName) {
        duplicate.push(source ? `${lookup} (line ${source.line}, col ${source.column})` : lookup);
        return;
      }
      this.bookmarkByKey.set(key, bookmarkName);
    };

    const newBookmarkName = (label: string): string => {
      const base = bookmarkSafeName(label);
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
          const key = normalizeRefKey(a.name.trim());
          const existing = this.bookmarkByKey.get(key);
          if (existing) return existing;
        }
        return newBookmarkName(pendingAnchors[0]!.name.trim());
      };

      for (const node of nodes) {
        if (node.type === "anchor") {
          pendingAnchors.push(node as AnchorNode);
          continue;
        }

        // Do not attach anchors to non-renderables (blank lines, comments, layout directives, etc.)
        if (!isAnchorRenderable(node)) {
          continue;
        }

        switch (node.type) {
          case "header": {
            const text = inlineTextFn(node.content);
            const bookmark = newBookmarkName(text);
            const scope = (node as any).scope as string | undefined;
            define(text, bookmark, undefined, scope);
            attachPending(bookmark, scope);
            break;
          }
          case "numbered_item": {
            const label = numberingLabel(node.style);
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
              const text = inlineTextFn(node.content);
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

  /**
   * Wrap children with nested Bookmark elements for the given IDs.
   * Returns the wrapped children array (or original if no bookmarks).
   */
  wrapWithBookmarks(children: any[], bookmarkIds: string[] | undefined): any[] {
    if (!bookmarkIds || bookmarkIds.length === 0) return children;
    let wrapped = children;
    for (let i = bookmarkIds.length - 1; i >= 0; i--) {
      wrapped = [new Bookmark({ id: bookmarkIds[i]!, children: wrapped })];
    }
    return wrapped;
  }

  /**
   * Create an empty paragraph wrapped with bookmarks.
   * Used for attaching anchors to non-content nodes.
   */
  makeBookmarkParagraph(
    bookmarkIds: string[],
    indentLeftTwip?: number,
    applySpacing?: (opts: IParagraphOptions) => void
  ): Paragraph {
    let children: any[] = [new TextRun({ text: "" })];
    for (let i = bookmarkIds.length - 1; i >= 0; i--) {
      children = [new Bookmark({ id: bookmarkIds[i]!, children })];
    }
    const options: IParagraphOptions = {
      children,
      indent: indentLeftTwip ? { left: indentLeftTwip } : undefined,
    };
    if (applySpacing) applySpacing(options);
    return new Paragraph(options);
  }
}
