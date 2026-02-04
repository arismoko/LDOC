; Highlight queries for Legal Document DSL (.ldoc)
; Works with the tree-sitter-ldoc grammar

; =============================================================================
; Keywords and Directives
; =============================================================================

; Structure directives
"@document" @keyword
"@meta" @keyword
"@import" @keyword.import
"@define" @keyword.function
"@use" @keyword
"@end" @keyword

; Control flow keywords
"@if" @keyword.conditional
"@elseif" @keyword.conditional
"@else" @keyword.conditional
"@foreach" @keyword.repeat
"@repeat" @keyword.repeat
"@set" @keyword

; Layout keywords
(columns_block) @keyword
(column_break) @keyword
(pagebreak) @keyword
(header_block) @keyword
(footer_block) @keyword
(firstpage_block) @keyword
(evenpage_block) @keyword
(anchor) @keyword
(table_block) @keyword

; =============================================================================
; Control Flow Content
; =============================================================================

(condition_expression) @string.special
(foreach_binding (identifier) @variable)
(iterable_expression (identifier) @variable)
(repeat_count (integer) @number)
(set_directive (identifier) @variable)

; =============================================================================
; Macros and Parameters
; =============================================================================

(define_block (identifier) @function)
(use_directive (identifier) @function)
(parameter (identifier) @variable.parameter)
(default_value (string_literal) @string)
(default_value (integer) @number)
(argument (named_argument (identifier) @variable.parameter))
(string_literal) @string

; =============================================================================
; Modifiers
; =============================================================================

(modifier) @function.builtin

; =============================================================================
; Lists and Numbered Items
; =============================================================================

(numbered_marker) @punctuation.special
(bullet_marker) @punctuation.special

; =============================================================================
; Headers
; =============================================================================

(header_marker) @punctuation.special
(header) @markup.heading

; =============================================================================
; Variables and Cross References
; =============================================================================

(variable
  "{{" @punctuation.bracket
  (variable_content) @variable
  "}}" @punctuation.bracket)

; Invalid variable: single braces instead of double - highlight as error
(invalid_variable) @error

(cross_reference
  "[[" @punctuation.bracket
  "]]" @punctuation.bracket) @markup.link

; =============================================================================
; Inline Formatting
; =============================================================================

(defined_term) @string.special
(emphasis) @markup.italic
(strikethrough) @markup.strikethrough
(inline_code) @markup.raw
(footnote_ref) @markup.link
(footnote_def) @markup.link
(footnote_label) @label

; =============================================================================
; Links and Images
; =============================================================================

(image
  (image_alt) @string
  (image_src) @string.special.url)

(link
  (link_text) @string
  (link_url) @string.special.url)

; =============================================================================
; Block Elements
; =============================================================================

(blockquote) @markup.quote
(horizontal_rule) @punctuation.special
(table_row) @markup.list

; =============================================================================
; Comments
; =============================================================================

(line_comment) @comment
(block_comment) @comment
(todo_comment) @comment.todo

; =============================================================================
; Blanks and Special Punctuation
; =============================================================================

(blank) @punctuation.special
(hard_break) @punctuation.special

; =============================================================================
; Opaque Blocks (YAML-style content in @document/@meta)
; =============================================================================

; Match keys in indented lines (word followed by colon)
((indented_line) @property
  (#match? @property "^[ \\t]*[a-z_-]+:"))

; =============================================================================
; Identifiers (fallback)
; =============================================================================

(identifier) @variable
(integer) @number
