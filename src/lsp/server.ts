import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  TextEdit,
  type InitializeParams,
  type CompletionItem,
  type TextDocumentPositionParams,
  type InitializeResult,
  type Diagnostic,
  type DefinitionParams,
  type Location,
  type Range,
  type DocumentFormattingParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "../parser/parser";
import { normalizeRefKey } from "../compiler/bookmark-utils";
import type { Node } from "../parser/ast";

import { completeForContext, detectCompletionContext, type CompletionOptions } from "./completion";
import { buildDocumentIndex, nodeToLocation, type DocumentIndex } from "./indexer";

// Cache for document ASTs and symbol tables
interface DocumentInfo {
  ast: Node;
  index: DocumentIndex;
}
const documentCache = new Map<string, DocumentInfo>();

export function startServer() {
  // Create a connection for the server, using Node's IPC as a transport.
  // Also include all preview / proposed LSP features.
  // Always use stdio transport. Some runtimes (e.g. compiled Bun binaries)
  // don't set LSP transport flags like `--stdio`, so autodetection fails.
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);

  // Create a simple text document manager.
  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

  let hasConfigurationCapability = false;
  let hasWorkspaceFolderCapability = false;
  let hasDiagnosticRelatedInformationCapability = false;
  let snippetSupport = false;

  connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
      capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
      capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
      capabilities.textDocument &&
      capabilities.textDocument.publishDiagnostics &&
      capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    snippetSupport = Boolean(
      capabilities.textDocument?.completion?.completionItem?.snippetSupport
    );

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        // Tell the client that this server supports code completion.
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: ["@", "{", "[", "|", "."],
        },
        // Support Go to Definition
        definitionProvider: true,
        documentFormattingProvider: true,
      },
    };
    if (hasWorkspaceFolderCapability) {
      result.capabilities.workspace = {
        workspaceFolders: {
          supported: true,
        },
      };
    }
    return result;
  });

  connection.onInitialized(() => {
    // Avoid dynamic capability registration. Neovim commonly has
    // `dynamicRegistration=false` which otherwise logs noisy warnings.
    void hasConfigurationCapability;
    void hasWorkspaceFolderCapability;
  });

  // The content of a text document has changed. This event is emitted
  // when the text document first opened or when its content has changed.
  documents.onDidChangeContent((change) => {
    validateTextDocument(change.document, connection);
  });

  documents.onDidOpen((e) => {
    validateTextDocument(e.document, connection);
  });

  connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We received an file change event");
  });

  // This handler provides the initial list of the completion items.
  connection.onCompletion(
    (params: TextDocumentPositionParams): CompletionItem[] => {
      const uri = params.textDocument.uri;
      const doc = documents.get(uri);
      const info = documentCache.get(uri);
      if (!doc || !info) return [];

      const text = doc.getText();
      const ctx = detectCompletionContext(text, params.position);
      const options: CompletionOptions = { snippetSupport };
      return completeForContext(info.index, ctx, options);
    }
  );

  // This handler resolves additional information for the item selected in
  // the completion list.
  connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
      // Keep resolve lightweight; enrich macro items if present
      const data = isRecord(item.data) ? item.data : undefined;
      const uri = typeof data?.uri === "string" ? data.uri : undefined;
      const kind = typeof data?.kind === "string" ? data.kind : undefined;
      if (kind === "macro") {
        const name = typeof data?.name === "string" ? data.name : "";
        const docInfo = uri ? documentCache.get(uri) : undefined;
        const sig = docInfo?.index.macros.get(name);
        if (sig) {
          item.detail = `@define ${sig.name}`;
          const req = sig.requiredParams.join(", ");
          const opt = sig.optionalParams.length ? `, ${sig.optionalParams.join(", ")}` : "";
          item.documentation = `@define ${sig.name}(${req}${opt})`;
        }
      }
      return item;
    }
  );

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
  }

  connection.onDefinition((params: DefinitionParams): Location | null => {
    const uri = params.textDocument.uri;
    const info = documentCache.get(uri);
    if (!info) return null;

    const doc = documents.get(uri);
    if (!doc) return null;

    const text = doc.getText();
    const lines = text.split("\n");
    const line = lines[params.position.line] ?? "";

    // 1) Cross references: [[...]]
    const cross = extractEnclosed(line, params.position.character, "[[", "]]" );
    if (cross) {
      const hit = info.index.anchorsByKey.get(normalizeRefKey(cross));
      return hit ?? null;
    }

    // 2) Variables: {{...}}
    const variable = extractEnclosed(line, params.position.character, "{{", "}}" );
    if (variable) {
      const name = variable.split("|")[0]?.trim() ?? "";
      if (name) {
        const direct = info.index.setVariables.get(name) ?? info.index.foreachItems.get(name);
        if (direct) return direct;

        if (name.startsWith("document.")) {
          const p = name.slice("document.".length);
          if (info.index.document.pathsSet.has(p)) {
            return nodeToLocation(uri, info.index.ast, "@document".length);
          }
        }

        if (info.index.meta.pathsSet.has(name) && info.index.meta.node) {
          return nodeToLocation(uri, info.index.meta.node, "@meta".length);
        }
      }
    }

    // 3) Macro usage/definition: @use Name / @define Name
    const macroName = extractMacroNameAt(line, params.position.character);
    if (macroName) {
      const sig = info.index.macros.get(macroName);
      if (sig) return sig.location;
    }

    return null;
  });

  connection.onDocumentFormatting((params: DocumentFormattingParams) => {
    const uri = params.textDocument.uri;
    const doc = documents.get(uri);
    if (!doc) return [];

    const original = doc.getText();
    const useTabs = !params.options.insertSpaces;
    return (async () => {
      try {
        // Lazy import to keep LSP start fast
        const { format } = await import("../formatter");
        const next = format(original, { useTabs });
        if (next === original) return [];
        const fullRange: Range = {
          start: { line: 0, character: 0 },
          end: doc.positionAt(original.length),
        };
        return [TextEdit.replace(fullRange, next)];
      } catch {
        return [];
      }
    })();
  });

  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection);

  // Listen on the connection
  connection.listen();
}

// Remove unused function
// function findNodeAtOffset(node: Node, offset: number): any | null { ... }

// Helper to convert AST location to LSP Range
function getRange(node: Node): Range {
  // AST is 1-based, LSP is 0-based
  const line = Math.max(0, node.line - 1);
  const char = Math.max(0, node.column - 1);
  
  // Use accurate end position if available
  if (node.endLine !== undefined && node.endColumn !== undefined) {
    return {
      start: { line, character: char },
      end: { line: Math.max(0, node.endLine - 1), character: Math.max(0, node.endColumn - 1) },
    };
  }
  
  return {
    start: { line, character: char },
    end: { line, character: char + 10 }, // Fallback: approximate end
  };
}

async function validateTextDocument(textDocument: TextDocument, connection: any): Promise<void> {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse the document to find errors
    const ast = parse(text, { sourcePath: textDocument.uri });

    const index = buildDocumentIndex(textDocument.uri, ast);

    // Update cache only on successful parse
    documentCache.set(textDocument.uri, { ast, index });

  } catch (error: any) {
    // If parsing fails, report the error
    // The parser throws errors with line/column info usually
    // Format: "Error message at line N, column M" or similar
    
    let line = 0;
    let character = 0;
    let message = String(error);

    // Try to extract line/column from error message
    // Our parser throws: "Error: ... at line X, column Y"
    const match = message.match(/line\s+(\d+),?\s*column\s+(\d+)/i);
    if (match) {
      line = Math.max(0, parseInt(match[1]!, 10) - 1); // LSP is 0-based
      character = Math.max(0, parseInt(match[2]!, 10) - 1);
      
      // Clean up message
      message = message.replace(/at line \d+,? column \d+/, "").trim();
      if (message.startsWith("Error:")) message = message.substring(6).trim();
    }

    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line, character },
        end: { line, character: character + 1 }, // Highlight at least one char
      },
      message: message,
      source: "ldoc",
    };
    
    diagnostics.push(diagnostic);
  }

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function extractEnclosed(line: string, cursor: number, open: string, close: string): string | null {
  const start = line.lastIndexOf(open, cursor);
  if (start === -1) return null;
  const end = line.indexOf(close, start + open.length);
  if (end === -1) return null;
  if (cursor < start + open.length || cursor > end + close.length) return null;
  return line.slice(start + open.length, end);
}

function extractMacroNameAt(line: string, cursor: number): string | null {
  const re = /@(use|define)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (;;) {
    const m = re.exec(line);
    if (!m) break;
    const full = m[0] ?? "";
    const name = m[2] ?? "";
    const idx = m.index;
    const nameStart = idx + (full.lastIndexOf(name) === -1 ? 0 : full.lastIndexOf(name));
    const nameEnd = nameStart + name.length;
    if (cursor >= nameStart && cursor <= nameEnd) return name;
  }
  return null;
}
