---
hide:
  - navigation
  - toc
---

# LDOC: Professional Documents, Simplified

<div class="grid cards" markdown>

-   :material-language-markdown:{ .lg .middle } __Markdown-Compatible__

    ---

    Write in familiar Markdown. Headers, lists, and links work exactly how you expect.

-   :material-script-text-outline:{ .lg .middle } __Powerful Directives__

    ---

    Take control with `@directive` syntax. Columns, boxes, and page breaks are just a keyword away.

-   :material-variable:{ .lg .middle } __Dynamic Content__

    ---

    Variables and control flow. Use `@if`, `@foreach`, and `{{var}}` to build flexible templates.

-   :material-file-word-box-outline:{ .lg .middle } __Pro-Grade Output__

    ---

    Generate clean, professional DOCX files that look like they were hand-crafted in Word.

</div>

## At a Glance

LDOC bridges the gap between the simplicity of Markdown and the professional requirements of legal and business documents.

=== "Input (.ldoc)"

    ```ldoc
    @document
      title: "Mutual NDA"
      styles:
        body: { font: "Times New Roman", size: 12pt }

    # Non-Disclosure Agreement

    This Agreement is between {{party_a}} and {{party_b}}.

    @columns 2
      **Effective Date:**
      {{effective_date}}
      @break
      **Jurisdiction:**
      {{state}}
    @end
    ```

=== "Output (.docx)"

    *A perfectly formatted Word document with standard fonts, exact margins, and precise layout.*

## Quick Start

```bash
# 1. Install LDOC
npm install -g ldoc

# 2. Create a new document
ldoc init my-doc
cd my-doc

# 3. Compile to Word
ldoc compile document.ldoc
```

<div class="grid cards" markdown>

-   [:material-book-open-variant: __Syntax Reference__](syntax.md)
-   [:material-cog: __Document Settings__](document.md)
-   [:material-console: __CLI Guide__](cli.md)
-   [:material-github: __GitHub Repo__](https://github.com/user/ldoc)

</div>
