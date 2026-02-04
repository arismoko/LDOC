; Indentation queries for LDOC

; Increase indent after block openers
[
  (meta_block)
  (define_block)
  (if_clause)
  (elseif_clause)
  (else_clause)
  (repeat_block)
  (foreach_block)
  (table_block)
] @indent.begin

; Decrease indent at block closers
(end_directive) @indent.end @indent.dedent

; Branch nodes that dedent themselves but continue the block
[
  (elseif_clause)
  (else_clause)
] @indent.branch

; Ignore blank lines for indent calculation
(blank) @indent.ignore
