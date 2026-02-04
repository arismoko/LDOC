; Locals queries for LDOC
; Enables scope-aware features like go-to-definition and rename

;;; Scopes

; @define blocks create scope for parameters and local content
(define_block) @local.scope

; @foreach blocks create scope for loop variable
(foreach_block) @local.scope

; @if blocks create scope (variables defined inside stay inside)
(if_block) @local.scope

; @repeat blocks create scope
(repeat_block) @local.scope

;;; Definitions

; Macro name: defined in parent scope so it's accessible outside
((define_block
   (identifier) @local.definition)
 (#set! "definition.var.scope" "parent"))

; Macro parameters: defined within the define_block scope
(parameter
  (identifier) @local.definition)

; Loop variable: defined within the foreach_block scope
(foreach_binding
  (identifier) @local.definition)

; @set variables: defined in current scope
(set_directive
  (identifier) @local.definition)

; Footnote definitions
(footnote_def
  (footnote_label) @local.definition)

; Anchors
(anchor) @local.definition

;;; References

; {{variable}} references
(variable
  (variable_content) @local.reference)

; @use MacroName references
(use_directive
  (identifier) @local.reference)

; Named arguments in macro calls reference parameter names
(named_argument
  (identifier) @local.reference)

; Identifiers used as values
(set_value (identifier) @local.reference)
(argument_value (identifier) @local.reference)
(default_value (identifier) @local.reference)

; Loop collection references
(iterable_expression
  (identifier) @local.reference)

; Footnote references
(footnote_ref
  (footnote_label) @local.reference)

; Cross-references (to anchors)
(cross_reference) @local.reference
