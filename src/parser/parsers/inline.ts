import { TokenType, type Token } from "../lexer";
import type { InlineNode, Node, StrikethroughNode, InlineCodeNode, FootnoteReferenceNode, ImageNode, InlineStyleNode, HighlightNode } from "../ast";
import type { TokenStream } from "../token-stream";

export interface ParserContext {
  stream: TokenStream;
  definedTerms: Set<string>;
  insideColumnsRegion: boolean;
  parseNode: () => Node | null;
}

export function parseRestOfLineRaw(ctx: ParserContext): string {
  let raw = "";
  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const t = ctx.stream.advance();
    // Preserve quotes for string-like tokens on directive lines
    if (t.type === TokenType.DEFINED_TERM) {
      raw += `"${t.value}"`;
    } else {
      raw += t.value;
    }
  }
  return raw.trim();
}

export function parseTextUntilNewline(ctx: ParserContext): string {
  let text = "";
  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.NEWLINE)) {
    const t = ctx.stream.advance();
    if (t.type === TokenType.DEFINED_TERM) {
      text += `"${t.value}"`;
    } else {
      text += t.value;
    }
  }
  return text.trim();
}

export function parseInlineContent(text: string, allowEmphasis = true): InlineNode[] {
  // Inline parser for text that may contain {{vars}}, [[refs]], and emphasis
  const nodes: InlineNode[] = [];
  let current = "";
  let i = 0;

  const flushText = () => {
    if (current) {
      nodes.push({ type: "text", line: 0, column: 0, endLine: 0, endColumn: 0, value: current });
      current = "";
    }
  };

  while (i < text.length) {
    // Variable
    if (text[i] === "{" && text[i + 1] === "{") {
      flushText();

      i += 2;
      let varName = "";
      while (i < text.length && !(text[i] === "}" && text[i + 1] === "}")) {
        varName += text[i];
        i++;
      }
      i += 2;

      const parts = varName.split("|").map((s) => s.trim());
      const namePart = (parts[0] ?? "").trim();
      if (!namePart) {
        throw new Error(`Empty variable in inline content`);
      }

      nodes.push({
        type: "variable",
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 0,
        name: namePart,
        path: namePart.split("."),
        filters: parts.slice(1),
      });
      continue;
    }

    // Cross-reference
    if (text[i] === "[" && text[i + 1] === "[") {
      flushText();

      i += 2;
      let ref = "";
      while (i < text.length && !(text[i] === "]" && text[i + 1] === "]")) {
        ref += text[i];
        i++;
      }
      i += 2;

      nodes.push({
        type: "cross_ref",
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 0,
        target: ref,
      });
      continue;
    }

    // Nested emphasis (only when allowed to prevent infinite recursion)
    if (allowEmphasis && text[i] === "*") {
      // Check for *** (bold_italic), ** (bold), or * (italic)
      let stars = 0;
      let j = i;
      while (j < text.length && text[j] === "*" && stars < 3) {
        stars++;
        j++;
      }

      if (stars >= 1) {
        const marker = "*".repeat(stars);
        // Find closing marker
        const closeIdx = text.indexOf(marker, j);
        if (closeIdx !== -1) {
          // Check it's the right closing (e.g., for **, don't match a single * inside)
          const inner = text.slice(j, closeIdx);
          // Make sure we're not matching partial markers
          const afterClose = text[closeIdx + stars];
          const isValidClose = afterClose !== "*";

          if (isValidClose && inner.length > 0) {
            flushText();

            const style = stars === 3 ? "bold_italic" : stars === 2 ? "bold" : "italic";
            nodes.push({
              type: "emphasis",
              line: 0,
              column: 0,
              endLine: 0,
              endColumn: 0,
              style,
              // Parse inner content, but disable emphasis if we're already in italic
              // to prevent **a *b* c** from infinite recursion
              content: parseInlineContent(inner, stars !== 1),
            });

            i = closeIdx + stars;
            continue;
          }
        }
      }
    }

    // Strikethrough: ~~text~~
    if (text[i] === "~" && text[i + 1] === "~") {
      const start = i + 2;
      const closeIdx = text.indexOf("~~", start);
      if (closeIdx !== -1) {
        const inner = text.slice(start, closeIdx);
        if (inner.length > 0) {
          flushText();
          nodes.push({
            type: "strikethrough",
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
            content: parseInlineContent(inner, allowEmphasis),
          });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Highlight: ==text==
    if (text[i] === "=" && text[i + 1] === "=") {
      const start = i + 2;
      const closeIdx = text.indexOf("==", start);
      if (closeIdx !== -1) {
        const inner = text.slice(start, closeIdx);
        if (inner.length > 0) {
          flushText();
          nodes.push({
            type: "highlight",
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
            color: undefined, // Default (yellow)
            content: parseInlineContent(inner, allowEmphasis),
          });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Inline code: `text` (no recursive parsing - code is literal)
    if (text[i] === "`") {
      const start = i + 1;
      const closeIdx = text.indexOf("`", start);
      if (closeIdx !== -1) {
        const inner = text.slice(start, closeIdx);
        if (inner.length > 0) {
          flushText();
          nodes.push({
            type: "inline_code",
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
            value: inner,
          });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    // Inline style: @style(attrs)[content]
    if (text.slice(i, i + 7) === "@style(") {
      flushText();
      const result = parseInlineStyleFromString(text, i);
      nodes.push(result.node);
      i = result.endIndex;
      continue;
    }

    // Inline highlight: @highlight(color)[content]
    if (text.slice(i, i + 11) === "@highlight(") {
      flushText();
      const result = parseInlineHighlightFromString(text, i);
      nodes.push(result.node);
      i = result.endIndex;
      continue;
    }

    current += text[i];
    i++;
  }

  if (current) {
    nodes.push({ type: "text", line: 0, column: 0, value: current });
  }

  return nodes;
}

function parseAttributeString(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w[\w-]*)=(?:"([^"]*)"|(\S+))/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3];
    if (key !== undefined && value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function parseInlineStyleFromString(
  text: string, 
  start: number
): { node: InlineStyleNode; endIndex: number } {
  let i = start + 7; // Skip "@style("
  
  // Parse attributes until )
  const attrStart = i;
  let parenDepth = 1;
  while (i < text.length && parenDepth > 0) {
    if (text[i] === "(") parenDepth++;
    else if (text[i] === ")") parenDepth--;
    if (parenDepth > 0) i++;
  }
  const attrStr = text.slice(attrStart, i);
  i++; // Skip )
  
  // Expect [
  if (text[i] !== "[") {
    throw new Error(`Expected '[' after @style() at position ${i}`);
  }
  i++; // Skip [
  
  // Find matching ] with balanced counting
  const contentStart = i;
  let depth = 1;
  while (depth > 0 && i < text.length) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
    if (depth > 0) i++;
  }
  
  const rawContent = text.slice(contentStart, i);
  i++; // Skip closing ]
  
  return {
    node: {
      type: "inline_style",
      line: 0, column: 0,
      endLine: 0, endColumn: 0,
      attributes: parseAttributeString(attrStr),
      content: parseInlineContent(rawContent),  // Recursive!
    } as InlineStyleNode,
    endIndex: i,
  };
}

function parseInlineHighlightFromString(
  text: string, 
  start: number
): { node: HighlightNode; endIndex: number } {
  let i = start + 11; // Skip "@highlight("
  
  // Parse color until )
  const colorStart = i;
  while (i < text.length && text[i] !== ")") {
    i++;
  }
  const color = text.slice(colorStart, i).trim() || undefined;
  i++; // Skip )
  
  // Expect [
  if (text[i] !== "[") {
    throw new Error(`Expected '[' after @highlight() at position ${i}`);
  }
  i++; // Skip [
  
  // Find matching ] with balanced counting
  const contentStart = i;
  let depth = 1;
  while (depth > 0 && i < text.length) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
    if (depth > 0) i++;
  }
  
  const rawContent = text.slice(contentStart, i);
  i++; // Skip closing ]
  
  return {
    node: {
      type: "highlight",
      line: 0, column: 0,
      endLine: 0, endColumn: 0,
      color,
      content: parseInlineContent(rawContent),  // Recursive!
    } as HighlightNode,
    endIndex: i,
  };
}

export function tokensToInlineNodes(tokens: Token[], definedTerms: Set<string>): InlineNode[] {
  const nodes: InlineNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case TokenType.TEXT:
        nodes.push({
          type: "text",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          value: token.value,
        });
        break;

      case TokenType.VARIABLE:
        const parts = token.value.split("|").map((s) => s.trim());
        const namePart = (parts[0] ?? "").trim();
        if (!namePart) {
          throw new Error(`Empty variable at line ${token.line}, column ${token.column}`);
        }
        const filters = parts.slice(1);
        const path = namePart.split(".");

        nodes.push({
          type: "variable",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          name: namePart,
          path,
          filters,
        });
        break;

      case TokenType.CROSS_REF:
        nodes.push({
          type: "cross_ref",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          target: token.value,
        });
        break;

      case TokenType.DEFINED_TERM:
        const isDefinition = !definedTerms.has(token.value);
        if (isDefinition) {
          definedTerms.add(token.value);
        }

        nodes.push({
          type: "defined_term",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          term: token.value,
          isDefinition,
        });
        break;

      case TokenType.BLANK:
        nodes.push({
          type: "blank",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          length: token.value.length,
        });
        break;

      case TokenType.BOLD:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          style: "bold",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.ITALIC:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          style: "italic",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.BOLD_ITALIC:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          style: "bold_italic",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.HARD_BREAK:
        nodes.push({
          type: "hard_break",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
        });
        break;

      case TokenType.LINK:
        // Value is "text|url"
        const [linkText, linkUrl] = token.value.split("|");
        nodes.push({
          type: "link",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          text: linkText ?? "",
          url: linkUrl ?? "",
        });
        break;

      case TokenType.IMAGE:
        // Value is "alt|src"
        const [imgAlt, imgSrc] = token.value.split("|");
        nodes.push({
          type: "image",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          alt: imgAlt ?? "",
          src: imgSrc ?? "",
        });
        break;

      case TokenType.STRIKETHROUGH:
        nodes.push({
          type: "strikethrough",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.HIGHLIGHT:
        nodes.push({
          type: "highlight",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          color: undefined, // Default (yellow) for == syntax
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.INLINE_CODE:
        nodes.push({
          type: "inline_code",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          value: token.value,
        });
        break;

      case TokenType.FOOTNOTE_REF:
        nodes.push({
          type: "footnote_ref",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          label: token.value,
        });
        break;

      case TokenType.INLINE_STYLE:
        // Parse the rawContent as inline nodes (recursive)
        const innerContent = parseInlineContent(token.rawContent ?? "");
        nodes.push({
          type: "inline_style",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          attributes: token.attributes ?? {},
          content: innerContent,
        } as InlineStyleNode);
        break;

      case TokenType.INLINE_HIGHLIGHT:
        // Parse the rawContent as inline nodes (recursive)
        const highlightContent = parseInlineContent(token.rawContent ?? "");
        nodes.push({
          type: "highlight",
          line: token.line,
          column: token.column,
          endLine: token.endLine,
          endColumn: token.endColumn,
          color: token.attributes?.color,
          content: highlightContent,
        } as HighlightNode);
        break;
    }
  }

  return nodes;
}
