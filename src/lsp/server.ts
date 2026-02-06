/**
 * LSP Server - Main entry point for the Language Server.
 *
 * Wires together:
 * - Document management (TextDocuments)
 * - Parsing and binding (parseSource, bind)
 * - LSP handlers (completion, definition, references)
 */

import { readFile } from "node:fs/promises";
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

import type { CSTDocument, CSTDirective, ParseResult } from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import { parseSource } from "../parse/index.ts";
import { bind } from "../bind/binder.ts";
import { toLspDiagnostics } from "./diagnostics.ts";
import { getCompletionContext, getCompletionItems } from "./completion.ts";
import { getDefinition, getReferences } from "./navigation.ts";

// =============================================================================
// Document Cache
// =============================================================================

interface DocumentCache {
  cst: CSTDocument;
  symbols: SymbolTable;
}

const cache = new Map<string, DocumentCache>();

// =============================================================================
// Import Detection
// =============================================================================

/**
 * Check if a CST contains @import directives.
 */
function hasImports(cst: CSTDocument): boolean {
  for (const node of cst.children) {
    if (node.kind === "Directive" && (node as CSTDirective).name === "import") {
      return true;
    }
  }
  return false;
}

/**
 * Convert a document URI to a file system path.
 */
function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

/**
 * Load and parse a file for import resolution.
 */
async function loadFile(path: string): Promise<ParseResult> {
  const content = await readFile(path, "utf-8");
  return parseSource(content);
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

  // Parse the document
  const { cst, diagnostics: parseDiags } = parseSource(text);

  // Bind symbols - use import resolution if @import directives are present
  const binderOptions = hasImports(cst)
    ? { sourcePath: uriToPath(uri), loadFile }
    : undefined;
  
  const { symbols, diagnostics: bindDiags } = await bind(cst, binderOptions);

  // Update cache
  cache.set(uri, { cst, symbols });

  // Send diagnostics
  connection.sendDiagnostics({
    uri,
    diagnostics: toLspDiagnostics([...parseDiags, ...bindDiags]),
  });
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
