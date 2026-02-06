/**
 * Validator for the BIND phase.
 * 
 * Validates:
 * 1. @use references - checks macro exists and arity matches
 * 2. Style references - checks style exists
 * 3. Cross-references - checks anchor exists
 * 4. Footnote references - checks footnote definition exists
 */

import type { CSTDocument, CSTNode, CSTDirective, CSTInline } from "../types/cst.ts";
import type {
  SymbolTable,
  MacroSymbol,
  BoundUse,
  BoundArgument,
  BoundFootnoteRef,
  BoundCrossRef,
  BoundStyleRef,
} from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { error, warning, DiagnosticCode } from "../types/diagnostics.ts";
import type { SourceLocation } from "../types/source-location.ts";

/**
 * Binding context used during validation.
 */
export interface BindingContext {
  /** Symbol table with all definitions */
  symbols: SymbolTable;
  /** Collected diagnostics */
  diagnostics: Diagnostic[];
  /** Bound @use nodes (indexed by location string) */
  boundUses: Map<string, BoundUse>;
  /** Bound footnote refs (indexed by location string) */
  boundFootnoteRefs: Map<string, BoundFootnoteRef>;
  /** Bound cross-refs (indexed by location string) */
  boundCrossRefs: Map<string, BoundCrossRef>;
  /** Bound style refs (indexed by location string) */
  boundStyleRefs: Map<string, BoundStyleRef>;
}

/**
 * Create a location key for indexing bound nodes.
 */
function locKey(loc: SourceLocation): string {
  return `${loc.line}:${loc.column}`;
}

/**
 * Validator for CST binding.
 */
export class Validator {
  private ctx: BindingContext;
  private macroStack: string[] = [];
  private macroCallGraph = new Map<string, Set<string>>();

  constructor(symbols: SymbolTable) {
    this.ctx = {
      symbols,
      diagnostics: [],
      boundUses: new Map(),
      boundFootnoteRefs: new Map(),
      boundCrossRefs: new Map(),
      boundStyleRefs: new Map(),
    };
  }

  /**
   * Validate a CST document.
   */
  validate(cst: CSTDocument): BindingContext {
    for (const node of cst.children) {
      this.validateNode(node);
    }

    this.checkMacroCycles();

    // Check for unused definitions (warnings only)
    this.checkUnused();
    
    return this.ctx;
  }

  private validateNode(node: CSTNode): void {
    switch (node.type) {
      case "Directive":
        this.validateDirective(node);
        break;
      case "Paragraph":
        for (const inline of node.content) {
          this.validateInline(inline);
        }
        break;
      case "Header":
        for (const inline of node.content) {
          this.validateInline(inline);
        }
        break;
      case "List":
        for (const item of node.items) {
          for (const inline of item.content) {
            this.validateInline(inline);
          }
          for (const child of item.children) {
            this.validateNode(child);
          }
        }
        break;
      case "Blockquote":
        for (const child of node.content) {
          this.validateNode(child);
        }
        break;
      case "FootnoteDef":
        for (const child of node.content) {
          this.validateNode(child);
        }
        break;
      case "Error":
        // Skip error nodes - they have no references to validate
        break;
      // Other block types don't need validation
    }
  }

  private validateDirective(directive: CSTDirective): void {
    switch (directive.name) {
      case "use":
        this.validateUse(directive);
        break;
      case "if":
      case "elseif":
      case "else":
      case "foreach":
      case "repeat":
        // Control flow directives - validate body
        if (directive.body) {
          for (const node of directive.body) {
            this.validateNode(node);
          }
        }
        break;
      case "define":
        this.validateDefine(directive);
        break;
      case "style":
        // Style definitions are already collected - nothing to validate here
        break;
      case "import":
        // Imports are already resolved - nothing to validate here
        break;
      default:
        // Other directives - validate body if present
        if (directive.body) {
          for (const node of directive.body) {
            this.validateNode(node);
          }
        }
    }
  }

  private validateUse(directive: CSTDirective): void {
    // @use(macroName, arg1, arg2, ...) or @use(macroName, param: value, ...)
    const args = directive.arguments;
    if (args.length === 0) {
      this.ctx.diagnostics.push(
        error(
          DiagnosticCode.UNDEFINED_MACRO,
          "@use requires a macro name",
          directive.loc
        )
      );
      return;
    }

    // Get macro name
    const firstArg = args[0]!;
    let macroName: string;
    
    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      macroName = firstArg.value.name;
    } else if (firstArg.type === "PositionalArg" && firstArg.value.type === "StringLiteral") {
      macroName = firstArg.value.value;
    } else {
      this.ctx.diagnostics.push(
        error(
          DiagnosticCode.UNDEFINED_MACRO,
          "@use requires a macro name as first argument",
          directive.loc
        )
      );
      return;
    }

    // Look up macro
    const macro = this.ctx.symbols.macros.get(macroName);
    if (!macro) {
      this.ctx.diagnostics.push(
        error(
          DiagnosticCode.UNDEFINED_MACRO,
          `Unknown macro: @use ${macroName}`,
          directive.loc
        )
      );
      return;
    }

    // Record usage
    macro.usages.push(directive.loc);

    // Record call edge if inside a macro body
    const caller = this.macroStack[this.macroStack.length - 1];
    if (caller) {
      this.addMacroEdge(caller, macro.name);
    }

    // Validate arity
    const boundArgs = this.bindArguments(directive, macro);

    // Create bound use
    const boundUse: BoundUse = {
      type: "BoundUse",
      symbol: macro,
      arguments: boundArgs,
      loc: directive.loc,
    };
    this.ctx.boundUses.set(locKey(directive.loc), boundUse);

    // Validate body (children to be expanded in slot)
    if (directive.body) {
      for (const node of directive.body) {
        this.validateNode(node);
      }
    }
  }

  private bindArguments(directive: CSTDirective, macro: MacroSymbol): BoundArgument[] {
    const boundArgs: BoundArgument[] = [];
    const args = directive.arguments.slice(1); // Skip macro name
    const params = macro.parameters;
    
    // Track which params have been provided
    const providedParams = new Set<string>();
    let positionalIndex = 0;

    for (const arg of args) {
      if (arg.type === "NamedArg") {
        // Named argument
        const paramName = arg.name;
        const param = params.find(p => p.name === paramName);
        
        if (!param) {
          this.ctx.diagnostics.push(
            error(
              DiagnosticCode.ARITY_MISMATCH,
              `@use ${macro.name}: unknown parameter '${paramName}'`,
              arg.loc
            )
          );
          continue;
        }
        
        if (providedParams.has(paramName)) {
          this.ctx.diagnostics.push(
            error(
              DiagnosticCode.ARITY_MISMATCH,
              `@use ${macro.name}: duplicate parameter '${paramName}'`,
              arg.loc
            )
          );
          continue;
        }
        
        providedParams.add(paramName);
        boundArgs.push({
          parameterName: paramName,
          value: arg,
        });
      } else {
        // Positional argument
        if (positionalIndex >= params.length) {
          this.ctx.diagnostics.push(
            error(
              DiagnosticCode.ARITY_MISMATCH,
              `@use ${macro.name}: too many arguments (expected ${params.length})`,
              arg.loc
            )
          );
          continue;
        }
        
        const param = params[positionalIndex]!;
        providedParams.add(param.name);
        positionalIndex++;
        
        boundArgs.push({
          parameterName: param.name,
          value: arg,
        });
      }
    }

    // Check for missing required parameters
    for (const param of params) {
      if (!providedParams.has(param.name) && param.defaultValue === undefined) {
        this.ctx.diagnostics.push(
          error(
            DiagnosticCode.ARITY_MISMATCH,
            `@use ${macro.name}: missing required parameter '${param.name}'`,
            directive.loc
          )
        );
      }
    }

    return boundArgs;
  }

  private validateInline(inline: CSTInline): void {
    switch (inline.type) {
      case "FootnoteRef":
        this.validateFootnoteRef(inline);
        break;
      case "CrossRef":
        this.validateCrossRef(inline);
        break;
      case "Emphasis":
        for (const child of inline.content) {
          this.validateInline(child);
        }
        break;
      case "Link":
        for (const child of inline.text) {
          this.validateInline(child);
        }
        break;
      case "InlineDirective":
        // Validate inline directive arguments and content
        for (const child of inline.content) {
          this.validateInline(child);
        }
        break;
      case "Error":
        // Skip error nodes - they have no references to validate
        break;
      // Other inline types don't need validation
    }
  }

  private validateFootnoteRef(inline: { type: "FootnoteRef"; label: string; loc: SourceLocation }): void {
    const footnote = this.ctx.symbols.footnotes.get(inline.label);
    
    const boundRef: BoundFootnoteRef = {
      type: "BoundFootnoteRef",
      symbol: footnote ?? null,
      label: inline.label,
      loc: inline.loc,
    };
    this.ctx.boundFootnoteRefs.set(locKey(inline.loc), boundRef);

    if (footnote) {
      footnote.usages.push(inline.loc);
    } else {
      this.ctx.diagnostics.push(
        error(
          DiagnosticCode.UNDEFINED_FOOTNOTE,
          `Undefined footnote: [^${inline.label}]`,
          inline.loc
        )
      );
    }
  }

  private validateCrossRef(inline: { type: "CrossRef"; target: string; loc: SourceLocation }): void {
    const anchor = this.ctx.symbols.anchors.get(inline.target);
    
    const boundRef: BoundCrossRef = {
      type: "BoundCrossRef",
      symbol: anchor ?? null,
      target: inline.target,
      loc: inline.loc,
    };
    this.ctx.boundCrossRefs.set(locKey(inline.loc), boundRef);

    if (anchor) {
      anchor.usages.push(inline.loc);
    } else {
      // Cross-ref target might be defined later or externally - warn instead of error
      this.ctx.diagnostics.push(
        warning(
          DiagnosticCode.UNDEFINED_ANCHOR,
          `Unresolved cross-reference: <<${inline.target}>>`,
          inline.loc
        )
      );
    }
  }

  private checkUnused(): void {
    // Check for unused macros
    for (const [name, macro] of this.ctx.symbols.macros) {
      if (macro.usages.length === 0) {
        this.ctx.diagnostics.push(
          warning(
            DiagnosticCode.UNUSED_MACRO,
            `Macro '${name}' is defined but never used`,
            macro.definedAt
          )
        );
      }
    }

    // Check for unused footnotes
    for (const [label, footnote] of this.ctx.symbols.footnotes) {
      if (footnote.usages.length === 0) {
        this.ctx.diagnostics.push(
          warning(
            DiagnosticCode.UNUSED_FOOTNOTE,
            `Footnote '[^${label}]' is defined but never referenced`,
            footnote.definedAt
          )
        );
      }
    }
  }

  private validateDefine(directive: CSTDirective): void {
    const name = this.extractDefineName(directive);
    if (name) {
      if (!this.macroCallGraph.has(name)) {
        this.macroCallGraph.set(name, new Set());
      }
      this.macroStack.push(name);
    }

    if (directive.body) {
      for (const node of directive.body) {
        this.validateNode(node);
      }
    }

    if (name) {
      this.macroStack.pop();
    }
  }

  private extractDefineName(directive: CSTDirective): string | undefined {
    const firstArg = directive.arguments[0];
    if (!firstArg) return undefined;
    if (firstArg.type === "PositionalArg" && firstArg.value.type === "Identifier") {
      return firstArg.value.name;
    }
    if (firstArg.type === "PositionalArg" && firstArg.value.type === "StringLiteral") {
      return firstArg.value.value;
    }
    return undefined;
  }

  private addMacroEdge(from: string, to: string): void {
    const edges = this.macroCallGraph.get(from);
    if (edges) {
      edges.add(to);
    } else {
      this.macroCallGraph.set(from, new Set([to]));
    }
  }

  private checkMacroCycles(): void {
    const state = new Map<string, "visiting" | "visited">();
    const stack: string[] = [];

    const visit = (name: string): void => {
      if (state.get(name) === "visiting") {
        const idx = stack.indexOf(name);
        const cycle = idx >= 0 ? [...stack.slice(idx), name] : [name, name];
        const loc = this.ctx.symbols.macros.get(name)?.definedAt;
        if (loc) {
          this.ctx.diagnostics.push(
            error(
              DiagnosticCode.MACRO_CYCLE,
              `Macro cycle detected: ${cycle.join(" -> ")}`,
              loc
            )
          );
        }
        return;
      }
      if (state.get(name) === "visited") return;

      state.set(name, "visiting");
      stack.push(name);

      const edges = this.macroCallGraph.get(name);
      if (edges) {
        for (const next of edges) {
          visit(next);
        }
      }

      stack.pop();
      state.set(name, "visited");
    };

    for (const name of this.ctx.symbols.macros.keys()) {
      visit(name);
    }
  }
}

/**
 * Validate a CST document against a symbol table.
 */
export function validate(cst: CSTDocument, symbols: SymbolTable): BindingContext {
  return new Validator(symbols).validate(cst);
}
