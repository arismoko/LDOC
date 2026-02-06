/**
 * LDOC Parser
 * 
 * Converts tokens to CST (Concrete Syntax Tree).
 * Uses recursive descent parsing.
 */

import { TokenType, type Token } from "../types/tokens.ts";
import type {
  CSTDocument,
  CSTNode,
  CSTDirective,
  CSTArgument,
  CSTValue,
  CSTParagraph,
  CSTHeader,
  CSTList,
  CSTListItem,
  CSTBlockquote,
  CSTHorizontalRule,
  CSTBlankLine,
  CSTInline,
  CSTText,
  CSTVariable,
  CSTEmphasis,
  CSTHardBreak,
  CSTFootnoteRef,
  CSTCrossRef,
  CSTLink,
  CSTImage,
  CSTDefinedTerm,
  CSTBlank,
  CSTFootnoteDef,
  CSTInlineDirective,
  ParseResult,
  CSTPositionalArg,
  CSTNamedArg,
  CSTStringLiteral,
  CSTNumberLiteral,
  CSTIdentifier,
  CSTExpression,
  CSTError,
  ErrorContext,
  IncompleteMarker,
} from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, DiagnosticCode } from "../types/diagnostics.ts";
import { loc, span } from "../types/source-location.ts";
import { ErrorRecovery } from "./recovery.ts";

/**
 * Create an IncompleteMarker for a missing delimiter.
 * DRY helper to avoid repeating the same structure.
 * 
 * @param expected - The delimiter that was expected (e.g., ")", "}}", "]")
 */
function missingDelimiter(expected: string): IncompleteMarker {
  return {
    incomplete: true,
    missing: [{ kind: "token", expected }],
  };
}

/**
 * Create an IncompleteMarker for a missing directive body.
 * DRY helper for Phase 4 body recovery.
 * 
 * @param directive - The directive name that requires a body (e.g., "if", "foreach")
 */
function missingBody(directive: string): IncompleteMarker {
  return {
    incomplete: true,
    missing: [{ kind: "body", directive }],
  };
}

/**
 * Mapping from emphasis kind to expected closing delimiter.
 * Used for error messages in inline recovery.
 */
const EMPHASIS_DELIMITERS: Record<string, string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  highlight: "==",
  code: "`",
};

/**
 * Create an IncompleteMarker for an unclosed inline formatter.
 * DRY helper for Phase 5 inline recovery.
 * 
 * @param kind - The emphasis kind (bold, italic, etc.)
 */
function missingFormatter(kind: string): IncompleteMarker {
  const delimiter = EMPHASIS_DELIMITERS[kind] ?? kind;
  return {
    incomplete: true,
    missing: [{ kind: "token", expected: delimiter }],
  };
}

/**
 * Directives that require an indented body block.
 * 
 * Used for error recovery: if body is missing, parser adds an
 * `incomplete` marker to the CST node for LSP completions.
 * 
 * ## Difference from OPAQUE_BODY_DIRECTIVES:
 * 
 * - `DIRECTIVES_REQUIRING_BODY`: Body is required, parsed as normal CST nodes
 * - `OPAQUE_BODY_DIRECTIVES`: Body is optional, captured as raw text
 * 
 * A directive can be in both sets (though currently none are).
 * 
 * @see Parser.OPAQUE_BODY_DIRECTIVES - For YAML-style config bodies
 */
const DIRECTIVES_REQUIRING_BODY = new Set([
  "if",
  "elseif",
  "else",
  "foreach",
  "repeat",
  "define",
  "style",
]);

/**
 * Check if a directive requires a body.
 * Used to emit incomplete markers when body is missing.
 */
function directiveRequiresBody(name: string): boolean {
  return DIRECTIVES_REQUIRING_BODY.has(name);
}

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private diagnostics: Diagnostic[] = [];
  private recovery: ErrorRecovery;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.recovery = new ErrorRecovery(tokens, 0);
  }

  parse(): ParseResult {
    const children: CSTNode[] = [];

    while (!this.isAtEnd()) {
      const node = this.parseNodeSafe();
      if (node) {
        children.push(node);
      }
    }

    const cst: CSTDocument = {
      type: "Document",
      children,
      loc: children.length > 0
        ? span(children[0]!.loc, children[children.length - 1]!.loc)
        : loc(1, 0),
    };

    return { cst, diagnostics: this.diagnostics };
  }

  /**
   * Parse a node with error recovery.
   * Catches exceptions and produces CSTError nodes instead of crashing.
   */
  private parseNodeSafe(): CSTNode | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    const startToken = this.peek();
    const startPos = this.pos;

    try {
      return this.parseNode();
    } catch (e) {
      // Create error diagnostic
      const message = e instanceof Error ? e.message : "Unexpected error";
      this.diagnostics.push(
        error(DiagnosticCode.PARSE_ERROR, message, this.currentLoc())
      );

      // Synchronize and wrap skipped tokens in error node
      const skipped = this.synchronize();

      if (skipped.length === 0) {
        // If we didn't move, advance at least one token to avoid infinite loop
        if (this.pos === startPos && !this.isAtEnd()) {
          this.advance();
        }
        return null;
      }

      const lastToken = skipped[skipped.length - 1]!;
      return {
        type: "Error",
        message,
        context: this.inferErrorContext(startToken),
        tokens: skipped,
        loc: span(
          loc(startToken.line, startToken.column),
          loc(lastToken.line, lastToken.column, lastToken.endLine, lastToken.endColumn)
        ),
      } as CSTError;
    }
  }

  /**
   * Synchronize to next safe parse point.
   * Called after encountering an error.
   * Returns the tokens that were skipped.
   */
  private synchronize(): Token[] {
    this.recovery.updatePosition(this.pos);
    const { syncIndex, skipped } = this.recovery.findNextSync(this.pos);
    this.pos = syncIndex;
    return skipped;
  }

  /**
   * Infer error context from starting token.
   * Used for categorizing errors and potential recovery hints.
   */
  private inferErrorContext(token: Token): ErrorContext {
    switch (token.type) {
      case TokenType.DIRECTIVE:
        return "directive";
      case TokenType.VARIABLE:
        return "interpolation";
      case TokenType.HEADER_MARKER:
      case TokenType.BULLET:
      case TokenType.NUMBERED_ITEM:
      case TokenType.BLOCKQUOTE:
        return "block";
      case TokenType.BOLD_MARKER:
      case TokenType.ITALIC_MARKER:
      case TokenType.STRIKE_MARKER:
      case TokenType.HIGHLIGHT_MARKER:
      case TokenType.CODE_MARKER:
      case TokenType.TEXT:
        return "inline";
      default:
        return "unknown";
    }
  }

  /**
   * Get the current location for diagnostics.
   */
  private currentLoc() {
    const token = this.peek();
    return loc(token.line, token.column, token.endLine, token.endColumn);
  }

  private parseNode(): CSTNode | null {
    this.skipNewlines();
    if (this.isAtEnd()) return null;

    const token = this.peek();

    switch (token.type) {
      case TokenType.DIRECTIVE:
        return this.parseDirective();

      case TokenType.HEADER_MARKER:
        return this.parseHeader();

      case TokenType.BULLET:
        return this.parseBulletList();

      case TokenType.NUMBERED_ITEM:
        return this.parseNumberedItemList();

      case TokenType.BLOCKQUOTE:
        return this.parseBlockquote();

      case TokenType.HORIZONTAL_RULE:
        return this.parseHorizontalRule();

      case TokenType.INDENT:
        // Skip stray indents at top level
        this.advance();
        return null;

      case TokenType.DEDENT:
        // Skip stray dedents at top level (orphaned indentation)
        this.advance();
        return null;

      case TokenType.COMMENT:
        // Skip comments
        this.advance();
        return null;

      case TokenType.FOOTNOTE_DEF:
        return this.parseFootnoteDef();

      default:
        return this.parseParagraph();
    }
  }

  // ===========================================================================
  // Directives
  // ===========================================================================

  /**
   * Directives with YAML-like opaque bodies (configuration, not content).
   * 
   * These are parsed specially - the indented body is captured as raw text
   * in `opaqueBody` rather than parsed as CST nodes. This is because:
   * 
   * 1. The body contains key-value configuration, not LDOC content
   * 2. The syntax uses `key: value` which conflicts with LDOC parsing
   * 3. The evaluator (not parser) handles interpretation
   * 
   * ## When to add a directive here:
   * 
   * Add if the directive's body is **configuration data**, not content to render.
   * 
   * ✅ Add: `@document` (page settings), `@meta` (variables)
   * ❌ Don't add: `@define` (body is LDOC to render), `@style` (wraps content)
   * 
   * ## Adding a new opaque-body directive:
   * 
   * 1. Add the directive name to this set
   * 2. Create a parser in `src/evaluate/` (like `document-config.ts`)
   * 3. Handle in evaluator's directive processing
   * 
   * @see parseOpaqueBody - The method that captures raw body text
   * @see src/evaluate/document-config.ts - Example opaque body parser
   */
  private static readonly OPAQUE_BODY_DIRECTIVES = new Set(["document", "meta"]);

  private parseDirective(): CSTDirective {
    const token = this.advance(); // DIRECTIVE token
    const startLoc = loc(token.line, token.column);
    
    const name = token.value;
    const { args, incomplete: argsIncomplete } = this.parseArgumentsWithRecovery();
    
    // Check for body (indented block)
    let body: CSTNode[] | null = null;
    let opaqueBody: string | undefined;
    let bodyIncomplete: IncompleteMarker | undefined;
    this.skipNewlines();
    
    if (this.check(TokenType.INDENT)) {
      // Check if this is an opaque-body directive
      if (Parser.OPAQUE_BODY_DIRECTIVES.has(name)) {
        opaqueBody = this.parseOpaqueBody();
      } else {
        this.advance(); // consume INDENT
        body = [];
        
        while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
          // Use parseNodeSafe for error recovery in body
          const node = this.parseNodeSafe();
          if (node) {
            body.push(node);
          }
          this.skipNewlines();
        }
        
        if (this.check(TokenType.DEDENT)) {
          this.advance();
        }
      }
    } else if (directiveRequiresBody(name)) {
      // No body present but directive requires one
      bodyIncomplete = missingBody(name);
    }

    const endLoc = this.previous();
    
    const directive: CSTDirective = {
      type: "Directive",
      name,
      arguments: args,
      body,
      loc: span(startLoc, loc(endLoc.line, endLoc.column, endLoc.endLine, endLoc.endColumn)),
    };

    // Add opaque body if present
    if (opaqueBody !== undefined) {
      directive.opaqueBody = opaqueBody;
    }

    // Add incomplete marker if arguments were unclosed or body is missing
    // Prefer argument incompleteness over body incompleteness
    if (argsIncomplete) {
      directive.incomplete = argsIncomplete;
    } else if (bodyIncomplete) {
      directive.incomplete = bodyIncomplete;
    }

    return directive;
  }

  /**
   * Parse an opaque body for @document/@meta directives.
   * 
   * Consumes all indented content as raw text, handling nested indentation
   * properly. Returns the raw text with leading whitespace preserved.
   */
  private parseOpaqueBody(): string {
    const lines: string[] = [];
    let baseIndent = 0;
    let indentDepth = 0;
    
    // Consume the initial INDENT
    if (this.check(TokenType.INDENT)) {
      this.advance();
      indentDepth = 1;
      // Get the column of the next token to determine base indent
      const nextToken = this.peek();
      baseIndent = nextToken.column;
    }
    
    let currentLine = "";
    
    while (!this.isAtEnd() && indentDepth > 0) {
      const tok = this.peek();
      
      if (tok.type === TokenType.INDENT) {
        this.advance();
        indentDepth++;
      } else if (tok.type === TokenType.DEDENT) {
        this.advance();
        indentDepth--;
        if (indentDepth <= 0) {
          // We've exited the opaque body
          break;
        }
      } else if (tok.type === TokenType.NEWLINE) {
        // Save current line and start new one
        if (currentLine) {
          lines.push(currentLine);
        } else if (lines.length > 0) {
          // Preserve blank lines within the body
          lines.push("");
        }
        currentLine = "";
        this.advance();
      } else {
        // TEXT or other content - preserve with proper indentation
        // Calculate relative indent from base
        const relativeIndent = tok.column - baseIndent;
        const indent = relativeIndent > 0 ? "  ".repeat(Math.floor(relativeIndent / 2)) : "";
        currentLine = indent + tok.value;
        this.advance();
      }
    }
    
    // Don't forget the last line
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines.join("\n");
  }

  /**
   * Parse directive arguments with error recovery.
   * Returns partial args if closing paren is missing.
   */
  private parseArgumentsWithRecovery(): { 
    args: CSTArgument[]; 
    incomplete?: IncompleteMarker;
  } {
    const args: CSTArgument[] = [];

    if (!this.check(TokenType.LPAREN)) {
      return { args };
    }

    const openParen = this.advance(); // (

    while (!this.isAtEnd()) {
      // Success case: found closing paren
      if (this.check(TokenType.RPAREN)) {
        this.advance();
        return { args };
      }

      // Error case: hit boundary without closing paren
      if (this.recovery.isBoundary(this.peek())) {
        this.diagnostics.push(
          error(
            DiagnosticCode.UNCLOSED_DELIMITER,
            "Missing closing ')'",
            loc(openParen.line, openParen.column)
          )
        );
        return { args, incomplete: missingDelimiter(")") };
      }

      // Parse argument
      const arg = this.parseArgument();
      if (arg) {
        args.push(arg);
      }

      // Consume comma or break
      if (this.check(TokenType.COMMA)) {
        this.advance();
      } else if (!this.check(TokenType.RPAREN)) {
        // Not a comma and not closing paren - check if it's a boundary
        if (this.recovery.isBoundary(this.peek())) {
          this.diagnostics.push(
            error(
              DiagnosticCode.UNCLOSED_DELIMITER,
              "Missing closing ')'",
              loc(openParen.line, openParen.column)
            )
          );
          return { args, incomplete: missingDelimiter(")") };
        }
        // Unexpected token - skip it to avoid infinite loop
        this.advance();
      }
    }

    // EOF without closing
    this.diagnostics.push(
      error(
        DiagnosticCode.UNCLOSED_DELIMITER,
        "Missing closing ')' - unexpected end of input",
        loc(openParen.line, openParen.column)
      )
    );
    return { args, incomplete: missingDelimiter(")") };
  }

  /**
   * Original parseArguments - kept for backward compatibility.
   * Delegates to parseArgumentsWithRecovery.
   */
  private parseArguments(): CSTArgument[] {
    return this.parseArgumentsWithRecovery().args;
  }

  private parseArgument(): CSTArgument | null {
    const token = this.peek();
    const startLoc = loc(token.line, token.column);

    // Check for named argument: name: value or name = value
    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.TEXT)) {
      const nameToken = this.advance();
      
      if (this.check(TokenType.COLON) || this.check(TokenType.EQUALS)) {
        this.advance(); // : or =
        const value = this.parseValue();
        if (value) {
          return {
            type: "NamedArg",
            name: nameToken.value.trim(),
            value,
            loc: span(startLoc, value.loc),
          } as CSTNamedArg;
        }
      } else {
        // Positional - the name token IS the value
        return {
          type: "PositionalArg",
          value: {
            type: "Identifier",
            name: nameToken.value.trim(),
            loc: loc(nameToken.line, nameToken.column),
          } as CSTIdentifier,
          loc: startLoc,
        } as CSTPositionalArg;
      }
    }

    // Positional argument
    const value = this.parseValue();
    if (value) {
      return {
        type: "PositionalArg",
        value,
        loc: value.loc,
      } as CSTPositionalArg;
    }

    return null;
  }

  private parseValue(): CSTValue | null {
    const token = this.peek();

    if (this.check(TokenType.STRING)) {
      this.advance();
      return {
        type: "StringLiteral",
        value: token.value,
        raw: `"${token.value}"`,
        loc: loc(token.line, token.column),
      } as CSTStringLiteral;
    }

    if (this.check(TokenType.NUMBER)) {
      this.advance();
      return {
        type: "NumberLiteral",
        value: parseFloat(token.value),
        raw: token.value,
        loc: loc(token.line, token.column),
      } as CSTNumberLiteral;
    }

    if (this.check(TokenType.BOOLEAN)) {
      this.advance();
      return {
        type: "BooleanLiteral",
        value: token.value === "true",
        loc: loc(token.line, token.column),
      };
    }

    if (this.check(TokenType.VARIABLE)) {
      this.advance();
      return {
        type: "Expression",
        raw: token.value,
        loc: loc(token.line, token.column),
      } as CSTExpression;
    }

    if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.TEXT)) {
      this.advance();
      return {
        type: "Identifier",
        name: token.value.trim(),
        loc: loc(token.line, token.column),
      } as CSTIdentifier;
    }

    return null;
  }

  // ===========================================================================
  // Block Elements
  // ===========================================================================

  private parseHeader(): CSTHeader {
    const marker = this.advance(); // HEADER_MARKER
    const level = marker.value.length as 1 | 2 | 3 | 4 | 5 | 6;
    
    const content = this.parseInlineContent();
    
    return {
      type: "Header",
      level,
      content,
      loc: span(
        loc(marker.line, marker.column),
        content.length > 0 
          ? content[content.length - 1]!.loc 
          : loc(marker.line, marker.column)
      ),
    };
  }

  private parseBulletList(): CSTList {
    const items: CSTListItem[] = [];
    const firstToken = this.peek();
    const startLoc = loc(firstToken.line, firstToken.column);

    while (!this.isAtEnd() && this.check(TokenType.BULLET)) {
      items.push(this.parseBulletItem());
      this.skipNewlines();
    }

    return {
      type: "List",
      ordered: false,
      items,
      loc: span(
        startLoc,
        items.length > 0 ? items[items.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseBulletItem(): CSTListItem {
    const marker = this.advance(); // BULLET
    const startLoc = loc(marker.line, marker.column);
    
    const content = this.parseInlineContent();
    const children: CSTNode[] = [];

    // Check for nested content
    this.skipNewlines();
    if (this.check(TokenType.INDENT)) {
      this.advance();
      
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        // Use parseNodeSafe for error recovery in nested content
        const node = this.parseNodeSafe();
        if (node) {
          children.push(node);
        }
        this.skipNewlines();
      }
      
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "ListItem",
      marker: marker.value,
      content,
      children,
      loc: span(
        startLoc,
        children.length > 0 
          ? children[children.length - 1]!.loc
          : content.length > 0 
            ? content[content.length - 1]!.loc 
            : startLoc
      ),
    };
  }

  /**
   * Parse a numbered item list using @@ syntax.
   * NUMBERED_ITEM tokens have value "level|style" (e.g., "2|a" for @@a)
   */
  private parseNumberedItemList(): CSTList {
    const items: CSTListItem[] = [];
    const firstToken = this.peek();
    const startLoc = loc(firstToken.line, firstToken.column);

    while (!this.isAtEnd() && this.check(TokenType.NUMBERED_ITEM)) {
      const marker = this.advance();
      const itemLoc = loc(marker.line, marker.column);
      
      const content = this.parseInlineContent();
      const children: CSTNode[] = [];

      // Check for nested content
      this.skipNewlines();
      if (this.check(TokenType.INDENT)) {
        this.advance();
        
        while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
          // Use parseNodeSafe for error recovery in nested content
          const node = this.parseNodeSafe();
          if (node) {
            children.push(node);
          }
          this.skipNewlines();
        }
        
        if (this.check(TokenType.DEDENT)) {
          this.advance();
        }
      }

      items.push({
        type: "ListItem",
        marker: marker.value, // "level|style" encoded
        content,
        children,
        loc: span(
          itemLoc,
          children.length > 0 
            ? children[children.length - 1]!.loc
            : content.length > 0 
              ? content[content.length - 1]!.loc 
              : itemLoc
        ),
      });
      
      this.skipNewlines();
    }

    return {
      type: "List",
      ordered: true, // NUMBERED_ITEM is always ordered
      items,
      loc: span(
        startLoc,
        items.length > 0 ? items[items.length - 1]!.loc : startLoc
      ),
    };
  }

  /**
   * Parse a footnote definition [^label]: content
   */
  private parseFootnoteDef(): CSTFootnoteDef {
    const token = this.advance(); // FOOTNOTE_DEF
    const startLoc = loc(token.line, token.column);
    
    const content: CSTNode[] = [];
    
    // Parse inline content on same line
    const para = this.parseParagraph();
    if (para && para.content.length > 0) {
      content.push(para);
    }
    
    // Check for continued content (indented block)
    this.skipNewlines();
    if (this.check(TokenType.INDENT)) {
      this.advance();
      
      while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
        // Use parseNodeSafe for error recovery in footnote content
        const node = this.parseNodeSafe();
        if (node) {
          content.push(node);
        }
        this.skipNewlines();
      }
      
      if (this.check(TokenType.DEDENT)) {
        this.advance();
      }
    }

    return {
      type: "FootnoteDef",
      label: token.value,
      content,
      loc: span(
        startLoc,
        content.length > 0 ? content[content.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseBlockquote(): CSTBlockquote {
    const token = this.advance(); // BLOCKQUOTE
    const startLoc = loc(token.line, token.column);
    
    // Parse the rest of the line as content
    const content: CSTNode[] = [];
    const paragraph = this.parseParagraph();
    if (paragraph && paragraph.content.length > 0) {
      content.push(paragraph);
    }

    return {
      type: "Blockquote",
      content,
      loc: span(
        startLoc,
        content.length > 0 ? content[content.length - 1]!.loc : startLoc
      ),
    };
  }

  private parseHorizontalRule(): CSTHorizontalRule {
    const token = this.advance();
    return {
      type: "HorizontalRule",
      loc: loc(token.line, token.column, token.endLine, token.endColumn),
    };
  }

  private parseParagraph(): CSTParagraph {
    const content = this.parseInlineContent();
    
    if (content.length === 0) {
      const token = this.peek();
      return {
        type: "Paragraph",
        content: [],
        loc: loc(token.line, token.column),
      };
    }

    return {
      type: "Paragraph",
      content,
      loc: span(content[0]!.loc, content[content.length - 1]!.loc),
    };
  }

  // ===========================================================================
  // Inline Content
  // ===========================================================================

  private parseInlineContent(): CSTInline[] {
    const inlines: CSTInline[] = [];

    while (!this.isAtEnd() && !this.isBlockEnd()) {
      const inline = this.parseInline();
      if (inline) {
        inlines.push(inline);
      }
    }

    return inlines;
  }

  private parseInline(): CSTInline | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.TEXT:
        this.advance();
        return {
          type: "Text",
          value: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTText;

      case TokenType.VARIABLE:
        this.advance();
        const variable: CSTVariable = {
          type: "Variable",
          expression: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        };
        // Propagate incomplete marker from token
        if (token.incomplete) {
          variable.incomplete = missingDelimiter("}}");
        }
        return variable;

      case TokenType.BOLD_MARKER:
        return this.parseEmphasis("bold");

      case TokenType.ITALIC_MARKER:
        return this.parseEmphasis("italic");

      case TokenType.STRIKE_MARKER:
        return this.parseEmphasis("strikethrough");

      case TokenType.HIGHLIGHT_MARKER:
        return this.parseEmphasis("highlight");

      case TokenType.CODE_MARKER:
        this.advance();
        return {
          type: "Emphasis",
          kind: "code",
          content: [{ type: "Text", value: token.value, loc: loc(token.line, token.column, token.endLine, token.endColumn) } as CSTText],
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTEmphasis;

      case TokenType.HARD_BREAK:
        this.advance();
        return {
          type: "HardBreak",
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTHardBreak;

      case TokenType.FOOTNOTE_REF:
        this.advance();
        const footnoteRef: CSTFootnoteRef = {
          type: "FootnoteRef",
          label: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        };
        // Propagate incomplete marker from token
        if (token.incomplete) {
          footnoteRef.incomplete = missingDelimiter("]");
        }
        return footnoteRef;

      case TokenType.CROSS_REF:
        this.advance();
        return {
          type: "CrossRef",
          target: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTCrossRef;

      case TokenType.LINK: {
        this.advance();
        // Value is "text|url"
        const pipeIdx = token.value.indexOf("|");
        const text = pipeIdx >= 0 ? token.value.slice(0, pipeIdx) : token.value;
        const url = pipeIdx >= 0 ? token.value.slice(pipeIdx + 1) : "";
        const link: CSTLink = {
          type: "Link",
          text: [{ type: "Text", value: text, loc: loc(token.line, token.column, token.endLine, token.endColumn) } as CSTText],
          url,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        };
        // Propagate incomplete marker from token
        if (token.incomplete) {
          link.incomplete = missingDelimiter(")");
        }
        return link;
      }

      case TokenType.IMAGE: {
        this.advance();
        // Value is "alt|src"
        const pipeIdx = token.value.indexOf("|");
        const alt = pipeIdx >= 0 ? token.value.slice(0, pipeIdx) : token.value;
        const src = pipeIdx >= 0 ? token.value.slice(pipeIdx + 1) : "";
        return {
          type: "Image",
          alt,
          src,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTImage;
      }

      case TokenType.DIRECTIVE:
        // Inline directive
        return this.parseInlineDirective();

      case TokenType.STRING:
        // In inline context, STRING is a defined term
        this.advance();
        return {
          type: "DefinedTerm",
          term: token.value,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTDefinedTerm;

      case TokenType.BLANK:
        this.advance();
        return {
          type: "Blank",
          width: token.value.length,
          loc: loc(token.line, token.column, token.endLine, token.endColumn),
        } as CSTBlank;

      default:
        // Skip unknown inline tokens
        this.advance();
        return null;
    }
  }

  private parseEmphasis(kind: CSTEmphasis["kind"]): CSTEmphasis {
    const start = this.advance(); // opening marker
    const content: CSTInline[] = [];
    const startLoc = loc(start.line, start.column);
    let foundClosing = false;

    // Parse until matching close or end of line
    while (!this.isAtEnd() && !this.isBlockEnd()) {
      const token = this.peek();
      
      // Check for closing marker
      if (
        (kind === "bold" && token.type === TokenType.BOLD_MARKER) ||
        (kind === "italic" && token.type === TokenType.ITALIC_MARKER) ||
        (kind === "strikethrough" && token.type === TokenType.STRIKE_MARKER) ||
        (kind === "highlight" && token.type === TokenType.HIGHLIGHT_MARKER)
      ) {
        this.advance(); // consume closing marker
        foundClosing = true;
        break;
      }

      const inline = this.parseInline();
      if (inline) {
        content.push(inline);
      }
    }

    const emphasis: CSTEmphasis = {
      type: "Emphasis",
      kind,
      content,
      loc: span(startLoc, content.length > 0 ? content[content.length - 1]!.loc : startLoc),
    };

    // Mark as incomplete if closing marker was not found
    if (!foundClosing) {
      emphasis.incomplete = missingFormatter(kind);
    }

    return emphasis;
  }

  private parseInlineDirective(): CSTInline | null {
    const startToken = this.peek();
    const startLoc = loc(startToken.line, startToken.column);
    
    // Consume the DIRECTIVE token
    this.advance();
    const name = startToken.value;
    
    // Parse optional arguments (...)
    const { args } = this.parseArgumentsWithRecovery();
    
    // Handle special directives
    if (name === "br") {
      return { type: "HardBreak", loc: startLoc } as CSTHardBreak;
    }
    if (name === "tab") {
      return { type: "Tab", loc: startLoc };
    }
    
    // Check for bracket content: @name(args)[content]
    const content: CSTInline[] = [];
    if (!this.isAtEnd() && this.peek().type === TokenType.TEXT && this.peek().value === "[") {
      this.advance(); // consume "["
      // Parse inline content until we hit "]"
      while (!this.isAtEnd() && !this.isBlockEnd()) {
        const tok = this.peek();
        if (tok.type === TokenType.TEXT && tok.value === "]") {
          this.advance(); // consume "]"
          break;
        }
        const inline = this.parseInline();
        if (inline) {
          content.push(inline);
        }
      }
    }
    
    const endTok = this.previous();
    
    return {
      type: "InlineDirective",
      name,
      arguments: args,
      content,
      loc: span(startLoc, loc(endTok.line, endTok.column, endTok.endLine, endTok.endColumn)),
    } as CSTInlineDirective;
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!;
    }
    return this.tokens[idx]!;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.pos - 1)]!;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private isBlockEnd(): boolean {
    const type = this.peek().type;
    return (
      type === TokenType.NEWLINE ||
      type === TokenType.EOF ||
      type === TokenType.DEDENT ||
      type === TokenType.INDENT
    );
  }
}

/**
 * Parse LDOC tokens into CST.
 */
export function parse(tokens: Token[]): ParseResult {
  return new Parser(tokens).parse();
}
