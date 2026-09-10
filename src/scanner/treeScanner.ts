import { globby } from "globby";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.course/**",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/*.min.js",
  "**/*.map",
  "**/.DS_Store",
];

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
}

export interface WorkspaceTree {
  root: string;
  files: ScannedFile[];
  directories: string[];
}

function loadIgnorePatterns(root: string): string[] {
  const patterns: string[] = [...DEFAULT_EXCLUDES];

  for (const name of [".gitignore", ".courseignore"]) {
    const p = join(root, name);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        // Also collect raw lines for globby negative patterns
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            patterns.push(trimmed.startsWith("!") ? trimmed : `**/${trimmed}`);
          }
        }
      } catch {
        // ignore unreadable ignore files
      }
    }
  }

  return patterns;
}

/**
 * Walk the workspace, respecting .gitignore / .courseignore and hard excludes.
 * Returns only source-relevant files (ts, tsx, js, jsx, mjs, cjs, json package).
 */
export async function scanWorkspace(root: string = process.cwd()): Promise<WorkspaceTree> {
  const ignorePatterns = loadIgnorePatterns(root);

  const paths = await globby(
    [
      "**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "package.json",
      "tsconfig.json",
      "tsconfig.*.json",
    ],
    {
      cwd: root,
      absolute: true,
      gitignore: true,
      ignore: ignorePatterns,
      onlyFiles: true,
      followSymbolicLinks: false,
    }
  );

  const files: ScannedFile[] = paths.map((abs) => {
    const rel = relative(root, abs);
    const ext = rel.includes(".") ? `.${rel.split(".").pop()!}` : "";
    return {
      absolutePath: abs,
      relativePath: rel.replace(/\\/g, "/"),
      extension: ext,
    };
  });

  // Derive unique directories from file paths
  const dirSet = new Set<string>();
  for (const f of files) {
    const parts = f.relativePath.split("/");
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      dirSet.add(acc);
    }
  }

  return {
    root,
    files,
    directories: Array.from(dirSet).sort(),
  };
}

/**
 * Produce a compact textual tree summary suitable for LLM context.
 */
export function formatTreeSummary(tree: WorkspaceTree, maxEntries = 200): string {
  const lines: string[] = [`Workspace root: ${tree.root}`, ""];
  const entries = [
    ...tree.directories.map((d) => `📁 ${d}/`),
    ...tree.files.map((f) => `📄 ${f.relativePath}`),
  ].slice(0, maxEntries);

  lines.push(...entries);
  if (tree.files.length + tree.directories.length > maxEntries) {
    lines.push(`… and ${tree.files.length + tree.directories.length - maxEntries} more`);
  }
  return lines.join("\n");
}
