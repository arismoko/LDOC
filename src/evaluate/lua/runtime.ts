/**
 * Lua runtime for LDOC v3 — powered by wasmoon (Lua 5.4 via WASM).
 *
 * Provides:
 *  - createEnv(): initialise a sandboxed Lua engine with `data`, `defs`, `styles` globals
 *  - evaluate():  run a Lua expression and return its value
 *  - execute():   run a Lua statement chunk (e.g. @lua{} bodies)
 */

import { LuaFactory, LuaEngine } from "wasmoon";

// ---------------------------------------------------------------------------
// Execution Limits
// ---------------------------------------------------------------------------

/**
 * Default timeout for Lua execution in milliseconds.
 * Prevents infinite loops from freezing the compiler.
 */
const TIMEOUT_MS = 5000;

/**
 * Wrap a promise with a wall-clock timeout.
 *
 * Note: wasmoon uses a Lua debug hook for timeouts (functionTimeout option),
 * which properly interrupts infinite loops. This Promise.race is a fallback
 * for any async operations that might not be covered by the hook.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Lua ${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ---------------------------------------------------------------------------
// Singleton factory — one WASM module shared across all engines
// ---------------------------------------------------------------------------

let factoryPromise: Promise<LuaFactory> | null = null;

function getFactory(): Promise<LuaFactory> {
  if (!factoryPromise) {
    factoryPromise = Promise.resolve(new LuaFactory());
  }
  return factoryPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a sandboxed Lua engine pre-populated with LDOC globals.
 *
 * `defs` is passed by reference — Lua modifications to `defs` fields
 * are visible on the JS side (wasmoon proxies tables ↔ objects).
 */
export async function createEnv(
  data: unknown = {},
  defs: Record<string, unknown> = {},
  styles: Record<string, unknown> = {},
): Promise<LuaEngine> {
  const factory = await getFactory();
  const engine = await factory.createEngine({
    injectObjects: true,   // allow JS ↔ Lua object proxying
    enableProxy: true,     // enable proxy-based table access
    functionTimeout: TIMEOUT_MS, // interrupt infinite loops via debug hook
  });

  // Expose globals
  engine.global.set("data", data);
  engine.global.set("defs", defs);
  engine.global.set("styles", styles);

  return engine;
}

/**
 * Evaluate a Lua **expression** and return its value.
 *
 * The expression is wrapped as `return (<expr>)` so callers pass
 * bare expressions (e.g. `"1 + 1"`, `"data.name"`).
 *
 * Has a wall-clock timeout as a fallback (in addition to wasmoon's
 * debug hook timeout configured in createEnv).
 */
export async function evaluate(
  engine: LuaEngine,
  expression: string,
): Promise<unknown> {
  return withTimeout(
    engine.doString(`return (${expression})`),
    TIMEOUT_MS,
    "expression",
  );
}

/**
 * Execute a Lua **statement chunk** (no implicit return).
 *
 * Used for `@lua{ ... }` blocks.
 *
 * Has a wall-clock timeout as a fallback (in addition to wasmoon's
 * debug hook timeout configured in createEnv).
 */
export async function execute(
  engine: LuaEngine,
  chunk: string,
): Promise<void> {
  await withTimeout(engine.doString(chunk), TIMEOUT_MS, "block");
}
