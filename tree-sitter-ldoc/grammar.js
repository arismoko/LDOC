// Tree-sitter grammar for Legal Document DSL (.ldoc)
// This grammar provides Neovim syntax highlighting

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
        $.document_directive,
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
        $.doc_header,
        $.doc_footer,
        $.firstpage,
        $.evenpage,
        $.columns,
        $.anchor,
        $.footnote_def,
        $.comment,
        $.paragraph,
        $._newline
      ),

    // Block content excludes end_directive, elseif, else (they're block terminators)
    _block_content: ($) =>
      choice(
        $.document_directive,
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
        $.doc_header,
        $.doc_footer,
        $.firstpage,
        $.evenpage,
        $.columns,
        $.anchor,
        $.footnote_def,
        $.comment,
        $.paragraph,
        $._newline
      ),

    // @document Title
    document_directive: ($) =>
      seq("@document", /[^\n]+/),

    // @meta block
    meta_block: ($) =>
      seq(
        "@meta",
        $._newline,
        repeat($.meta_entry)
      ),

    meta_entry: ($) =>
      seq(
        $._indent,
        $.identifier,
        ":",
        optional(/[^\n]*/),
        $._newline
      ),

    // @import path
    import_directive: ($) =>
      seq("@import", /[^\n]+/),

    // @define name(params) ... @end
    define_block: ($) =>
      seq(
        "@define",
        $.identifier,
        optional(seq("(", optional($.parameter_list), ")")),
        $._newline,
        repeat($._block_content),
        $.end_directive
      ),

    // @use name or @use name(args)
    use_directive: ($) =>
      seq(
        "@use",
        $.identifier,
        optional(seq("(", optional($.argument_list), ")"))
      ),

    parameter_list: ($) =>
      seq($.parameter, repeat(seq(",", $.parameter))),

    // Parameter with optional default value
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

    // Argument list for @use (supports named params)
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

    // Control flow: @if ... @elseif ... @else ... @end
    if_block: ($) =>
      seq(
        $.if_clause,
        repeat($.elseif_clause),
        optional($.else_clause),
        $.end_directive
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

    // Control flow: @repeat count ... @end
    repeat_block: ($) =>
      seq(
        "@repeat",
        $.repeat_count,
        $._newline,
        repeat($._block_content),
        $.end_directive
      ),

    repeat_count: ($) =>
      choice($.integer, $.variable),

    // Control flow: @foreach item in collection ... @end
    foreach_block: ($) =>
      seq(
        "@foreach",
        $.foreach_binding,
        $._newline,
        repeat($._block_content),
        $.end_directive
      ),

    foreach_binding: ($) =>
      seq($.identifier, "in", $.iterable_expression),

    iterable_expression: ($) =>
      choice($.variable, $.identifier),

    // @set variable = value
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

    // # Header
    header: ($) =>
      seq(
        $.header_marker,
        /[^\n]+/
      ),

    header_marker: ($) => /#{1,6}/,

    // @1, @@a, @@@i numbered items
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

    // @- bullet items
    bullet_item: ($) =>
      seq(
        $.bullet_marker,
        /[^\n]*/
      ),

    bullet_marker: ($) => /@+-/,

    // @modifier content
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
        seq("@indent", optional(seq(":", $.integer))),
        seq("@outdent", optional(seq(":", $.integer))),
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

    // @table block
    table_block: ($) =>
      seq(
        "@table",
        $._newline,
        repeat($.table_row)
      ),

    table_row: ($) =>
      seq(
        optional($._indent),
        "[",
        /[^\]]+/,
        "]",
        $._newline
      ),

    // > blockquote content
    blockquote: ($) =>
      seq(">", /[^\n]*/),

    // --- horizontal rule
    horizontal_rule: ($) =>
      /---+/,

    // @pagebreak
    pagebreak: ($) => "@pagebreak",

    // @break (column break)
    column_break: ($) => "@break",

    // Document header/footer directives
    doc_header: ($) => seq("@header", optional(/[^\n]+/)),
    doc_footer: ($) => seq("@footer", optional(/[^\n]+/)),
    firstpage: ($) => seq("@firstpage", optional(/[^\n]+/)),
    evenpage: ($) => seq("@evenpage", optional(/[^\n]+/)),

    // Document layout directives
    columns: ($) => seq("@columns", optional(/[^\n]+/)),

    // @anchor
    anchor: ($) => seq("@anchor", optional(/[^\n]+/)),

    // [^label]: footnote definition (block level)
    footnote_def: ($) =>
      seq("[^", $.footnote_label, "]:", /[^\n]*/),

    footnote_label: ($) => /[a-zA-Z0-9_-]+/,

    // @end directive
    end_directive: ($) => "@end",

    // Comments
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

    // Paragraph with inline content
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

    // {{variable}}
    variable: ($) =>
      seq("{{", $.variable_content, "}}"),

    variable_content: ($) => /[^}]+/,

    // [[reference]]
    cross_reference: ($) =>
      seq("[[", /[^\]]+/, "]]"),

    // "Defined Term"
    defined_term: ($) =>
      seq('"', /[^"]+/, '"'),

    // **bold**, *italic*, ***both***
    emphasis: ($) =>
      choice(
        seq("***", /[^*]+/, "***"),
        seq("**", /[^*]+/, "**"),
        seq("*", /[^*]+/, "*")
      ),

    // ~~strikethrough~~
    strikethrough: ($) =>
      seq("~~", /[^~]+/, "~~"),

    // `inline code`
    inline_code: ($) =>
      seq("`", /[^`]+/, "`"),

    // [^label] footnote reference
    footnote_ref: ($) =>
      seq("[^", $.footnote_label, "]"),

    // ![alt](src) image
    image: ($) =>
      seq("![", $.image_alt, "](", $.image_src, ")"),

    image_alt: ($) => /[^\]]*/,

    image_src: ($) => /[^)]*/,

    // [text](url) link
    link: ($) =>
      seq("[", $.link_text, "](", $.link_url, ")"),

    link_text: ($) => /[^\]]+/,

    link_url: ($) => /[^)]*/,

    // Hard break: two or more trailing spaces at end of line
    hard_break: ($) => /  +\n/,

    // _____
    blank: ($) => /_{3,}/,

    // Regular text - excludes special characters  
    // Note: ( and ! are allowed within text - only special at token start
    text: ($) => /[^\n@#>{}\[\]"*_\/~`]+/,

    // Helpers
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    integer: ($) => /[0-9]+/,

    _indent: ($) => /[ \t]+/,

    _newline: ($) => /\n/,
  },
});
