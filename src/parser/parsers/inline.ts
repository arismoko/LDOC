import { TokenType, type Token } from "../lexer";
import type { InlineNode, Node, StrikethroughNode, InlineCodeNode, FootnoteReferenceNode, ImageNode } from "../ast";
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

    current += text[i];
    i++;
  }

  if (current) {
    nodes.push({ type: "text", line: 0, column: 0, value: current });
  }

  return nodes;
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
    }
  }

  return nodes;
}
