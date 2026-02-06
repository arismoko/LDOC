/**
 * Parser Fuzz Tests
 *
 * Comprehensive fuzz testing to ensure the parser never crashes on any input.
 * The parser should always produce a valid CST, even for malformed input.
 */

import { describe, test, expect } from "bun:test";
import { parseSource } from "../src/parse/index.ts";

describe("Parser Fuzz Tests", () => {
  // Helper: mutate a string in various ways
  function mutateString(s: string): string {
    const mutations = [
      () => s.slice(0, Math.floor(Math.random() * s.length)), // truncate
      () => s + String.fromCharCode(Math.floor(Math.random() * 128)), // append
      () =>
        s
          .split("")
          .filter(() => Math.random() > 0.1)
          .join(""), // delete chars
      () =>
        s
          .split("")
          .sort(() => Math.random() - 0.5)
          .join(""), // shuffle
      () => s.replace(/./g, (c) => (Math.random() > 0.9 ? "" : c)), // sparse delete
      () => {
        // insert random char at random position
        const pos = Math.floor(Math.random() * s.length);
        const char = String.fromCharCode(Math.floor(Math.random() * 128));
        return s.slice(0, pos) + char + s.slice(pos);
      },
      () => {
        // duplicate random segment
        const start = Math.floor(Math.random() * s.length);
        const len = Math.floor(Math.random() * 10);
        const segment = s.slice(start, start + len);
        return s + segment;
      },
      () => s.split("").reverse().join(""), // reverse
    ];
    const mutation = mutations[Math.floor(Math.random() * mutations.length)]!;
    return mutation();
  }

  describe("random bytes test", () => {
    test("never crashes on random bytes (1000 iterations)", () => {
      for (let i = 0; i < 1000; i++) {
        const randomBytes = crypto.getRandomValues(
          new Uint8Array(Math.floor(Math.random() * 500))
        );
        const input = new TextDecoder("utf-8", { fatal: false }).decode(
          randomBytes
        );

        // Should never throw
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("produces valid CST structure for random bytes", () => {
      for (let i = 0; i < 100; i++) {
        const randomBytes = crypto.getRandomValues(
          new Uint8Array(Math.floor(Math.random() * 200))
        );
        const input = new TextDecoder("utf-8", { fatal: false }).decode(
          randomBytes
        );

        const result = parseSource(input);
        expect(result.cst.type).toBe("Document");
        expect(Array.isArray(result.cst.children)).toBe(true);
        expect(Array.isArray(result.diagnostics)).toBe(true);
      }
    });
  });

  describe("mutated valid documents", () => {
    const validDocs = [
      "@define foo\n  Hello world\n\n@use(foo)",
      "# Heading\n\nParagraph with **bold** text.",
      "@if(condition)\n  @foreach(x in list)\n    {{ x }}",
      "- Item 1\n- Item 2\n  - Nested\n- Item 3",
      '@document(title: "Test", author: "Me")',
      "[Link text](https://example.com) and ![Image](image.png)",
      "Text with [^footnote] reference.\n\n[^footnote]: The content.",
      "> Blockquote with **bold**\n>\n> Second paragraph",
      "@@1 First item\n@@2 Second item\n@@3 Third item",
      "@table\n  @row\n    @cell Header 1\n    @cell Header 2",
      '1. First\n2. Second\n   - Nested bullet\n3. Third',
      "---\n\nHorizontal rule above\n\n---",
      "Cross-ref: [[section-name]] and see [[#anchor]]",
      "Inline `code` and {{variable}} with *italic*.",
      '@style(bold: true)\n  Styled text here',
    ];

    test("never crashes on mutated valid documents (500 iterations)", () => {
      for (const doc of validDocs) {
        for (let i = 0; i < 50; i++) {
          const mutated = mutateString(doc);
          expect(() => parseSource(mutated)).not.toThrow();
        }
      }
    });

    test("multiple mutations in sequence", () => {
      for (const doc of validDocs) {
        let current = doc;
        for (let i = 0; i < 10; i++) {
          current = mutateString(current);
          expect(() => parseSource(current)).not.toThrow();
        }
      }
    });
  });

  describe("token shuffling", () => {
    test("shuffled characters never crash", () => {
      const inputs = [
        "@define(macro)\n  Content here",
        "**bold** and *italic* text",
        "{{variable}} in paragraph",
        "# Heading\n\n## Subheading",
        "- List\n- Items\n  - Nested",
      ];

      for (const input of inputs) {
        for (let i = 0; i < 100; i++) {
          const shuffled = input
            .split("")
            .sort(() => Math.random() - 0.5)
            .join("");
          expect(() => parseSource(shuffled)).not.toThrow();
        }
      }
    });

    test("shuffled words never crash", () => {
      const input = "@define macro Content here Hello world @use macro end";
      const words = input.split(" ");

      for (let i = 0; i < 100; i++) {
        const shuffled = words.sort(() => Math.random() - 0.5).join(" ");
        expect(() => parseSource(shuffled)).not.toThrow();
      }
    });

    test("shuffled lines never crash", () => {
      const input = `# Heading
@define(foo)
  Body content
Some paragraph
- List item
@use(foo)`;
      const lines = input.split("\n");

      for (let i = 0; i < 100; i++) {
        const shuffled = lines.sort(() => Math.random() - 0.5).join("\n");
        expect(() => parseSource(shuffled)).not.toThrow();
      }
    });
  });

  describe("large document stress test", () => {
    test("handles document with 1000+ lines", () => {
      let doc = "# Very Large Document\n\n";
      for (let i = 0; i < 1000; i++) {
        doc += `Paragraph ${i} with **bold** and *italic* and {{var${i}}}.\n\n`;
      }

      const result = parseSource(doc);
      expect(result.cst.type).toBe("Document");
      expect(result.cst.children.length).toBeGreaterThan(500);
    });

    test("handles document with very long lines", () => {
      let doc = "# Heading\n\n";
      doc += "x".repeat(10000) + "\n\n";
      doc += "y".repeat(10000) + "\n";

      expect(() => parseSource(doc)).not.toThrow();
    });

    test("handles document with many directives", () => {
      let doc = "@document(title: 'Stress Test')\n\n";
      for (let i = 0; i < 500; i++) {
        doc += `@define(macro${i})\n  Content for macro ${i}\n\n`;
      }
      for (let i = 0; i < 500; i++) {
        doc += `@use(macro${i})\n\n`;
      }

      expect(() => parseSource(doc)).not.toThrow();
    });

    test("handles document with many list items", () => {
      let doc = "# List Stress Test\n\n";
      for (let i = 0; i < 1000; i++) {
        doc += `- Item number ${i}\n`;
      }

      const result = parseSource(doc);
      expect(result.cst.type).toBe("Document");
    });
  });

  describe("deeply nested directives", () => {
    test("handles 20+ levels of nesting", () => {
      let doc = "";
      const depth = 25;

      for (let i = 0; i < depth; i++) {
        doc += "  ".repeat(i) + `@if(cond${i})\n`;
      }
      doc += "  ".repeat(depth) + "Deeply nested content\n";

      expect(() => parseSource(doc)).not.toThrow();
    });

    test("handles deeply nested lists", () => {
      let doc = "";
      const depth = 20;

      for (let i = 0; i < depth; i++) {
        doc += "  ".repeat(i) + `- Level ${i}\n`;
      }

      expect(() => parseSource(doc)).not.toThrow();
    });

    test("handles mixed deep nesting", () => {
      let doc = "@if(a)\n";
      for (let i = 1; i <= 15; i++) {
        const indent = "  ".repeat(i);
        doc += `${indent}@foreach(x${i} in list${i})\n`;
        doc += `${indent}  - Item {{ x${i} }}\n`;
      }

      expect(() => parseSource(doc)).not.toThrow();
    });
  });

  describe("all delimiter combinations", () => {
    const delimiters = [
      "{{",
      "}}",
      "[[",
      "]]",
      "[^",
      "[",
      "]",
      "(",
      ")",
      "**",
      "*",
      "~~",
      "==",
      "`",
      "```",
      "@",
      "@@",
      "#",
      "##",
      "###",
      "-",
      ">",
      "---",
      "!",
      "![",
    ];

    test("random combinations of delimiters never crash", () => {
      for (let i = 0; i < 500; i++) {
        let doc = "";
        const count = Math.floor(Math.random() * 20) + 5;
        for (let j = 0; j < count; j++) {
          const delimiter =
            delimiters[Math.floor(Math.random() * delimiters.length)]!;
          doc += delimiter + " ";
        }

        expect(() => parseSource(doc)).not.toThrow();
      }
    });

    test("all delimiters in sequence", () => {
      const doc = delimiters.join(" text ") + " end";
      expect(() => parseSource(doc)).not.toThrow();
    });

    test("repeated delimiters", () => {
      for (const delimiter of delimiters) {
        const doc = (delimiter + " ").repeat(50);
        expect(() => parseSource(doc)).not.toThrow();
      }
    });

    test("nested delimiters", () => {
      const cases = [
        "{{ {{ {{ x }} }} }}",
        "[[ [[ text ]] ]]",
        "**bold **nested** text**",
        "[link [nested] text](url)",
        "[[cross [[ref]] ]]",
      ];

      for (const doc of cases) {
        expect(() => parseSource(doc)).not.toThrow();
      }
    });
  });

  describe("edge case characters", () => {
    test("NULL bytes in input", () => {
      const inputs = [
        "Hello\x00World",
        "\x00@define(x)\n  body",
        "Text\x00\x00\x00more",
        "Before\x00\x00After",
        "\x00".repeat(100),
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("unicode characters", () => {
      const inputs = [
        "Hello world",
        "Caf\u00e9 and na\u00efve",
        "\u4e2d\u6587\u6587\u672c Chinese text",
        "\u0410\u0440\u0438\u0432\u0435\u0442 Russian",
        "\u3053\u3093\u306b\u3061\u306f Japanese",
        "\u0639\u0631\u0628\u064a Arabic",
        "\u05e9\u05dc\u05d5\u05dd Hebrew",
        "\ud55c\uad6d\uc5b4 Korean",
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("emoji characters", () => {
      const inputs = [
        "Hello world",
        "Status: done",
        "# Heading with star",
        "@define(emoji_macro)\n  Thumbs up in macro",
        "- List with check\n- And cross",
        "Multiple together",
        "Complex: flag flag flag",
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("RTL text", () => {
      const inputs = [
        "\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645", // Arabic: Hello World
        "\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd", // Hebrew: Hello World
        "Mixed English and \u0639\u0631\u0628\u064a text",
        "@define(\u062a\u0639\u0631\u064a\u0641)\n  \u0645\u062d\u062a\u0648\u0649",
        "# \u05db\u05d5\u05ea\u05e8\u05ea",
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("zero-width characters", () => {
      const inputs = [
        "Hello\u200bWorld", // zero-width space
        "Test\u200cText", // zero-width non-joiner
        "Test\u200dText", // zero-width joiner
        "Test\ufeffText", // BOM
        "\u200b".repeat(100),
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("control characters", () => {
      const inputs = [
        "Hello\x01\x02\x03World",
        "\x07Bell\x08Backspace",
        "Tab\there",
        "Carriage\rReturn",
        "Form\x0cFeed",
        "Escape\x1bSequence",
        Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join(""),
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("combining characters", () => {
      const inputs = [
        "e\u0301", // e + combining acute accent = é
        "n\u0303", // n + combining tilde = ñ
        "o\u0308", // o + combining diaeresis = ö
        "a\u0300\u0301\u0302\u0303", // multiple combining marks
        "Test\u0327\u0328\u0329text", // multiple combiners
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("surrogate pairs", () => {
      const inputs = [
        "\ud83d\ude00", // 😀
        "\ud83c\udff3\ufe0f\u200d\ud83c\udf08", // 🏳️‍🌈
        "\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66", // 👨‍👩‍👧‍👦
        "Text\ud83d\ude80Text", // 🚀 in text
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("invalid UTF-8 sequences (via random bytes)", () => {
      // Generate bytes that may produce invalid UTF-8 sequences
      const invalidSequences = [
        new Uint8Array([0x80]), // Lone continuation byte
        new Uint8Array([0xc0, 0x80]), // Overlong encoding
        new Uint8Array([0xfe, 0xff]), // Invalid start bytes
        new Uint8Array([0xf4, 0x90, 0x80, 0x80]), // Out of range
      ];

      for (const bytes of invalidSequences) {
        const input = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        expect(() => parseSource(input)).not.toThrow();
      }
    });
  });

  describe("pathological patterns", () => {
    test("many unclosed delimiters", () => {
      const patterns = [
        "{{".repeat(100),
        "[[".repeat(100),
        "[^".repeat(100),
        "**".repeat(100),
        "(".repeat(100),
        "@define(".repeat(50),
      ];

      for (const pattern of patterns) {
        expect(() => parseSource(pattern)).not.toThrow();
      }
    });

    test("alternating open/close", () => {
      const patterns = [
        "{{ }} ".repeat(100),
        "[[ ]] ".repeat(100),
        "** text ** ".repeat(100),
        "( ) ".repeat(100),
      ];

      for (const pattern of patterns) {
        expect(() => parseSource(pattern)).not.toThrow();
      }
    });

    test("all whitespace variations", () => {
      const inputs = [
        " ".repeat(1000),
        "\t".repeat(1000),
        "\n".repeat(1000),
        "\r\n".repeat(500),
        " \t\n\r\n ".repeat(200),
        "  \t  \n  \t  ".repeat(100),
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("maximum length identifiers", () => {
      const longName = "a".repeat(10000);
      const inputs = [
        `@${longName}`,
        `@define(${longName})`,
        `{{${longName}}}`,
        `[^${longName}]`,
        `[[${longName}]]`,
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("empty constructs", () => {
      const inputs = [
        "@()",
        "@define()\n  ",
        "{{}}",
        "[[]]",
        "[^]",
        "[]()",
        "![]()",
        "**",
        "*",
        "~~",
        "==",
        "``",
        "```\n```",
        "- ",
        "> ",
        "# ",
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });

    test("only special characters", () => {
      const inputs = [
        "!@#$%^&*()_+-=[]{}|;':\",./<>?`~",
        "\\".repeat(100),
        "/".repeat(100),
        "|".repeat(100),
        "^".repeat(100),
        "&".repeat(100),
      ];

      for (const input of inputs) {
        expect(() => parseSource(input)).not.toThrow();
      }
    });
  });

  describe("grammar-aware fuzzing", () => {
    // Generate syntactically plausible but potentially broken input
    function generateRandomDirective(): string {
      const names = [
        "if",
        "else",
        "elseif",
        "foreach",
        "define",
        "use",
        "ref",
        "style",
        "table",
        "row",
        "cell",
        "document",
        "repeat",
      ];
      const name = names[Math.floor(Math.random() * names.length)];
      const hasArgs = Math.random() > 0.3;
      const hasBody = Math.random() > 0.5;

      let result = `@${name}`;
      if (hasArgs) {
        result += "(";
        const argCount = Math.floor(Math.random() * 3);
        for (let i = 0; i < argCount; i++) {
          if (i > 0) result += ", ";
          if (Math.random() > 0.5) {
            result += `arg${i}: "value${i}"`;
          } else {
            result += `arg${i}`;
          }
        }
        if (Math.random() > 0.2) {
          // Sometimes forget to close
          result += ")";
        }
      }
      if (hasBody && Math.random() > 0.3) {
        result += "\n  Body content here";
      }
      return result;
    }

    function generateRandomParagraph(): string {
      const parts: string[] = [];
      const count = Math.floor(Math.random() * 5) + 1;

      for (let i = 0; i < count; i++) {
        const choice = Math.random();
        if (choice < 0.3) {
          parts.push("text content");
        } else if (choice < 0.4) {
          parts.push(Math.random() > 0.5 ? "**bold**" : "**unclosed");
        } else if (choice < 0.5) {
          parts.push(Math.random() > 0.5 ? "*italic*" : "*unclosed");
        } else if (choice < 0.6) {
          parts.push(Math.random() > 0.5 ? "{{var}}" : "{{unclosed");
        } else if (choice < 0.7) {
          parts.push(Math.random() > 0.5 ? "[^note]" : "[^unclosed");
        } else if (choice < 0.8) {
          parts.push(
            Math.random() > 0.5 ? "[link](url)" : "[link](unclosed"
          );
        } else if (choice < 0.9) {
          parts.push(Math.random() > 0.5 ? "[[ref]]" : "[[unclosed");
        } else {
          parts.push("`code`");
        }
      }

      return parts.join(" ");
    }

    test("random directive generation never crashes", () => {
      for (let i = 0; i < 500; i++) {
        const directive = generateRandomDirective();
        expect(() => parseSource(directive)).not.toThrow();
      }
    });

    test("random paragraph generation never crashes", () => {
      for (let i = 0; i < 500; i++) {
        const paragraph = generateRandomParagraph();
        expect(() => parseSource(paragraph)).not.toThrow();
      }
    });

    test("random document generation never crashes", () => {
      for (let i = 0; i < 100; i++) {
        let doc = "";
        const blockCount = Math.floor(Math.random() * 10) + 1;

        for (let j = 0; j < blockCount; j++) {
          const choice = Math.random();
          if (choice < 0.3) {
            doc += generateRandomDirective() + "\n\n";
          } else if (choice < 0.6) {
            doc += generateRandomParagraph() + "\n\n";
          } else if (choice < 0.7) {
            doc += "#".repeat(Math.floor(Math.random() * 4) + 1) + " Heading\n\n";
          } else if (choice < 0.8) {
            doc += "- List item\n- Another item\n\n";
          } else if (choice < 0.9) {
            doc += "> Blockquote content\n\n";
          } else {
            doc += "---\n\n";
          }
        }

        expect(() => parseSource(doc)).not.toThrow();
      }
    });
  });

  describe("result integrity", () => {
    test("all results have valid CST structure", () => {
      const inputs = [
        "",
        "   ",
        "\n\n\n",
        "@broken(",
        "{{unclosed",
        "**bold",
        "!@#$%",
        "normal text",
        "@define(x)\n  body",
      ];

      for (const input of inputs) {
        const result = parseSource(input);

        // CST structure
        expect(result).toHaveProperty("cst");
        expect(result).toHaveProperty("diagnostics");
        expect(result.cst.type).toBe("Document");
        expect(Array.isArray(result.cst.children)).toBe(true);
        expect(Array.isArray(result.diagnostics)).toBe(true);

        // Location data
        expect(result.cst.loc).toBeDefined();
        expect(typeof result.cst.loc.line).toBe("number");
        expect(typeof result.cst.loc.column).toBe("number");

        // All children have valid structure
        for (const child of result.cst.children) {
          expect(child).toHaveProperty("type");
          expect(child).toHaveProperty("loc");
        }
      }
    });
  });
});
