/**
 * Visual Layout Verification Tests
 *
 * These tests use LibreOffice (headless) to convert DOCX to HTML,
 * then verify that the rendered structure proves columns are side-by-side.
 *
 * Strategy:
 * - Top-level @columns use native Word sections → CSS column-count in HTML
 * - Nested @columns use tables → <table> elements in HTML
 *
 * We verify both structures to prove correct layout.
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { writeFile, readFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Parser } from "../src/parser/parser";
import { compile } from "../src/compiler";

// Timeout for slow tests (LibreOffice conversion can take a few seconds)
const SLOW_TIMEOUT = 30_000;

/**
 * Convert a DOCX buffer to HTML using LibreOffice headless
 */
async function docxToHtml(docxBuffer: Uint8Array): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `ldoc-visual-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    await mkdir(tempDir, { recursive: true });

    const inputPath = join(tempDir, "input.docx");
    await writeFile(inputPath, docxBuffer);

    // Convert to HTML using LibreOffice headless
    const proc = Bun.spawn(
      [
        "libreoffice",
        "--headless",
        "--convert-to",
        "html",
        "--outdir",
        tempDir,
        inputPath,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          // Prevent LibreOffice from trying to access user profile
          HOME: tempDir,
        },
      }
    );

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `LibreOffice conversion failed (exit ${exitCode}): ${stderr}`
      );
    }

    // Find the output HTML file
    const files = await readdir(tempDir);
    const htmlFile = files.find((f) => f.endsWith(".html"));

    if (!htmlFile) {
      throw new Error("LibreOffice did not produce an HTML file");
    }

    const htmlPath = join(tempDir, htmlFile);
    return await readFile(htmlPath, "utf-8");
  } finally {
    // Cleanup
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Parse HTML and extract table structure for analysis
 */
function parseTableStructure(html: string): TableInfo[] {
  const tables: TableInfo[] = [];

  // Simple regex-based parser for table structure
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1] ?? "";
    const rows: RowInfo[] = [];

    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = trRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1] ?? "";
      const cells: CellInfo[] = [];

      // Match both td and th
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const cellHtml = cellMatch[1] ?? "";
        // Extract text content (strip HTML tags)
        const textContent = cellHtml.replace(/<[^>]+>/g, "").trim();
        cells.push({ html: cellHtml, text: textContent });
      }

      if (cells.length > 0) {
        rows.push({ cells });
      }
    }

    if (rows.length > 0) {
      tables.push({ rows });
    }
  }

  return tables;
}

/**
 * Parse CSS multi-column sections from HTML
 * LibreOffice outputs divs with column-count CSS for Word's native columns
 */
function parseColumnSections(html: string): ColumnSectionInfo[] {
  const sections: ColumnSectionInfo[] = [];

  // Match divs with column-count style (LibreOffice format)
  // LibreOffice uses: style="column-count: N" or gutter="X" column-count="N"
  const divRegex =
    /<div[^>]*?(?:column-count:\s*(\d+)|column-count\s*=\s*["']?(\d+))[^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = divRegex.exec(html)) !== null) {
    const columnCount = parseInt(match[1] ?? match[2] ?? "1", 10);
    const content = match[3] ?? "";

    // Extract text content (strip all HTML tags)
    const textContent = content.replace(/<[^>]+>/g, " ").trim();

    // Split by common paragraph separators to find distinct content blocks
    const contentBlocks = textContent
      .split(/\s{2,}/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    sections.push({
      columnCount,
      html: content,
      textContent,
      contentBlocks,
    });
  }

  return sections;
}

interface CellInfo {
  html: string;
  text: string;
}

interface RowInfo {
  cells: CellInfo[];
}

interface TableInfo {
  rows: RowInfo[];
}

interface ColumnSectionInfo {
  columnCount: number;
  html: string;
  textContent: string;
  contentBlocks: string[];
}

/**
 * Find a table row where all specified texts appear in different cells
 * This proves the texts are side-by-side in the layout
 */
function findRowWithSideBySideTexts(
  tables: TableInfo[],
  ...texts: string[]
): { table: TableInfo; row: RowInfo } | null {
  for (const table of tables) {
    for (const row of table.rows) {
      const cellTexts = row.cells.map((c) => c.text);

      // Check if each text appears in at least one cell
      const allFound = texts.every((text) =>
        cellTexts.some((cellText) => cellText.includes(text))
      );

      // Check that they're in DIFFERENT cells (truly side-by-side)
      if (allFound && row.cells.length >= texts.length) {
        const matchedCellIndices = texts.map((text) =>
          cellTexts.findIndex((ct) => ct.includes(text))
        );
        const uniqueIndices = new Set(matchedCellIndices);

        // All texts must be in different cells
        if (uniqueIndices.size === texts.length) {
          return { table, row };
        }
      }
    }
  }
  return null;
}

describe("Visual Layout Verification", () => {
  // Skip all tests if LibreOffice is not available
  let libreofficeAvailable = false;

  beforeAll(async () => {
    try {
      const proc = Bun.spawn(["which", "libreoffice"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      libreofficeAvailable = proc.exitCode === 0;
    } catch {
      libreofficeAvailable = false;
    }

    if (!libreofficeAvailable) {
      console.warn(
        "⚠️  LibreOffice not found. Visual layout tests will be skipped."
      );
    }
  });

  test(
    "2-column layout uses CSS columns (proves multi-column rendering)",
    async () => {
      if (!libreofficeAvailable) {
        console.log("Skipping: LibreOffice not available");
        return;
      }

      const input = `
@columns 2
LEFT_COLUMN_MARKER
@break
RIGHT_COLUMN_MARKER
@end
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);

      // Top-level columns should render as CSS columns (column-count)
      const columnSections = parseColumnSections(html);

      // We should have at least one 2-column section
      expect(columnSections.length).toBeGreaterThanOrEqual(1);

      const twoColSection = columnSections.find((s) => s.columnCount === 2);
      expect(twoColSection).toBeDefined();

      if (twoColSection) {
        // Both markers should be in the same section
        expect(twoColSection.textContent).toContain("LEFT_COLUMN_MARKER");
        expect(twoColSection.textContent).toContain("RIGHT_COLUMN_MARKER");

        // Verify column-count is exactly 2 (proves side-by-side layout)
        expect(twoColSection.columnCount).toBe(2);
      }
    },
    SLOW_TIMEOUT
  );

  test(
    "3-column layout renders with column-count 3",
    async () => {
      if (!libreofficeAvailable) {
        console.log("Skipping: LibreOffice not available");
        return;
      }

      const input = `
@columns 3
FIRST_COL
@break
SECOND_COL
@break
THIRD_COL
@end
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);
      const columnSections = parseColumnSections(html);

      expect(columnSections.length).toBeGreaterThanOrEqual(1);

      const threeColSection = columnSections.find((s) => s.columnCount === 3);
      expect(threeColSection).toBeDefined();

      if (threeColSection) {
        expect(threeColSection.textContent).toContain("FIRST_COL");
        expect(threeColSection.textContent).toContain("SECOND_COL");
        expect(threeColSection.textContent).toContain("THIRD_COL");
        expect(threeColSection.columnCount).toBe(3);
      }
    },
    SLOW_TIMEOUT
  );

  test(
    "mixed content with columns preserves structure",
    async () => {
      if (!libreofficeAvailable) {
        console.log("Skipping: LibreOffice not available");
        return;
      }

      const input = `
This is a paragraph BEFORE the columns.

@columns 2
Column 1 has MARKER_A content.
@break
Column 2 has MARKER_B content.
@end

This is a paragraph AFTER the columns.
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);

      // Verify BEFORE and AFTER text appear in the document
      expect(html).toContain("BEFORE");
      expect(html).toContain("AFTER");

      // Verify column section exists with both markers
      const columnSections = parseColumnSections(html);
      const twoColSection = columnSections.find((s) => s.columnCount === 2);
      expect(twoColSection).toBeDefined();

      if (twoColSection) {
        expect(twoColSection.textContent).toContain("MARKER_A");
        expect(twoColSection.textContent).toContain("MARKER_B");
      }
    },
    SLOW_TIMEOUT
  );

  test(
    "multi-paragraph columns maintain all content",
    async () => {
      if (!libreofficeAvailable) {
        console.log("Skipping: LibreOffice not available");
        return;
      }

      const input = `
@columns 2
LEFTCOL_LINE1

LEFTCOL_LINE2
@break
RIGHTCOL_LINE1

RIGHTCOL_LINE2
@end
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);
      const columnSections = parseColumnSections(html);

      const twoColSection = columnSections.find((s) => s.columnCount === 2);
      expect(twoColSection).toBeDefined();

      if (twoColSection) {
        // All four content pieces should be present
        expect(twoColSection.textContent).toContain("LEFTCOL_LINE1");
        expect(twoColSection.textContent).toContain("LEFTCOL_LINE2");
        expect(twoColSection.textContent).toContain("RIGHTCOL_LINE1");
        expect(twoColSection.textContent).toContain("RIGHTCOL_LINE2");
      }
    },
    SLOW_TIMEOUT
  );
});

describe("Nested Columns Visual Verification", () => {
  let libreofficeAvailable = false;

  beforeAll(async () => {
    try {
      const proc = Bun.spawn(["which", "libreoffice"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      libreofficeAvailable = proc.exitCode === 0;
    } catch {
      libreofficeAvailable = false;
    }
  });

  test(
    "columns inside list still render as CSS columns with correct count",
    async () => {
      if (!libreofficeAvailable) {
        console.log("Skipping: LibreOffice not available");
        return;
      }

      // When columns are inside a list, they're parsed as siblings at top-level
      // and still use native Word columns (which become CSS columns in HTML)
      const input = `
- Item with nested columns:
  @columns 2
  NESTED_LEFT
  @break
  NESTED_RIGHT
  @end
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);
      const columnSections = parseColumnSections(html);

      // Should have a 2-column section
      const twoColSection = columnSections.find((s) => s.columnCount === 2);
      expect(twoColSection).toBeDefined();

      if (twoColSection) {
        expect(twoColSection.textContent).toContain("NESTED_LEFT");
        expect(twoColSection.textContent).toContain("NESTED_RIGHT");
        expect(twoColSection.columnCount).toBe(2);
      }
    },
    SLOW_TIMEOUT
  );

  // Note: Truly nested columns (columns inside columns) would render as tables,
  // but that's tested in nested_columns_autofit.test.ts via the internal API
});

describe("Layout Verification - Diagnostic", () => {
  test(
    "DEBUG: show raw HTML structure for columns",
    async () => {
      const proc = Bun.spawn(["which", "libreoffice"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      if (proc.exitCode !== 0) {
        console.log("Skipping diagnostic: LibreOffice not available");
        return;
      }

      const input = `
@columns 2
COL1_TEXT
@break
COL2_TEXT
@end
`;
      const parser = new Parser();
      const ast = parser.parse(input);
      const docxBuffer = await compile(ast);

      const html = await docxToHtml(docxBuffer);

      console.log("\n=== Raw HTML (first 2000 chars) ===");
      console.log(html.slice(0, 2000));

      const columnSections = parseColumnSections(html);
      const tables = parseTableStructure(html);

      console.log("\n=== Parsed Structure ===");
      console.log(`Found ${columnSections.length} CSS column section(s)`);
      for (let i = 0; i < columnSections.length; i++) {
        const sec = columnSections[i]!;
        console.log(`  Section ${i + 1}: ${sec.columnCount} columns`);
        console.log(`    Content: "${sec.textContent.slice(0, 80)}..."`);
      }

      console.log(`Found ${tables.length} HTML table(s)`);
      for (let ti = 0; ti < tables.length; ti++) {
        const table = tables[ti]!;
        console.log(`\nTable ${ti + 1}: ${table.rows.length} row(s)`);
        for (let ri = 0; ri < table.rows.length; ri++) {
          const row = table.rows[ri]!;
          console.log(`  Row ${ri + 1}: ${row.cells.length} cell(s)`);
          for (let ci = 0; ci < row.cells.length; ci++) {
            const cell = row.cells[ci]!;
            const text = cell.text.slice(0, 50);
            console.log(
              `    Cell ${ci + 1}: "${text}${text.length >= 50 ? "..." : ""}"`
            );
          }
        }
      }

      // This test always passes - it's just diagnostic
      expect(true).toBe(true);
    },
    SLOW_TIMEOUT
  );
});
