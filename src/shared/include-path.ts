import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";

export interface ResolveIncludeOptions {
  includePath: string;
  sourcePath: string;
  rootPath: string;
}

export type ResolveIncludeResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export function defaultIncludeRoot(sourcePath: string): string {
  return resolvePath(dirname(sourcePath));
}

export function resolveIncludeFilePath(options: ResolveIncludeOptions): ResolveIncludeResult {
  const includePath = options.includePath.trim();
  if (!includePath) {
    return { ok: false, reason: "Include path must be a non-empty string" };
  }

  if (isAbsolute(includePath)) {
    return { ok: false, reason: "Absolute include paths are not allowed" };
  }

  const sourceDir = dirname(resolvePath(options.sourcePath));
  const resolved = resolvePath(sourceDir, includePath);
  const root = resolvePath(options.rootPath);
  const rel = relative(root, resolved);

  const escapesRoot = rel.startsWith("..") || isAbsolute(rel);
  if (escapesRoot) {
    return {
      ok: false,
      reason: `Include path '${includePath}' escapes include root '${root}'`,
    };
  }

  return { ok: true, path: resolved };
}
