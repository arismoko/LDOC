/**
 * Corpus management - load documents from manifest
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { DocumentInfo, Manifest } from "./checks/types";

const FIDELITY_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_CORPUS_PATH = join(FIDELITY_ROOT, "corpus", "docs");

export function getCorpusPath(): string {
  // Check env variable first
  const envPath = process.env.LDOC_CORPUS_PATH;
  if (envPath && existsSync(envPath)) {
    return resolve(envPath);
  }

  // Check .env file
  const envFile = join(FIDELITY_ROOT, ".env");
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, "utf-8");
    const match = content.match(/^LDOC_CORPUS_PATH=(.+)$/m);
    if (match && match[1]) {
      const path = match[1].trim().replace(/^["']|["']$/g, "");
      if (existsSync(path)) {
        return resolve(path);
      }
    }
  }

  // Fall back to internal corpus
  return DEFAULT_CORPUS_PATH;
}

export function loadManifest(): Manifest {
  const manifestPath = join(FIDELITY_ROOT, "corpus", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const content = readFileSync(manifestPath, "utf-8");
  return JSON.parse(content) as Manifest;
}

export function resolveDocumentPath(doc: DocumentInfo, corpusPath: string): string {
  return join(corpusPath, doc.file);
}

export function getAvailableDocuments(filter?: string[]): DocumentInfo[] {
  const manifest = loadManifest();
  const corpusPath = getCorpusPath();

  let docs = manifest.documents.filter((doc) => {
    const fullPath = resolveDocumentPath(doc, corpusPath);
    return existsSync(fullPath);
  });

  if (filter && filter.length > 0) {
    docs = docs.filter((doc) => 
      filter.some((f) => 
        doc.id.toLowerCase().includes(f.toLowerCase()) ||
        doc.file.toLowerCase().includes(f.toLowerCase()) ||
        doc.tags?.some((t) => t.toLowerCase().includes(f.toLowerCase()))
      )
    );
  }

  return docs;
}

export function loadDocument(doc: DocumentInfo): Buffer {
  const corpusPath = getCorpusPath();
  const fullPath = resolveDocumentPath(doc, corpusPath);
  if (!existsSync(fullPath)) {
    throw new Error(`Document not found: ${fullPath}`);
  }
  return readFileSync(fullPath);
}
