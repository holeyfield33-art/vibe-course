import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  ManifestSchema,
  type Manifest,
  type CourseBlueprint,
  type ModuleStatus,
} from "../engine/schemas.js";

const COURSE_DIR = ".course";
const MANIFEST_FILE = "manifest.json";
const MODULES_DIR = "modules";

export function getCourseRoot(workspaceRoot: string = process.cwd()): string {
  return join(workspaceRoot, COURSE_DIR);
}

export function getModulesRoot(workspaceRoot: string = process.cwd()): string {
  return join(getCourseRoot(workspaceRoot), MODULES_DIR);
}

export function ensureCourseDirs(workspaceRoot: string = process.cwd()): void {
  const course = getCourseRoot(workspaceRoot);
  const modules = getModulesRoot(workspaceRoot);
  if (!existsSync(course)) mkdirSync(course, { recursive: true });
  if (!existsSync(modules)) mkdirSync(modules, { recursive: true });
}

export function getManifestPath(workspaceRoot: string = process.cwd()): string {
  return join(getCourseRoot(workspaceRoot), MANIFEST_FILE);
}

export function manifestExists(workspaceRoot: string = process.cwd()): boolean {
  return existsSync(getManifestPath(workspaceRoot));
}

/**
 * Create a fresh manifest from a validated CourseBlueprint.
 */
export function initManifest(
  blueprint: CourseBlueprint,
  workspaceRoot: string = process.cwd()
): Manifest {
  ensureCourseDirs(workspaceRoot);

  const now = new Date().toISOString();
  const moduleStatuses: ModuleStatus[] = blueprint.modules.map((m) => ({
    moduleId: m.id,
    status: "pending" as const,
    completedLessons: [],
  }));

  const manifest: Manifest = {
    version: "1.0.0",
    createdAt: now,
    updatedAt: now,
    blueprint,
    moduleStatuses,
  };

  // Validate before write
  const parsed = ManifestSchema.parse(manifest);
  writeFileSync(getManifestPath(workspaceRoot), JSON.stringify(parsed, null, 2), "utf-8");

  // Scaffold empty module directories
  for (const mod of blueprint.modules) {
    const modDir = join(getModulesRoot(workspaceRoot), mod.id);
    if (!existsSync(modDir)) mkdirSync(modDir, { recursive: true });
  }

  // Ensure .course is git-ignored
  ensureGitignore(workspaceRoot);

  return parsed;
}

function ensureGitignore(workspaceRoot: string): void {
  const giPath = join(workspaceRoot, ".gitignore");
  const entry = ".course/";
  try {
    if (existsSync(giPath)) {
      const content = readFileSync(giPath, "utf-8");
      if (!content.split("\n").some((l) => l.trim() === entry || l.trim() === ".course")) {
        writeFileSync(giPath, content.endsWith("\n") ? content + entry + "\n" : content + "\n" + entry + "\n", "utf-8");
      }
    } else {
      writeFileSync(giPath, `${entry}\n`, "utf-8");
    }
  } catch {
    // non-fatal
  }
}

export function getManifest(workspaceRoot: string = process.cwd()): Manifest {
  const path = getManifestPath(workspaceRoot);
  if (!existsSync(path)) {
    throw new Error(
      "No course found. Run `vibe-course init` first to generate a course blueprint."
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return ManifestSchema.parse(raw);
}

function saveManifest(manifest: Manifest, workspaceRoot: string): void {
  const updated: Manifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };
  const parsed = ManifestSchema.parse(updated);
  writeFileSync(getManifestPath(workspaceRoot), JSON.stringify(parsed, null, 2), "utf-8");
}

export function updateModuleStatus(
  moduleId: string,
  status: ModuleStatus["status"],
  workspaceRoot: string = process.cwd()
): Manifest {
  const manifest = getManifest(workspaceRoot);
  const idx = manifest.moduleStatuses.findIndex((s) => s.moduleId === moduleId);
  if (idx === -1) {
    throw new Error(`Module "${moduleId}" not found in manifest.`);
  }
  const existing = manifest.moduleStatuses[idx]!;
  manifest.moduleStatuses[idx] = { ...existing, status };
  saveManifest(manifest, workspaceRoot);
  return getManifest(workspaceRoot);
}

export function markLessonComplete(
  moduleId: string,
  lessonId: string,
  workspaceRoot: string = process.cwd()
): Manifest {
  const manifest = getManifest(workspaceRoot);
  const idx = manifest.moduleStatuses.findIndex((s) => s.moduleId === moduleId);
  if (idx === -1) {
    throw new Error(`Module "${moduleId}" not found in manifest.`);
  }
  const status = manifest.moduleStatuses[idx]!;
  if (!status.completedLessons.includes(lessonId)) {
    status.completedLessons = [...status.completedLessons, lessonId];
  }

  // Auto-complete module when all lessons done
  const mod = manifest.blueprint.modules.find((m) => m.id === moduleId);
  if (mod && status.completedLessons.length >= mod.lessons.length) {
    status.status = "completed";
  } else if (status.status === "pending") {
    status.status = "in_progress";
  }

  manifest.moduleStatuses[idx] = status;
  saveManifest(manifest, workspaceRoot);
  return getManifest(workspaceRoot);
}

export function writeModuleContent(
  moduleId: string,
  files: { name: string; content: string }[],
  workspaceRoot: string = process.cwd()
): string {
  ensureCourseDirs(workspaceRoot);
  const modDir = join(getModulesRoot(workspaceRoot), moduleId);
  if (!existsSync(modDir)) mkdirSync(modDir, { recursive: true });

  for (const f of files) {
    writeFileSync(join(modDir, f.name), f.content, "utf-8");
  }
  return modDir;
}

export function listModuleFiles(
  moduleId: string,
  workspaceRoot: string = process.cwd()
): string[] {
  const modDir = join(getModulesRoot(workspaceRoot), moduleId);
  if (!existsSync(modDir)) return [];
  return readdirSync(modDir).filter((f) => !f.startsWith("."));
}

export function readModuleFile(
  moduleId: string,
  fileName: string,
  workspaceRoot: string = process.cwd()
): string {
  const path = join(getModulesRoot(workspaceRoot), moduleId, fileName);
  if (!existsSync(path)) {
    throw new Error(`File not found: .course/modules/${moduleId}/${fileName}`);
  }
  return readFileSync(path, "utf-8");
}
