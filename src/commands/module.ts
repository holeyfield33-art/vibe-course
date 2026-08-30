import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scanWorkspace } from "../scanner/treeScanner.js";
import { summarizeWorkspace } from "../scanner/astSummarizer.js";
import { chat, getActiveProvider } from "../engine/llmClient.js";
import { buildLessonPrompt } from "../engine/promptTemplates.js";
import { enforceLessonContent } from "../engine/schemaEnforcer.js";
import {
  getManifest,
  writeModuleContent,
  updateModuleStatus,
} from "../storage/manifestManager.js";

export async function runModule(
  moduleId: string,
  workspaceRoot: string = process.cwd()
): Promise<void> {
  const manifest = getManifest(workspaceRoot);
  const mod = manifest.blueprint.modules.find((m) => m.id === moduleId);

  if (!mod) {
    const ids = manifest.blueprint.modules.map((m) => m.id).join(", ");
    throw new Error(`Module "${moduleId}" not found. Available: ${ids}`);
  }

  console.log(`\n📦 Generating module: ${mod.id} — ${mod.title}`);
  console.log(`   Focus: ${mod.businessOutcomeFocus}`);
  console.log(`   Files: ${mod.filesInvolved.join(", ") || "(inferred from scan)"}`);

  // Load source for involved files (or fall back to directory scan)
  console.log("📂 Loading source…");
  const tree = await scanWorkspace(workspaceRoot);
  const signatures = summarizeWorkspace(tree.files);

  // Prefer explicit files; otherwise take a sample of relevant source
  let targetPaths = mod.filesInvolved;
  if (targetPaths.length === 0) {
    targetPaths = signatures.slice(0, 6).map((s) => s.relativePath);
  }

  const sourceSnippets: Array<{ path: string; content: string }> = [];
  for (const rel of targetPaths.slice(0, 8)) {
    const abs = join(workspaceRoot, rel);
    if (existsSync(abs)) {
      try {
        const content = readFileSync(abs, "utf-8");
        sourceSnippets.push({ path: rel, content: content.slice(0, 5000) });
      } catch {
        // skip unreadable
      }
    }
  }

  if (sourceSnippets.length === 0) {
    // Fallback: any summarized files
    for (const s of signatures.slice(0, 5)) {
      const abs = join(workspaceRoot, s.relativePath);
      if (existsSync(abs)) {
        try {
          sourceSnippets.push({
            path: s.relativePath,
            content: readFileSync(abs, "utf-8").slice(0, 4000),
          });
        } catch {
          // skip
        }
      }
    }
  }

  console.log(`   Loaded ${sourceSnippets.length} source excerpts.`);

  const provider = getActiveProvider();
  console.log(`🤖 Calling LLM (${provider.provider}/${provider.model})…`);

  const { system, user } = buildLessonPrompt({
    module: mod,
    sourceSnippets,
    signatures,
    skillLevel: manifest.blueprint.userProfile.skillLevel,
  });

  const response = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.4, maxTokens: 6000, jsonMode: true }
  );

  console.log("🧩 Validating lesson content…");
  const lesson = await enforceLessonContent(response.content, {
    system,
    originalUser: user,
  });

  // Embed mermaid diagrams into the markdown if not already present
  let fullMarkdown = lesson.markdown;
  for (const diagram of lesson.mermaidDiagrams) {
    if (!fullMarkdown.includes(diagram.slice(0, 40))) {
      fullMarkdown += `\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
    }
  }

  const exerciseMd =
    lesson.exerciseMarkdown ||
    (mod.lessons[0]
      ? formatBreakAndFix(mod.lessons[0].breakAndFixTask)
      : "# Exercise\n\nNo exercise generated.");

  const checkpointJson = JSON.stringify(lesson.checkpoint, null, 2);

  const outDir = writeModuleContent(
    moduleId,
    [
      { name: "README.md", content: fullMarkdown },
      { name: "exercise.md", content: exerciseMd },
      { name: "checkpoint.json", content: checkpointJson },
    ],
    workspaceRoot
  );

  updateModuleStatus(moduleId, "in_progress", workspaceRoot);

  console.log(`\n✅ Wrote module content → ${outDir}`);
  console.log("   README.md  exercise.md  checkpoint.json");
  console.log("\n   Explore with:  vibe-course ui\n");
}

function formatBreakAndFix(task: {
  targetFile: string;
  instructions: string;
  expectedFailureMode: string;
  resolutionCriteria: string;
}): string {
  return `# Break & Fix Exercise

**Target file:** \`${task.targetFile}\`

## Instructions
${task.instructions}

## Expected failure mode
${task.expectedFailureMode}

## Resolution criteria
${task.resolutionCriteria}
`;
}
