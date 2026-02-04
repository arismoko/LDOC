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

export function parseInlineContent(text: string): InlineNode[] {
  // Simple inline parser for text that may contain {{vars}} and [[refs]]
  const nodes: InlineNode[] = [];
  let current = "";
  let i = 0;

  while (i < text.length) {
    // Variable
    if (text[i] === "{" && text[i + 1] === "{") {
      if (current) {
        nodes.push({ type: "text", line: 0, column: 0, value: current });
        current = "";
      }

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
        name: namePart,
        path: namePart.split("."),
        filters: parts.slice(1),
      });
      continue;
    }

    // Cross-reference
    if (text[i] === "[" && text[i + 1] === "[") {
      if (current) {
        nodes.push({ type: "text", line: 0, column: 0, value: current });
        current = "";
      }

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
        target: ref,
      });
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

export function tokensToInlineNodes(tokens: Token[], definedTerms: Set<string>): InlineNode[] {
  const nodes: InlineNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case TokenType.TEXT:
        nodes.push({
          type: "text",
          line: token.line,
          column: token.column,
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
          term: token.value,
          isDefinition,
        });
        break;

      case TokenType.BLANK:
        nodes.push({
          type: "blank",
          line: token.line,
          column: token.column,
          length: token.value.length,
        });
        break;

      case TokenType.BOLD:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          style: "bold",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.ITALIC:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          style: "italic",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.BOLD_ITALIC:
        nodes.push({
          type: "emphasis",
          line: token.line,
          column: token.column,
          style: "bold_italic",
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.HARD_BREAK:
        nodes.push({
          type: "hard_break",
          line: token.line,
          column: token.column,
        });
        break;

      case TokenType.LINK:
        // Value is "text|url"
        const [linkText, linkUrl] = token.value.split("|");
        nodes.push({
          type: "link",
          line: token.line,
          column: token.column,
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
          alt: imgAlt ?? "",
          src: imgSrc ?? "",
        });
        break;

      case TokenType.STRIKETHROUGH:
        nodes.push({
          type: "strikethrough",
          line: token.line,
          column: token.column,
          content: parseInlineContent(token.value),
        });
        break;

      case TokenType.INLINE_CODE:
        nodes.push({
          type: "inline_code",
          line: token.line,
          column: token.column,
          value: token.value,
        });
        break;

      case TokenType.FOOTNOTE_REF:
        nodes.push({
          type: "footnote_ref",
          line: token.line,
          column: token.column,
          label: token.value,
        });
        break;
    }
  }

  return nodes;
}
