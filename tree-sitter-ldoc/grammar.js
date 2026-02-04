// Tree-sitter grammar for Legal Document DSL (.ldoc)
// This grammar provides Neovim syntax highlighting

module.exports = grammar({
  name: "ldoc",

  extras: ($) => [/[ \t]/],

  rules: {
    source_file: ($) => repeat($._statement),

    _statement: ($) =>
      choice(
        $.document_directive,
        $.meta_block,
        $.import_directive,
        $.define_block,
        $.use_directive,
        $.header,
        $.numbered_item,
        $.bullet_item,
        $.modifier_line,
        $.table_block,
        $.pagebreak,
        $.doc_header,
        $.doc_footer,
        $.firstpage,
        $.evenpage,
        $.margins,
        $.spacing,
        $.landscape,
        $.columns,
        $.anchor,
        $.end_directive,
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

    // @define name(params)
    define_block: ($) =>
      seq(
        "@define",
        $.identifier,
        optional(seq("(", optional($.parameter_list), ")")),
        $._newline,
        repeat($._statement)
      ),

    // @use name
    use_directive: ($) => seq("@use", /[^\n]+/),

    parameter_list: ($) =>
      seq($.identifier, repeat(seq(",", $.identifier))),

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

    // @pagebreak
    pagebreak: ($) => "@pagebreak",

    // Document header/footer directives
    doc_header: ($) => seq("@header", optional(/[^\n]+/)),
    doc_footer: ($) => seq("@footer", optional(/[^\n]+/)),
    firstpage: ($) => seq("@firstpage", optional(/[^\n]+/)),
    evenpage: ($) => seq("@evenpage", optional(/[^\n]+/)),

    // Document layout directives
    margins: ($) => seq("@margins", optional(/[^\n]+/)),
    spacing: ($) => seq("@spacing", optional(/[^\n]+/)),
    landscape: ($) => seq("@landscape", optional(/[^\n]+/)),
    columns: ($) => seq("@columns", optional(/[^\n]+/)),

    // @anchor
    anchor: ($) => seq("@anchor", optional(/[^\n]+/)),

    // @end directive (replaces @;)
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

    // _____
    blank: ($) => /_{3,}/,

    // Regular text
    text: ($) => /[^\n@#{}[\]"*_\/]+/,

    // Helpers
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    integer: ($) => /[0-9]+/,

    _indent: ($) => /[ \t]+/,

    _newline: ($) => /\n/,
  },
});
