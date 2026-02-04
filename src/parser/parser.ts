import { Lexer, TokenType, type Token } from "./lexer";
import type { Node, DocumentNode } from "./ast";
import { TokenStream } from "./token-stream";
import type { ParserContext } from "./parsers/inline";
import { parseHeader, parseParagraph, parseModifier, parsePageBreak, parseColumnBreak, parseComment, parseAnchor, parseHorizontalRule, parseBlockquote, parseFootnoteDefinition } from "./parsers/block";
import { parseNumberedItem, parseBulletItem } from "./parsers/list";
import { parseTable } from "./parsers/table";
import { parseIf, parseRepeat, parseForeach, parseSet } from "./parsers/control";
import { parseDefine, parseUse } from "./parsers/macro";
import { parseDocument, parseDocHeaderFooterWithScope, parseDocHeaderFooterDefault, parseColumnsRegion } from "./parsers/structure";

type ParserFn = (ctx: ParserContext) => Node | null;

export class Parser {
  private ctx!: ParserContext;
  private dispatchTable: Map<TokenType, ParserFn>;

  constructor() {
    this.dispatchTable = new Map<TokenType, ParserFn>([

      [TokenType.ELSE, (ctx) => {
        const token = ctx.stream.peek();
        throw new Error(`Unmatched @else at line ${token.line}, column ${token.column}`);
      }],
      [TokenType.END, (ctx) => {
        const token = ctx.stream.peek();
        throw new Error(`Unmatched @end at line ${token.line}, column ${token.column}`);
      }],
      [TokenType.DOCUMENT, (ctx) => {
        const token = ctx.stream.peek();
        throw new Error(`Misplaced @document at line ${token.line}, column ${token.column}. @document must be at the top of the file.`);
      }],
      [TokenType.META, (ctx) => {
        const token = ctx.stream.peek();
        throw new Error(`Misplaced @meta at line ${token.line}, column ${token.column}. @meta must be at the top level.`);
      }],
      [TokenType.IMPORT, (ctx) => {
        const token = ctx.stream.peek();
        throw new Error(`Misplaced @import at line ${token.line}, column ${token.column}. @import must be at the top level.`);
      }],

      // Skip tokens (advance and return null)
      [TokenType.NEWLINE, (ctx) => { ctx.stream.advance(); return null; }],
      [TokenType.INDENT, (ctx) => { ctx.stream.advance(); return null; }],
      [TokenType.DEDENT, (ctx) => { ctx.stream.advance(); return null; }],
      [TokenType.EOF, () => null],

      // Document structure
      [TokenType.DOC_FIRSTPAGE, (ctx) => parseDocHeaderFooterWithScope(ctx, "first")],
      [TokenType.DOC_EVENPAGE, (ctx) => parseDocHeaderFooterWithScope(ctx, "even")],
      [TokenType.DOC_HEADER, (ctx) => parseDocHeaderFooterDefault(ctx, "doc_header")],
      [TokenType.DOC_FOOTER, (ctx) => parseDocHeaderFooterDefault(ctx, "doc_footer")],
      [TokenType.DOC_COLUMNS, (ctx) => parseColumnsRegion(ctx)],
      [TokenType.DOC_ANCHOR, (ctx) => parseAnchor(ctx)],

      // Macros
      [TokenType.DEFINE, (ctx) => parseDefine(ctx)],
      [TokenType.USE, (ctx) => parseUse(ctx)],

      // Control flow
      [TokenType.IF, (ctx) => parseIf(ctx)],
      [TokenType.REPEAT, (ctx) => parseRepeat(ctx)],
      [TokenType.FOREACH, (ctx) => parseForeach(ctx)],
      [TokenType.SET, (ctx) => parseSet(ctx)],

      // Block elements
      [TokenType.HEADER, (ctx) => parseHeader(ctx)],
      [TokenType.NUMBERED_ITEM, (ctx) => parseNumberedItem(ctx)],
      [TokenType.BULLET, (ctx) => parseBulletItem(ctx)],
      [TokenType.MODIFIER, (ctx) => parseModifier(ctx)],
      [TokenType.TABLE, (ctx) => parseTable(ctx)],
      [TokenType.PAGEBREAK, (ctx) => parsePageBreak(ctx)],
      [TokenType.COLUMN_BREAK, (ctx) => parseColumnBreak(ctx)],
      [TokenType.HORIZONTAL_RULE, (ctx) => parseHorizontalRule(ctx)],
      [TokenType.BLOCKQUOTE, (ctx) => parseBlockquote(ctx)],
      [TokenType.FOOTNOTE_DEF, (ctx) => parseFootnoteDefinition(ctx)],

      // Comments
      [TokenType.COMMENT, (ctx) => parseComment(ctx)],
      [TokenType.TODO, (ctx) => parseComment(ctx)],
    ]);
  }

  parse(input: string | Token[], options?: { sourcePath?: string }): DocumentNode {
    const tokens = typeof input === "string" ? new Lexer(input).tokenize() : input;

    this.ctx = {
      stream: new TokenStream(tokens),
      definedTerms: new Set(),
      insideColumnsRegion: false,
      parseNode: () => this.parseNode(),
    };

    return parseDocument(this.ctx, options?.sourcePath);
  }

  private parseNode(): Node | null {
    const startPos = this.ctx.stream.getPosition();
    const token = this.ctx.stream.peek();

    // O(1) dispatch table lookup
    const handler = this.dispatchTable.get(token.type);
    const result = handler ? handler(this.ctx) : parseParagraph(this.ctx);

    // Stuck parser check
    if (this.ctx.stream.getPosition() === startPos) {
      throw new Error(
        `Parser stuck at token ${token.type} (line ${token.line}, column ${token.column}) value=${JSON.stringify(
          token.value
        )}`
      );
    }

    return result;
  }
}

// Convenience export for one-shot parsing
export function parse(input: string, options?: { sourcePath?: string }): DocumentNode {
  return new Parser().parse(input, options);
}
