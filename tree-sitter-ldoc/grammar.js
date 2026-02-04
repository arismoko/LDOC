// Tree-sitter grammar for Legal Document DSL (.ldoc)
// Provides Neovim/Helix syntax highlighting
//
// Design decisions:
// 1. @document/@meta use "opaque block" pattern - indented content isn't parsed
//    internally, just captured as indented_line nodes for highlighting via queries
// 2. Control flow blocks (@if, @define, @foreach, etc.) require @end terminator
// 3. No external scanner - avoids maintenance burden of tracking indentation state

module.exports = grammar({
  name: "ldoc",

  extras: ($) => [/[ \t]/],

  conflicts: ($) => [
    [$.modifier_line],
    [$.paragraph],
    [$.table_block],
  ],

  rules: {
    source_file: ($) => repeat($._statement),

    _statement: ($) =>
      choice(
        $.document_block,
        $.meta_block,
        $.import_directive,
        $.define_block,
        $.use_directive,
        $.if_block,
        $.repeat_block,
        $.foreach_block,
        $.set_directive,
        $.header,
        $.numbered_item,
        $.bullet_item,
        $.modifier_line,
        $.table_block,
        $.blockquote,
        $.horizontal_rule,
        $.pagebreak,
        $.column_break,
        $.header_block,
        $.footer_block,
        $.firstpage_block,
        $.evenpage_block,
        $.columns_block,
        $.anchor,
        $.footnote_def,
        $.end_directive,
        $.comment,
        $.paragraph,
        $._newline
      ),

    // Block content - excludes end_directive, elseif, else (they're terminators)
    _block_content: ($) =>
      choice(
        $.document_block,
        $.meta_block,
        $.import_directive,
        $.define_block,
        $.use_directive,
        $.if_block,
        $.repeat_block,
        $.foreach_block,
        $.set_directive,
        $.header,
        $.numbered_item,
        $.bullet_item,
        $.modifier_line,
        $.table_block,
        $.blockquote,
        $.horizontal_rule,
        $.pagebreak,
        $.column_break,
        $.header_block,
        $.footer_block,
        $.firstpage_block,
        $.evenpage_block,
        $.columns_block,
        $.anchor,
        $.footnote_def,
        $.comment,
        $.paragraph,
        $._newline
      ),

    // =========================================================================
    // @document block - opaque YAML-style content
    // =========================================================================
    document_block: ($) =>
      seq(
        "@document",
        $._newline,
        repeat($.indented_line)
      ),

    // =========================================================================
    // @meta block - opaque YAML-style content, requires @end
    // =========================================================================
    meta_block: ($) =>
      seq(
        "@meta",
        $._newline,
        repeat($.indented_line),
        "@end"
      ),

    // Opaque indented line - matches any indented content
    // Used for YAML-style blocks where we don't need to parse structure
    indented_line: ($) =>
      seq(
        /[ \t]+/,   // must start with whitespace
        /[^\n]*/,   // any content
        $._newline
      ),

    // =========================================================================
    // @import directive
    // =========================================================================
    import_directive: ($) =>
      seq("@import", /[^\n]+/),

    // =========================================================================
    // @define block - requires @end
    // =========================================================================
    define_block: ($) =>
      seq(
        "@define",
        $.identifier,
        optional(seq("(", optional($.parameter_list), ")")),
        $._newline,
        repeat($._block_content),
        "@end"
      ),

    // =========================================================================
    // @use directive
    // =========================================================================
    use_directive: ($) =>
      seq(
        "@use",
        $.identifier,
        optional(seq("(", optional($.argument_list), ")"))
      ),

    parameter_list: ($) =>
      seq($.parameter, repeat(seq(",", $.parameter))),

    parameter: ($) =>
      seq(
        $.identifier,
        optional(seq("=", $.default_value))
      ),

    default_value: ($) =>
      choice(
        $.string_literal,
        $.integer,
        $.identifier
      ),

    argument_list: ($) =>
      seq($.argument, repeat(seq(",", $.argument))),

    argument: ($) =>
      choice(
        $.named_argument,
        $.positional_argument
      ),

    named_argument: ($) =>
      seq($.identifier, "=", $.argument_value),

    positional_argument: ($) =>
      $.argument_value,

    argument_value: ($) =>
      choice(
        $.string_literal,
        $.integer,
        $.identifier,
        $.variable
      ),

    string_literal: ($) =>
      choice(
        seq('"', /[^"]*/, '"'),
        seq("'", /[^']*/, "'")
      ),

    // =========================================================================
    // Control flow: @if ... @elseif ... @else ... @end
    // =========================================================================
    if_block: ($) =>
      seq(
        $.if_clause,
        repeat($.elseif_clause),
        optional($.else_clause),
        "@end"
      ),

    if_clause: ($) =>
      seq(
        "@if",
        $.condition_expression,
        $._newline,
        repeat($._block_content)
      ),

    elseif_clause: ($) =>
      seq(
        "@elseif",
        $.condition_expression,
        $._newline,
        repeat($._block_content)
      ),

    else_clause: ($) =>
      seq(
        "@else",
        $._newline,
        repeat($._block_content)
      ),

    condition_expression: ($) =>
      /[^\n]+/,

    // =========================================================================
    // Control flow: @repeat count ... @end
    // =========================================================================
    repeat_block: ($) =>
      seq(
        "@repeat",
        $.repeat_count,
        $._newline,
        repeat($._block_content),
        "@end"
      ),

    repeat_count: ($) =>
      choice($.integer, $.variable),

    // =========================================================================
    // Control flow: @foreach item in collection ... @end
    // =========================================================================
    foreach_block: ($) =>
      seq(
        "@foreach",
        $.foreach_binding,
        $._newline,
        repeat($._block_content),
        "@end"
      ),

    foreach_binding: ($) =>
      seq($.identifier, "in", $.iterable_expression),

    iterable_expression: ($) =>
      choice($.variable, $.identifier),

    // =========================================================================
    // @set variable = value
    // =========================================================================
    set_directive: ($) =>
      seq(
        "@set",
        $.identifier,
        "=",
        $.set_value
      ),

    set_value: ($) =>
      choice(
        $.string_literal,
        $.integer,
        $.variable,
        $.identifier
      ),

    // =========================================================================
    // Headers: # through ######
    // =========================================================================
    header: ($) =>
      seq(
        $.header_marker,
        /[^\n]+/
      ),

    header_marker: ($) => /#{1,6}/,

    // =========================================================================
    // Numbered items: @1, @@a, @@@i, etc.
    // =========================================================================
    numbered_item: ($) =>
      seq(
        $.numbered_marker,
        /[^\n]*/
      ),

    numbered_marker: ($) =>
      seq(
        /@+/,
        optional(choice(
          /[0-9]+(\.[0-9]+)*/,  // 1, 1.1, 1.1.1
          /[a-z]/,              // a, b, c
          /[A-Z]/,              // A, B, C
          /[ivxIVX]+/           // i, ii, iii, I, II, III
        ))
      ),

    // =========================================================================
    // Bullet items: @- or @@- or @@@-
    // =========================================================================
    bullet_item: ($) =>
      seq(
        $.bullet_marker,
        /[^\n]*/
      ),

    bullet_marker: ($) => /@+-/,

    // =========================================================================
    // Modifiers: @center, @right, @indent, @bold, etc.
    // =========================================================================
    modifier_line: ($) =>
      seq(
        $.modifier,
        optional(choice(
          $.modifier_line,
          $.header,
          /[^\n]+/
        ))
      ),

    modifier: ($) =>
      choice(
        "@center",
        "@right",
        seq("@indent", optional(choice(seq(":", $.integer), seq("=", /[^\s\n]+/)))),
        seq("@outdent", optional(choice(seq(":", $.integer), seq("=", /[^\s\n]+/)))),
        "@box",
        "@bold",
        "@italic",
        "@small",
        "@caps",
        "@slot",
        "@h1",
        "@h2",
        "@h3",
        "@h4",
        "@h5",
        "@h6"
      ),

    // =========================================================================
    // @table block
    // =========================================================================
    table_block: ($) =>
      seq(
        "@table",
        $._newline,
        repeat($.table_row)
      ),

    table_row: ($) =>
      seq(
        optional(/[ \t]+/),
        "[",
        /[^\]]+/,
        "]",
        $._newline
      ),

    // =========================================================================
    // Blockquote: > content
    // =========================================================================
    blockquote: ($) =>
      seq(">", /[^\n]*/),

    // =========================================================================
    // Horizontal rule: ---+
    // =========================================================================
    horizontal_rule: ($) =>
      /---+/,

    // =========================================================================
    // Page and column breaks
    // =========================================================================
    pagebreak: ($) => "@pagebreak",

    column_break: ($) => "@break",

    // =========================================================================
    // @columns block - requires @end
    // =========================================================================
    columns_block: ($) =>
      seq(
        "@columns",
        optional($.columns_args),
        $._newline,
        repeat($._block_content),
        "@end"
      ),

    columns_args: ($) => /[^\n]+/,

    // =========================================================================
    // Header/Footer blocks
    // =========================================================================
    // Block form: @header\n  content\n@end
    // Single-line form: @header content (no @end)
    header_block: ($) =>
      choice(
        seq("@header", $._newline, repeat($._block_content), "@end"),
        seq("@header", /[^\n]+/)
      ),

    footer_block: ($) =>
      choice(
        seq("@footer", $._newline, repeat($._block_content), "@end"),
        seq("@footer", /[^\n]+/)
      ),

    // First page variants: @firstpage @header or @firstpage @footer
    firstpage_block: ($) =>
      seq(
        "@firstpage",
        choice(
          seq("@header", choice(
            seq($._newline, repeat($._block_content), "@end"),
            /[^\n]+/
          )),
          seq("@footer", choice(
            seq($._newline, repeat($._block_content), "@end"),
            /[^\n]+/
          ))
        )
      ),

    // Even page variants
    evenpage_block: ($) =>
      seq(
        "@evenpage",
        choice(
          seq("@header", choice(
            seq($._newline, repeat($._block_content), "@end"),
            /[^\n]+/
          )),
          seq("@footer", choice(
            seq($._newline, repeat($._block_content), "@end"),
            /[^\n]+/
          ))
        )
      ),

    // =========================================================================
    // @anchor directive
    // =========================================================================
    anchor: ($) => seq("@anchor", optional(/[^\n]+/)),

    // =========================================================================
    // Footnotes
    // =========================================================================
    footnote_def: ($) =>
      seq("[^", $.footnote_label, "]:", /[^\n]*/),

    footnote_label: ($) => /[a-zA-Z0-9_-]+/,

    // =========================================================================
    // @end directive (standalone, for block termination)
    // =========================================================================
    end_directive: ($) => "@end",

    // =========================================================================
    // Comments
    // =========================================================================
    comment: ($) =>
      choice(
        $.line_comment,
        $.block_comment,
        $.todo_comment
      ),

    line_comment: ($) => seq("//", /[^\n]*/),

    block_comment: ($) =>
      seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/"),

    todo_comment: ($) => seq("@todo", /[^\n]*/),

    // =========================================================================
    // Paragraph with inline content
    // =========================================================================
    paragraph: ($) =>
      repeat1($._inline),

    _inline: ($) =>
      choice(
        $.variable,
        $.cross_reference,
        $.defined_term,
        $.emphasis,
        $.strikethrough,
        $.inline_code,
        $.footnote_ref,
        $.image,
        $.link,
        $.hard_break,
        $.blank,
        $.text
      ),

    // =========================================================================
    // Variables: {{variable}} or {{path.to.value}}
    // =========================================================================
    variable: ($) =>
      seq("{{", $.variable_content, "}}"),

    variable_content: ($) => /[^}]+/,

    // =========================================================================
    // Cross references: [[reference]]
    // =========================================================================
    cross_reference: ($) =>
      seq("[[", /[^\]]+/, "]]"),

    // =========================================================================
    // Defined terms: "Term"
    // =========================================================================
    defined_term: ($) =>
      seq('"', /[^"]+/, '"'),

    // =========================================================================
    // Emphasis: *italic*, **bold**, ***bold_italic***
    // =========================================================================
    emphasis: ($) =>
      choice(
        seq("***", /[^*]+/, "***"),
        seq("**", /[^*]+/, "**"),
        seq("*", /[^*]+/, "*")
      ),

    // =========================================================================
    // Strikethrough: ~~text~~
    // =========================================================================
    strikethrough: ($) =>
      seq("~~", /[^~]+/, "~~"),

    // =========================================================================
    // Inline code: `code`
    // =========================================================================
    inline_code: ($) =>
      seq("`", /[^`]+/, "`"),

    // =========================================================================
    // Footnote reference: [^label]
    // =========================================================================
    footnote_ref: ($) =>
      seq("[^", $.footnote_label, "]"),

    // =========================================================================
    // Image: ![alt](src)
    // =========================================================================
    image: ($) =>
      seq("![", $.image_alt, "](", $.image_src, ")"),

    image_alt: ($) => /[^\]]*/,

    image_src: ($) => /[^)]*/,

    // =========================================================================
    // Link: [text](url)
    // =========================================================================
    link: ($) =>
      seq("[", $.link_text, "](", $.link_url, ")"),

    link_text: ($) => /[^\]]+/,

    link_url: ($) => /[^)]*/,

    // =========================================================================
    // Hard break: two or more trailing spaces at end of line
    // =========================================================================
    hard_break: ($) => /  +\n/,

    // =========================================================================
    // Blank: ___+ (underscores for fill-in-the-blank)
    // =========================================================================
    blank: ($) => /_{3,}/,

    // =========================================================================
    // Regular text - excludes special characters at start positions
    // Underscores are allowed since blanks require 3+ consecutive underscores
    // =========================================================================
    text: ($) => /[^\n@#>{}\[\]"*\/~`]+/,

    // =========================================================================
    // Helpers
    // =========================================================================
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    integer: ($) => /[0-9]+/,

    _newline: ($) => /\n/,
  },
});
