/**
 * LSP Server - Main entry point for the Language Server.
 *
 * Wires together:
 * - Document management (TextDocuments)
 * - Parsing and binding (parseSource, bind)
 * - LSP handlers (completion, definition, references)
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import type { Document, Directive, ParseResult } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseSource } from "../parse/index.ts";
import { bindSync } from "../bind/index.ts";
import { compileToDocument, parseAndBind, parseAndBindWithIncludes } from "../pipeline/index.ts";
import { toLspDiagnostics } from "./diagnostics.ts";
import { getCompletionContext, getCompletionItems } from "./completion.ts";
import { getDefinition, getReferences } from "./navigation.ts";

// =============================================================================
// Document Cache
// =============================================================================

interface DocumentCache {
  cst: Document;
  symbols: SymbolTable;
}

const cache = new Map<string, DocumentCache>();

function sourcePathFromUri(uri: string): string | undefined {
  try {
    const parsed = URI.parse(uri);
    if (parsed.scheme !== "file") {
      return undefined;
    }
    return parsed.fsPath;
  } catch {
    return undefined;
  }
}

// =============================================================================
// Server Setup
// =============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// =============================================================================
// Initialization
// =============================================================================

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ["@", "{", "[", "|"],
      },
      definitionProvider: true,
      referencesProvider: true,
    },
  };
});

// =============================================================================
// Document Synchronization
// =============================================================================

documents.onDidChangeContent(async (change) => {
  const uri = change.document.uri;
  const text = change.document.getText();
  let cst: Document | undefined;
  let symbols: SymbolTable | undefined;
  let diagnostics = [] as ReturnType<typeof parseSource>["diagnostics"];

  try {
    const sourcePath = sourcePathFromUri(uri);
    const parseBind = sourcePath
      ? await parseAndBindWithIncludes(text, { sourcePath })
      : parseAndBind(text);
    cst = parseBind.cst;
    symbols = parseBind.symbols;

    const evalResult = await compileToDocument(text, sourcePath ? { sourcePath } : {});
    diagnostics = evalResult.diagnostics;
  } catch {
    const parseResult = parseSource(text);
    diagnostics = [...parseResult.diagnostics];

    const parseErrors = parseResult.diagnostics.filter((diag) => diag.severity === "error");
    if (parseErrors.length === 0) {
      const bindResult = bindSync(parseResult.cst);
      diagnostics.push(...bindResult.diagnostics);

      const bindErrors = bindResult.diagnostics.filter((diag) => diag.severity === "error");
      if (bindErrors.length === 0) {
        cst = parseResult.cst;
        symbols = bindResult.symbols;
      }
    }
  }

  if (cst && symbols) {
    cache.set(uri, { cst, symbols });
  } else {
    cache.delete(uri);
  }

  connection.sendDiagnostics({ uri, diagnostics: toLspDiagnostics(diagnostics) });
});

documents.onDidClose((event) => {
  // Clean up cache when document is closed
  cache.delete(event.document.uri);
  // Clear diagnostics
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: [],
  });
});

// =============================================================================
// Completion
// =============================================================================

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  const cached = cache.get(params.textDocument.uri);
  if (!doc || !cached) return [];

  const ctx = getCompletionContext(cached.cst, params.position, doc.getText());
  return getCompletionItems(ctx, cached.symbols, { snippetSupport: true });
});

// =============================================================================
// Go to Definition
// =============================================================================

connection.onDefinition((params) => {
  const cached = cache.get(params.textDocument.uri);
  if (!cached) return null;

  return getDefinition(
    { cst: cached.cst, symbols: cached.symbols, uri: params.textDocument.uri },
    params.position
  );
});

// =============================================================================
// Find References
// =============================================================================

connection.onReferences((params) => {
  const cached = cache.get(params.textDocument.uri);
  if (!cached) return [];

  return getReferences(
    { cst: cached.cst, symbols: cached.symbols, uri: params.textDocument.uri },
    params.position,
    params.context.includeDeclaration
  );
});

// =============================================================================
// Server Lifecycle
// =============================================================================

/**
 * Start the LSP server.
 * This connects the document manager and connection, then starts listening.
 */
export function startServer(): void {
  documents.listen(connection);
  connection.listen();
}
