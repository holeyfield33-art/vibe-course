import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scanWorkspace, formatTreeSummary } from "../scanner/treeScanner.js";
import { summarizeWorkspace, formatSignatures } from "../scanner/astSummarizer.js";
import { buildContextBudget, formatBudgetReport } from "../scanner/contextBudgeter.js";
import { chat, getActiveProvider } from "../engine/llmClient.js";
import { buildOutlinePrompt } from "../engine/promptTemplates.js";
import { enforceCourseBlueprint } from "../engine/schemaEnforcer.js";
import { initManifest, manifestExists } from "../storage/manifestManager.js";
import type { UserProfile } from "../engine/schemas.js";

async function promptUser(): Promise<UserProfile> {
  const rl = createInterface({ input, output });

  console.log("\n╭──────────────────────────────────────────────╮");
  console.log("│           vibe-course init                   │");
  console.log("╰──────────────────────────────────────────────╯\n");

  let skillLevel: UserProfile["skillLevel"] = "intermediate";
  const skillRaw = (
    await rl.question("Skill level [beginner / intermediate / advanced] (default: intermediate): ")
  )
    .trim()
    .toLowerCase();
  if (skillRaw === "beginner" || skillRaw === "advanced" || skillRaw === "intermediate") {
    skillLevel = skillRaw;
  }

  const learningGoals =
    (
      await rl.question(
        "What do you want to achieve? (e.g. \"understand the payment flow and own the checkout service\"): "
      )
    ).trim() || "Understand the core architecture and be able to ship features confidently.";

  rl.close();
  return { skillLevel, learningGoals };
}

export async function runInit(workspaceRoot: string = process.cwd()): Promise<void> {
  if (manifestExists(workspaceRoot)) {
    console.log("⚠️  A course already exists in .course/");
    console.log("   Delete .course/ if you want to re-initialize.\n");
    return;
  }

  const profile = await promptUser();

  console.log("\n📂 Scanning workspace…");
  const tree = await scanWorkspace(workspaceRoot);
  console.log(`   Found ${tree.files.length} source files across ${tree.directories.length} directories.`);

  console.log("🔍 Extracting AST signatures…");
  const signatures = summarizeWorkspace(tree.files);
  console.log(`   Summarized ${signatures.length} files.`);

  console.log("📊 Building context budget…");
  const budget = buildContextBudget(tree, signatures);
  console.log(`   Logical modules: ${budget.modules.length}`);
  console.log(`   Estimated tokens: ~${budget.totalEstimatedTokens}`);

  const provider = getActiveProvider();
  console.log(`\n🤖 Calling LLM (${provider.provider}/${provider.model}) for course outline…`);

  const treeSummary = formatTreeSummary(tree, 150);
  const budgetReport = formatBudgetReport(budget);
  const signaturesPreview = formatSignatures(signatures, 10_000);

  let packageJsonSnippet = "";
  const pkgPath = join(workspaceRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      packageJsonSnippet = readFileSync(pkgPath, "utf-8").slice(0, 1500);
    } catch {
      // ignore
    }
  }

  const { system, user } = buildOutlinePrompt({
    treeSummary,
    budgetReport,
    signaturesPreview,
    userProfile: profile,
    packageJsonSnippet,
  });

  const response = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3, maxTokens: 6000, jsonMode: true }
  );

  console.log("🧩 Validating blueprint…");
  const blueprint = await enforceCourseBlueprint(response.content, {
    system,
    originalUser: user,
  });

  // Align module ids with budget where possible
  if (blueprint.modules.length === 0) {
    throw new Error("LLM returned a blueprint with zero modules.");
  }

  console.log(`\n✅ Course: "${blueprint.courseTitle}"`);
  console.log(`   Modules: ${blueprint.modules.length}`);
  for (const m of blueprint.modules) {
    console.log(`   · ${m.id}  ${m.title}  (~${m.estimatedMinutes} min, ${m.lessons.length} lessons)`);
  }

  initManifest(blueprint, workspaceRoot);
  console.log("\n📁 Wrote .course/manifest.json");
  console.log("   Next: generate a module with  vibe-course module mod-01");
  console.log("         then explore with       vibe-course ui\n");
}
