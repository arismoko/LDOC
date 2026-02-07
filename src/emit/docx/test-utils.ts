import { XMLParser } from "fast-xml-parser";
import JSZip, { type JSZipObject } from "jszip";

import { compile, type CompileOptions } from "../../pipeline/index.ts";

export interface OoxmlPackage {
  buffer: Uint8Array;
  diagnostics: Awaited<ReturnType<typeof compile>>["diagnostics"];
  hasPart: (partPath: string) => boolean;
  readPart: (partPath: string) => Promise<string>;
  parsePart: <T = unknown>(partPath: string) => Promise<T>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: false,
});

export async function compileToOoxml(
  source: string,
  options: CompileOptions = {},
): Promise<OoxmlPackage> {
  const result = await compile(source, options);
  const zip = await JSZip.loadAsync(result.buffer);
  const entries = new Map<string, JSZipObject>(
    Object.entries(zip.files),
  );

  const hasPart = (partPath: string): boolean => entries.has(partPath);

  const readPart = async (partPath: string): Promise<string> => {
    const entry = entries.get(partPath);
    if (!entry) {
      throw new Error(`OOXML part not found: ${partPath}`);
    }
    return entry.async("string");
  };

  const parsePart = async <T = unknown>(partPath: string): Promise<T> => {
    const xml = await readPart(partPath);
    return parser.parse(xml) as T;
  };

  return {
    buffer: result.buffer,
    diagnostics: result.diagnostics,
    hasPart,
    readPart,
    parsePart,
  };
}
