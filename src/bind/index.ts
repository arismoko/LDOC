/**
 * Phase 2: BIND
 * 
 * Resolves imports, builds symbol table, links references.
 * 
 * Input: CST from Phase 1
 * Output: BindResult (CST + SymbolTable + Diagnostics)
 */

export { Binder, bind, bindSync, type BinderOptions } from "./binder.ts";
export { ImportResolver, resolveImports, type ResolverOptions, type ResolveResult } from "./resolver.ts";
export { Validator, validate, type BindingContext } from "./validator.ts";
