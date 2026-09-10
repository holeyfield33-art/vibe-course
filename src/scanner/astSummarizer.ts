import { parse } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { readFileSync } from "node:fs";
import type { ScannedFile } from "./treeScanner.js";

type TraverseFn = (parent: t.Node, opts: Record<string, unknown>) => void;
const traverse = (
  typeof traverseModule === "function"
    ? traverseModule
    : (traverseModule as unknown as { default: TraverseFn }).default
) as TraverseFn;

export interface SignatureSummary {
  relativePath: string;
  exports: string[];
  interfaces: string[];
  classes: string[];
  functions: string[];
  types: string[];
  rawSnippet: string;
}

function safeParse(code: string, filename: string): t.File | null {
  try {
    return parse(code, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
      ],
      errorRecovery: true,
      sourceFilename: filename,
    });
  } catch {
    return null;
  }
}

function getName(node: t.Node | null | undefined): string | null {
  if (!node) return null;
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTSQualifiedName(node)) {
    const left = getName(node.left);
    const right = getName(node.right);
    return left && right ? `${left}.${right}` : null;
  }
  return null;
}

function functionSignature(path: NodePath<t.FunctionDeclaration | t.TSDeclareFunction | t.FunctionExpression | t.ArrowFunctionExpression>): string {
  const node = path.node;
  let name = "anonymous";
  if (t.isFunctionDeclaration(node) || t.isTSDeclareFunction(node)) {
    name = node.id?.name ?? "anonymous";
  } else if (path.parentPath?.isVariableDeclarator()) {
    name = getName(path.parentPath.node.id) ?? "anonymous";
  }

  const params = node.params
    .map((p) => {
      if (t.isIdentifier(p)) {
        const typeAnn = p.typeAnnotation && t.isTSTypeAnnotation(p.typeAnnotation)
          ? `: ${pathToTypeString(p.typeAnnotation.typeAnnotation)}`
          : "";
        return `${p.name}${typeAnn}`;
      }
      if (t.isRestElement(p) && t.isIdentifier(p.argument)) {
        return `...${p.argument.name}`;
      }
      if (t.isObjectPattern(p) || t.isArrayPattern(p)) return "{…}";
      return "?";
    })
    .join(", ");

  let ret = "";
  if ("returnType" in node && node.returnType && t.isTSTypeAnnotation(node.returnType)) {
    ret = `: ${pathToTypeString(node.returnType.typeAnnotation)}`;
  }

  return `${name}(${params})${ret}`;
}

function pathToTypeString(typeNode: t.TSType): string {
  try {
    // Minimal pretty-print without full printer dependency
    if (t.isTSTypeReference(typeNode)) {
      const name = getName(typeNode.typeName) ?? "Unknown";
      if (typeNode.typeParameters) {
        const args = typeNode.typeParameters.params.map(pathToTypeString).join(", ");
        return `${name}<${args}>`;
      }
      return name;
    }
    if (t.isTSStringKeyword(typeNode)) return "string";
    if (t.isTSNumberKeyword(typeNode)) return "number";
    if (t.isTSBooleanKeyword(typeNode)) return "boolean";
    if (t.isTSVoidKeyword(typeNode)) return "void";
    if (t.isTSAnyKeyword(typeNode)) return "any";
    if (t.isTSUnknownKeyword(typeNode)) return "unknown";
    if (t.isTSNullKeyword(typeNode)) return "null";
    if (t.isTSUndefinedKeyword(typeNode)) return "undefined";
    if (t.isTSArrayType(typeNode)) return `${pathToTypeString(typeNode.elementType)}[]`;
    if (t.isTSUnionType(typeNode)) return typeNode.types.map(pathToTypeString).join(" | ");
    if (t.isTSFunctionType(typeNode)) return "(…) => …";
    if (t.isTSTypeLiteral(typeNode)) return "{…}";
    if (t.isTSLiteralType(typeNode) && t.isStringLiteral(typeNode.literal)) {
      return `"${typeNode.literal.value}"`;
    }
    return "…";
  } catch {
    return "…";
  }
}

/**
 * Extract only public contracts: exports, interfaces, class signatures, function signatures.
 * Implementation bodies are deliberately discarded.
 */
export function summarizeFile(file: ScannedFile): SignatureSummary | null {
  let code: string;
  try {
    code = readFileSync(file.absolutePath, "utf-8");
  } catch {
    return null;
  }

  // Skip huge files to keep context budget sane
  if (code.length > 200_000) {
    return {
      relativePath: file.relativePath,
      exports: ["[file too large – skipped]"],
      interfaces: [],
      classes: [],
      functions: [],
      types: [],
      rawSnippet: "",
    };
  }

  const ast = safeParse(code, file.relativePath);
  if (!ast) {
    return {
      relativePath: file.relativePath,
      exports: [],
      interfaces: [],
      classes: [],
      functions: [],
      types: [],
      rawSnippet: code.slice(0, 500),
    };
  }

  const exports: string[] = [];
  const interfaces: string[] = [];
  const classes: string[] = [];
  const functions: string[] = [];
  const types: string[] = [];

  traverse(ast, {
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      const decl = path.node.declaration;
      if (!decl) {
        for (const spec of path.node.specifiers) {
          if (t.isExportSpecifier(spec)) {
            const name = getName(spec.exported);
            if (name) exports.push(`export { ${name} }`);
          }
        }
        return;
      }
      if (t.isFunctionDeclaration(decl) && decl.id) {
        const sig = functionSignature(path.get("declaration") as NodePath<t.FunctionDeclaration>);
        functions.push(`export function ${sig}`);
        exports.push(decl.id.name);
      } else if (t.isClassDeclaration(decl) && decl.id) {
        classes.push(`export class ${decl.id.name}`);
        exports.push(decl.id.name);
      } else if (t.isTSInterfaceDeclaration(decl)) {
        const name = decl.id.name;
        const members = decl.body.body
          .map((m) => {
            if (t.isTSPropertySignature(m) || t.isTSMethodSignature(m)) {
              const key = getName(m.key as t.Node);
              return key ?? "?";
            }
            return null;
          })
          .filter(Boolean)
          .join(", ");
        interfaces.push(`export interface ${name} { ${members} }`);
        exports.push(name);
      } else if (t.isTSTypeAliasDeclaration(decl)) {
        types.push(`export type ${decl.id.name}`);
        exports.push(decl.id.name);
      } else if (t.isVariableDeclaration(decl)) {
        for (const d of decl.declarations) {
          const name = getName(d.id);
          if (name) exports.push(`export const ${name}`);
        }
      }
    },
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const decl = path.node.declaration;
      if (t.isFunctionDeclaration(decl) || t.isFunctionExpression(decl)) {
        functions.push("export default function");
      } else if (t.isClassDeclaration(decl)) {
        classes.push(`export default class ${decl.id?.name ?? "Anonymous"}`);
      } else {
        exports.push("export default …");
      }
    },
    TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
      // Non-exported interfaces still useful for understanding
      if (!path.parentPath?.isExportNamedDeclaration()) {
        const name = path.node.id.name;
        interfaces.push(`interface ${name}`);
      }
    },
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.parentPath?.isExportNamedDeclaration() && path.node.id) {
        classes.push(`class ${path.node.id.name}`);
      }
    },
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (!path.parentPath?.isExportNamedDeclaration() && path.node.id) {
        // Only top-level non-exported for context
        if (path.parentPath?.isProgram()) {
          functions.push(`function ${functionSignature(path)}`);
        }
      }
    },
  });

  // Build a compact raw snippet of the first meaningful lines
  const lines = code.split("\n").filter((l) => l.trim().length > 0);
  const rawSnippet = lines.slice(0, 30).join("\n");

  return {
    relativePath: file.relativePath,
    exports: [...new Set(exports)],
    interfaces: [...new Set(interfaces)],
    classes: [...new Set(classes)],
    functions: [...new Set(functions)],
    types: [...new Set(types)],
    rawSnippet,
  };
}

export function summarizeWorkspace(files: ScannedFile[]): SignatureSummary[] {
  const results: SignatureSummary[] = [];
  for (const f of files) {
    // Focus on source files; skip pure config
    if (f.relativePath === "package.json" || f.relativePath.startsWith("tsconfig")) {
      continue;
    }
    const summary = summarizeFile(f);
    if (summary) results.push(summary);
  }
  return results;
}

/**
 * Render signatures into a compact text block for LLM prompts.
 */
export function formatSignatures(summaries: SignatureSummary[], maxChars = 12_000): string {
  const blocks: string[] = [];
  let total = 0;

  for (const s of summaries) {
    const parts: string[] = [`--- ${s.relativePath} ---`];
    if (s.exports.length) parts.push(`exports: ${s.exports.join(", ")}`);
    if (s.interfaces.length) parts.push(...s.interfaces);
    if (s.classes.length) parts.push(...s.classes);
    if (s.functions.length) parts.push(...s.functions);
    if (s.types.length) parts.push(...s.types);

    const block = parts.join("\n");
    if (total + block.length > maxChars) {
      blocks.push("… [remaining signatures truncated for context budget]");
      break;
    }
    blocks.push(block);
    total += block.length;
  }

  return blocks.join("\n\n");
}
