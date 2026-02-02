; Highlight queries for Legal Document DSL

; Keywords and directives
(document_directive) @keyword
"@document" @keyword
"@meta" @keyword
"@import" @keyword
"@define" @keyword
"@table" @keyword
"@pagebreak" @keyword

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
"{{" @punctuation.bracket
"}}" @punctuation.bracket
(variable_content) @variable

; Cross references
(cross_reference) @markup.link
"[[" @punctuation.bracket
"]]" @punctuation.bracket

; Defined terms
(defined_term) @string.special

; Emphasis
(emphasis) @markup.italic

; Blanks
(blank) @punctuation.special

; Comments
(line_comment) @comment
(block_comment) @comment
(todo_comment) @comment.todo
"@todo" @comment.todo

; Table
(table_row) @markup.list

; Meta entries
(meta_entry) @property
(identifier) @property

; Strings and text
(text) @string
