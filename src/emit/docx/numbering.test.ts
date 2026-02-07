import { describe, test, expect } from "bun:test";
import { createNumberingConfig } from "./numbering.ts";
import { LevelFormat } from "docx";

describe("numbering config", () => {
  test("default mode creates tiered decimal levels", () => {
    const config = createNumberingConfig([]);
    const ordered = config.config.find(c => c.reference === "ordered-decimal");
    expect(ordered).toBeDefined();
    // All levels should be decimal in tiered mode
    const levels = ordered!.levels;
    expect(levels[0]!.format).toBe(LevelFormat.DECIMAL);
    expect(levels[1]!.format).toBe(LevelFormat.DECIMAL);
    // Check tiered text patterns
    expect(levels[0]!.text).toBe("%1.");
    expect(levels[1]!.text).toBe("%1.%2.");
    expect(levels[2]!.text).toBe("%1.%2.%3.");
  });

  test("legal mode creates alternating format levels", () => {
    const config = createNumberingConfig([], "legal");
    const legal = config.config.find(c => c.reference === "ordered-legal");
    expect(legal).toBeDefined();
    const levels = legal!.levels;
    expect(levels[0]!.format).toBe(LevelFormat.DECIMAL);       // 1.
    expect(levels[1]!.format).toBe(LevelFormat.LOWER_LETTER);  // (a)
    expect(levels[2]!.format).toBe(LevelFormat.LOWER_ROMAN);   // (i)
    expect(levels[3]!.format).toBe(LevelFormat.UPPER_LETTER);  // (A)
  });

  test("both ordered-decimal and ordered-legal are always created", () => {
    const config = createNumberingConfig([]);
    const decimal = config.config.find(c => c.reference === "ordered-decimal");
    const legal = config.config.find(c => c.reference === "ordered-legal");
    expect(decimal).toBeDefined();
    expect(legal).toBeDefined();
  });

  test("bullets config is created", () => {
    const config = createNumberingConfig([]);
    const bullets = config.config.find(c => c.reference === "bullets");
    expect(bullets).toBeDefined();
    expect(bullets!.levels[0]!.format).toBe(LevelFormat.BULLET);
  });
});
