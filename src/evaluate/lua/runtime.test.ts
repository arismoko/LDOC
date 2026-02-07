/**
 * Tests for the Lua runtime (wasmoon integration).
 */

import { describe, test, expect } from "bun:test";
import { createEnv, evaluate, execute } from "./runtime.ts";

describe("Lua runtime", () => {
  test("evaluate: return 1 + 1 returns 2", async () => {
    const engine = await createEnv();
    const result = await evaluate(engine, "1 + 1");
    expect(result).toBe(2);
  });

  test("evaluate: access data global", async () => {
    const engine = await createEnv({ name: "Alice" });
    const result = await evaluate(engine, "data.name");
    expect(result).toBe("Alice");
  });

  test("execute: defs.x = 10 updates defs object", async () => {
    const defs: Record<string, unknown> = {};
    const engine = await createEnv({}, defs);
    await execute(engine, "defs.x = 10");

    // Verify the update is visible from the Lua side
    const result = await evaluate(engine, "defs.x");
    expect(result).toBe(10);
  });

  test("evaluate: string concatenation", async () => {
    const engine = await createEnv({ letter: "A" });
    const result = await evaluate(engine, '"EXHIBIT " .. data.letter');
    expect(result).toBe("EXHIBIT A");
  });

  test("evaluate: nil for missing keys", async () => {
    const engine = await createEnv();
    const result = await evaluate(engine, "data.nonexistent");
    expect(result).toBeNil();
  });

  test("execute: multiple statements", async () => {
    const defs: Record<string, unknown> = {};
    const engine = await createEnv({}, defs);
    await execute(engine, `
      defs.a = 1
      defs.b = 2
      defs.sum = defs.a + defs.b
    `);
    const result = await evaluate(engine, "defs.sum");
    expect(result).toBe(3);
  });
});
