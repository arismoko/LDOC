" Vim syntax file for Legal Document DSL (.ldoc)
" Language: ldoc
" Maintainer: ldoc

if exists("b:current_syntax")
  finish
endif

" Keywords
syn match ldocDocument      "@document\s\+" nextgroup=ldocDocumentTitle
syn match ldocDocumentTitle "[^\n]*" contained

syn match ldocMeta          "@meta"
syn match ldocImport        "@import\s\+" nextgroup=ldocImportPath
syn match ldocImportPath    "[^\n]*" contained

syn match ldocDefine        "@define\s\+" nextgroup=ldocDefineName
syn match ldocDefineName    "\w\+" contained
syn match ldocSet           "@set\s\+" nextgroup=ldocSetVar
syn match ldocSetVar        "[a-zA-Z0-9_.]\+" contained
syn match ldocUse           "@use\s\+" nextgroup=ldocUseName
syn match ldocUseName       "\w\+" contained

" Modifiers
syn match ldocModifier      "@center\|@right\|@indent\(:\d\+\)\?\|@outdent\(:\d\+\)\?\|@box\|@bold\|@italic\|@small\|@caps\|@h[1-6]"

" Numbered items
syn match ldocNumbered      "^@@*[0-9a-zA-Z.]*\s"

" Bullet items
syn match ldocBullet        "^@@*-\s"

" Page control
syn match ldocPagebreak     "@pagebreak"
syn match ldocHeader        "@header\|@footer\|@firstpage\|@evenpage\|@margins\|@spacing\|@landscape\|@columns\|@anchor"

" Headers (markdown style)
syn match ldocHeading       "^#\{1,6\}\s.*$"

" Variables
syn region ldocVariable     start="{{" end="}}" contains=ldocVarName
syn match ldocVarName       "[^}|]\+" contained
syn match ldocVarFilter     "|\s*\w\+" contained

" Cross-references
syn region ldocCrossRef     start="\[\[" end="\]\]"

" Defined terms (first occurrence)
syn region ldocDefinedTerm  start=/"/ end=/"/

" Emphasis
syn region ldocBold         start="\*\*" end="\*\*"
syn region ldocItalic       start="\*[^*]"me=e-1 end="\*"
syn region ldocBoldItalic   start="\*\*\*" end="\*\*\*"

" Blanks
syn match ldocBlank         "_\{3,\}"

" Tables
syn match ldocTable         "@table"
syn region ldocTableRow     start="\[" end="\]" contains=ldocTableCell
syn match ldocTableCell     "[^,\[\]]\+" contained contains=ldocTableMerge
syn match ldocTableMerge    "[>^]" contained

" Comments
syn match ldocLineComment   "//.*$"
syn region ldocBlockComment start="/\*" end="\*/"
syn match ldocTodo          "@todo.*$"
syn match ldocEndBlock      "^\s*@end\s*$"

" Meta entries
syn match ldocMetaKey       "^\s\+\w\+:" contains=ldocMetaColon
syn match ldocMetaColon     ":" contained

" Highlighting
hi def link ldocDocument      Keyword
hi def link ldocDocumentTitle Title
hi def link ldocMeta          Keyword
hi def link ldocImport        Include
hi def link ldocImportPath    String
hi def link ldocDefine        Keyword
hi def link ldocDefineName    Function
hi def link ldocSet           Keyword
hi def link ldocSetVar        Identifier
hi def link ldocUse           Keyword
hi def link ldocUseName       Function

hi def link ldocModifier      Function

hi def link ldocNumbered      Number
hi def link ldocBullet        Special

hi def link ldocPagebreak     Keyword
hi def link ldocHeader        Keyword

hi def link ldocHeading       Title

hi def link ldocVariable      Identifier
hi def link ldocVarName       Identifier
hi def link ldocVarFilter     Operator

hi def link ldocCrossRef      Underlined

hi def link ldocDefinedTerm   String

hi def link ldocBold          Bold
hi def link ldocItalic        Italic
hi def link ldocBoldItalic    Bold

hi def link ldocBlank         Special

hi def link ldocTable         Keyword
hi def link ldocTableRow      Normal
hi def link ldocTableMerge    Special

hi def link ldocLineComment   Comment
hi def link ldocBlockComment  Comment
hi def link ldocTodo          Todo
hi def link ldocEndBlock      Keyword

hi def link ldocMetaKey       Type
hi def link ldocMetaColon     Delimiter

let b:current_syntax = "ldoc"
