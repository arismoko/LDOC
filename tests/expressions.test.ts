import { describe, test, expect } from "bun:test";
import { evalCond } from "../src/compiler/conditions";

describe("Rich Expressions", () => {
  const ctx = {
    age: 25,
    score: 80,
    name: "Alice",
    isAdmin: true,
    items: [1, 2, 3],
  };
  const globals = {};

  test("Basic equality (existing)", () => {
    expect(evalCond("age == 25", ctx, globals)).toBe(true);
    expect(evalCond("name == 'Alice'", ctx, globals)).toBe(true);
    expect(evalCond("age != 30", ctx, globals)).toBe(true);
  });

  test("Comparison operators", () => {
    expect(evalCond("age > 18", ctx, globals)).toBe(true);
    expect(evalCond("age >= 25", ctx, globals)).toBe(true);
    expect(evalCond("score < 90", ctx, globals)).toBe(true);
    expect(evalCond("score <= 80", ctx, globals)).toBe(true);
    expect(evalCond("age > 100", ctx, globals)).toBe(false);
  });

  test("Logical operators", () => {
    expect(evalCond("age > 18 && isAdmin", ctx, globals)).toBe(true);
    expect(evalCond("age < 18 || isAdmin", ctx, globals)).toBe(true);
    expect(evalCond("age < 18 && isAdmin", ctx, globals)).toBe(false);
    expect(evalCond("age > 18 && score > 90", ctx, globals)).toBe(false);
  });

  test("Arithmetic", () => {
    expect(evalCond("age + 5 == 30", ctx, globals)).toBe(true);
    expect(evalCond("score - 10 == 70", ctx, globals)).toBe(true);
    expect(evalCond("age * 2 == 50", ctx, globals)).toBe(true);
    expect(evalCond("score / 2 == 40", ctx, globals)).toBe(true);
  });

  test("Complex grouping", () => {
    expect(evalCond("(age > 18) && (score > 50 || isAdmin)", ctx, globals)).toBe(true);
    expect(evalCond("(age + 5) * 2 == 60", ctx, globals)).toBe(true);
  });
});
