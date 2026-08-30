import type { WorkspaceTree } from "./treeScanner.js";
import type { SignatureSummary } from "./astSummarizer.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Rough token estimate: ~4 chars per token for English/code */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface LogicalModule {
  id: string;
  title: string;
  directory: string;
  files: string[];
  estimatedTokens: number;
  isEntryPoint: boolean;
}

export interface ContextBudget {
  totalFiles: number;
  totalEstimatedTokens: number;
  treeTokens: number;
  signatureTokens: number;
  modules: LogicalModule[];
  packageInfo: PackageInfo | null;
}

export interface PackageInfo {
  name: string;
  description?: string;
  dependencies: string[];
  scripts: string[];
}

function readPackageInfo(root: string): PackageInfo | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      name?: string;
      description?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      name: raw.name ?? "unknown",
      description: raw.description,
      dependencies: [
        ...Object.keys(raw.dependencies ?? {}),
        ...Object.keys(raw.devDependencies ?? {}),
      ].sort(),
      scripts: Object.keys(raw.scripts ?? {}),
    };
  } catch {
    return null;
  }
}

const ENTRY_CANDIDATES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "main.ts",
  "main.tsx",
  "app.ts",
  "app.tsx",
  "server.ts",
  "cli.ts",
  "bin/",
  "src/index.ts",
  "src/main.ts",
  "src/app.ts",
];

/**
 * Partition the workspace into logical modules based on top-level / second-level
 * directory groupings. Entry-point files are flagged.
 */
export function buildContextBudget(
  tree: WorkspaceTree,
  signatures: SignatureSummary[]
): ContextBudget {
  const sigMap = new Map(signatures.map((s) => [s.relativePath, s]));

  // Group files by their top-level directory (or "root" for files at workspace root)
  const groups = new Map<string, string[]>();

  for (const f of tree.files) {
    const parts = f.relativePath.split("/");
    let key: string;
    if (parts.length === 1) {
      key = "root";
    } else if (parts[0] === "src" && parts.length > 2) {
      // Treat src/foo as a module
      key = `src/${parts[1]}`;
    } else {
      key = parts[0]!;
    }
    const list = groups.get(key) ?? [];
    list.push(f.relativePath);
    groups.set(key, list);
  }

  const modules: LogicalModule[] = [];
  let idx = 1;

  for (const [dir, files] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const isEntry = files.some((f) =>
      ENTRY_CANDIDATES.some((c) => f === c || f.startsWith(c) || f.endsWith(`/${c}`))
    );

    let tokenCount = 0;
    for (const f of files) {
      const sig = sigMap.get(f);
      if (sig) {
        tokenCount += estimateTokens(
          [sig.exports, sig.interfaces, sig.classes, sig.functions, sig.types]
            .flat()
            .join("\n")
        );
      } else {
        tokenCount += 50; // baseline for unscanned files
      }
    }

    const title =
      dir === "root"
        ? "Root / Entry"
        : dir
            .replace(/^src\//, "")
            .split(/[-_]/)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");

    modules.push({
      id: `mod-${String(idx).padStart(2, "0")}`,
      title,
      directory: dir,
      files: files.sort(),
      estimatedTokens: tokenCount,
      isEntryPoint: isEntry,
    });
    idx++;
  }

  // Prefer entry-point modules first in ordering
  modules.sort((a, b) => {
    if (a.isEntryPoint && !b.isEntryPoint) return -1;
    if (!a.isEntryPoint && b.isEntryPoint) return 1;
    return a.id.localeCompare(b.id);
  });

  // Re-assign sequential ids after sort
  modules.forEach((m, i) => {
    m.id = `mod-${String(i + 1).padStart(2, "0")}`;
  });

  const treeText = tree.files.map((f) => f.relativePath).join("\n");
  const sigText = signatures
    .map((s) => `${s.relativePath}\n${s.exports.join(",")}`)
    .join("\n");

  return {
    totalFiles: tree.files.length,
    totalEstimatedTokens: estimateTokens(treeText) + estimateTokens(sigText),
    treeTokens: estimateTokens(treeText),
    signatureTokens: estimateTokens(sigText),
    modules,
    packageInfo: readPackageInfo(tree.root),
  };
}

/**
 * Produce a compact budget report for inclusion in LLM outline prompts.
 */
export function formatBudgetReport(budget: ContextBudget): string {
  const lines: string[] = [
    `Total source files: ${budget.totalFiles}`,
    `Estimated tokens (tree + signatures): ~${budget.totalEstimatedTokens}`,
    "",
    "Logical modules:",
  ];

  for (const m of budget.modules) {
    lines.push(
      `  ${m.id}  ${m.title.padEnd(24)}  files=${m.files.length}  ~${m.estimatedTokens} tok  ${m.isEntryPoint ? "[entry]" : ""}`
    );
    lines.push(`         dir: ${m.directory}`);
  }

  if (budget.packageInfo) {
    lines.push("");
    lines.push(`Package: ${budget.packageInfo.name}`);
    if (budget.packageInfo.description) {
      lines.push(`Desc: ${budget.packageInfo.description}`);
    }
    lines.push(`Deps: ${budget.packageInfo.dependencies.slice(0, 20).join(", ")}${budget.packageInfo.dependencies.length > 20 ? "…" : ""}`);
    lines.push(`Scripts: ${budget.packageInfo.scripts.join(", ")}`);
  }

  return lines.join("\n");
}
