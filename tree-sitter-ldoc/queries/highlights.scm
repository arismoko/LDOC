; Highlight queries for Legal Document DSL

; Keywords and directives
(document_directive) @keyword

; Directive keywords (matched as part of their containing nodes)
(define_block) @keyword
(use_directive) @keyword
(import_directive) @keyword
(meta_block) @keyword
(table_block) @keyword
(pagebreak) @keyword
(column_break) @keyword
(columns) @keyword
(anchor) @keyword

(doc_header) @keyword
(doc_footer) @keyword
(firstpage) @keyword
(evenpage) @keyword

; Control flow keywords
(if_clause) @keyword.conditional
(elseif_clause) @keyword.conditional
(else_clause) @keyword.conditional
(end_directive) @keyword
(repeat_block) @keyword.repeat
(foreach_block) @keyword.repeat
(set_directive) @keyword

; Control flow content
(condition_expression) @string.special
(foreach_binding (identifier) @variable)
(iterable_expression) @variable
(repeat_count) @number
(set_directive (identifier) @variable)

; Parameters and arguments
(parameter (identifier) @variable.parameter)
(default_value) @string
(argument_value) @string
(string_literal) @string

; Modifiers
(modifier) @function

; Numbered items
(numbered_marker) @number
(bullet_marker) @punctuation.special

; Headers
(header_marker) @punctuation.special
(header) @markup.heading

; Variables
(variable) @variable
(variable_content) @variable

; Cross references
(cross_reference) @markup.link

; Defined terms
(defined_term) @string.special

; Emphasis
(emphasis) @markup.italic

; Inline formatting
(strikethrough) @markup.strikethrough
(inline_code) @markup.raw
(footnote_ref) @markup.link
(footnote_def) @markup.link
(footnote_label) @label
(image) @markup.link
(image_alt) @string
(image_src) @string.special.url
(link) @markup.link
(link_text) @string
(link_url) @string.special.url
(hard_break) @punctuation.special

; Block elements
(blockquote) @markup.quote
(horizontal_rule) @punctuation.special

; Blanks
(blank) @punctuation.special

; Comments
(line_comment) @comment
(block_comment) @comment
(todo_comment) @comment.todo

; Table
(table_row) @markup.list

; Meta entries
(meta_entry) @property
(identifier) @property

; Strings and text
(text) @string
