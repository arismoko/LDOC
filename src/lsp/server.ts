import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  DidChangeConfigurationNotification,
  CompletionItemKind,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  type InitializeParams,
  type CompletionItem,
  type TextDocumentPositionParams,
  type InitializeResult,
  type Diagnostic,
  type DefinitionParams,
  type Location,
  type Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "../parser/parser";
import { walkTree, type Node, type AnchorNode } from "../parser/ast";

// Cache for document ASTs and symbol tables
interface DocumentInfo {
  ast: Node;
  anchors: Map<string, Location>;
}
const documentCache = new Map<string, DocumentInfo>();

export function startServer() {
  // Create a connection for the server, using Node's IPC as a transport.
  // Also include all preview / proposed LSP features.
  const connection = createConnection(ProposedFeatures.all);

  // Create a simple text document manager.
  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

  let hasConfigurationCapability = false;
  let hasWorkspaceFolderCapability = false;
  let hasDiagnosticRelatedInformationCapability = false;

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

    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        // Tell the client that this server supports code completion.
        completionProvider: {
          resolveProvider: true,
        },
        // Support Go to Definition
        definitionProvider: true,
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
    if (hasConfigurationCapability) {
      // Register for all configuration changes.
      connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
      connection.workspace.onDidChangeWorkspaceFolders((_event) => {
        connection.console.log("Workspace folder change event received.");
      });
    }
  });

  // The content of a text document has changed. This event is emitted
  // when the text document first opened or when its content has changed.
  documents.onDidChangeContent((change) => {
    validateTextDocument(change.document, connection);
  });

  connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We received an file change event");
  });

  // This handler provides the initial list of the completion items.
  connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
      // The pass parameter contains the position of the text document in
      // which code complete got requested. For the example we ignore this
      // info and always provide the same completion items.
      return [
        {
          label: "@columns",
          kind: CompletionItemKind.Keyword,
          data: 1,
        },
        {
          label: "@break",
          kind: CompletionItemKind.Keyword,
          data: 2,
        },
        {
          label: "@end",
          kind: CompletionItemKind.Keyword,
          data: 3,
        },
        {
          label: "@box",
          kind: CompletionItemKind.Keyword,
          data: 4,
        },
        {
          label: "@image",
          kind: CompletionItemKind.Keyword,
          data: 5,
        },
        {
          label: "@anchor",
          kind: CompletionItemKind.Keyword,
          data: 6,
        },
      ];
    }
  );

  // This handler resolves additional information for the item selected in
  // the completion list.
  connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
      if (item.data === 1) {
        item.detail = "Columns Region";
        item.documentation = "Create a multi-column layout region.";
      } else if (item.data === 2) {
        item.detail = "Column Break";
        item.documentation = "Force a break to the next column.";
      } else if (item.data === 6) {
        item.detail = "Anchor";
        item.documentation = "Define a named anchor for linking.";
      }
      return item;
    }
  );

  connection.onDefinition((params: DefinitionParams): Location | null => {
    const uri = params.textDocument.uri;
    const info = documentCache.get(uri);
    if (!info) return null;

    // We need to find what symbol is at the position
    // This requires traversing the AST to find the node at the position
    // For now, let's assume we are looking for a link target
    
    // Simple heuristic: check if the line contains a link pattern [text](#target)
    // and if the cursor is inside the target part.
    // Or better, find the LinkNode at the position.
    
    const doc = documents.get(uri);
    if (!doc) return null;
    
    // Find the link node at the cursor position
    // Since we don't have a precise node finder, we'll iterate all links in the AST
    // and check if the cursor is within their range.
    // Note: Our AST currently lacks end positions, so we'll approximate.
    
    let targetLoc: Location | null = null;
    
    walkTree(info.ast, (node) => {
      if (node.type === "link") {
        const link = node as any; // Cast to access url
        if (link.url && link.url.startsWith("#")) {
          // Check if cursor is on this line
          // AST is 1-based, LSP is 0-based
          const nodeLine = node.line - 1;
          if (nodeLine === params.position.line) {
             // Check column proximity (very rough)
             // We assume the link is around the column reported by the parser
             const nodeCol = node.column - 1;
             if (params.position.character >= nodeCol) {
                 // Found a candidate link on the same line
                 const targetName = link.url.substring(1);
                 const loc = info.anchors.get(targetName);
                 if (loc) {
                     targetLoc = loc;
                 }
             }
          }
        }
      }
    });
    
    return targetLoc;
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
  return {
    start: { line, character: char },
    end: { line, character: char + 10 }, // Approximate end
  };
}

async function validateTextDocument(textDocument: TextDocument, connection: any): Promise<void> {
  const text = textDocument.getText();
  const diagnostics: Diagnostic[] = [];

  try {
    // Parse the document to find errors
    const ast = parse(text, { sourcePath: textDocument.uri });
    
    // Build symbol table (anchors)
    const anchors = new Map<string, Location>();
    walkTree(ast, (node) => {
      if (node.type === "anchor") {
        const anchor = node as AnchorNode;
        anchors.set(anchor.name, {
          uri: textDocument.uri,
          range: getRange(anchor),
        });
      }
    });
    
    // Update cache
    documentCache.set(textDocument.uri, { ast, anchors });

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
