import type { UserProfile } from "./schemas.js";
import type { SignatureSummary } from "../scanner/astSummarizer.js";
import type { Module } from "./schemas.js";

export function buildOutlinePrompt(args: {
  treeSummary: string;
  budgetReport: string;
  signaturesPreview: string;
  userProfile: UserProfile;
  packageJsonSnippet?: string;
}): { system: string; user: string } {
  const system = `You are an expert software engineering educator and curriculum designer.
Your job is to turn a real codebase into a high-leverage, outcome-focused developer course.

Rules:
- Focus exclusively on core domain logic, architectural trade-offs, state management, and business outcomes.
- IGNORE configuration debt, boilerplate routing, third-party setup, and decorative code.
- Produce a structured JSON course blueprint that matches the exact schema provided.
- Modules should map to logical areas of the codebase (directories / bounded contexts).
- Each module needs 1–4 lessons. Prefer depth over breadth.
- Every lesson MUST include a concrete "Break & Fix" task that forces the learner to modify real source files.
- estimatedMinutes should be realistic (15–60 per module).
- Use the provided module ids (mod-01, mod-02, …) when they align with the budget report; otherwise invent sequential ids.
- Output ONLY valid JSON. No markdown fences, no commentary.`;

  const user = `## User Profile
Skill level: ${args.userProfile.skillLevel}
Learning goals: ${args.userProfile.learningGoals}

## Workspace Tree
${args.treeSummary}

## Context Budget & Logical Modules
${args.budgetReport}

## Key Signatures (exports / interfaces / classes)
${args.signaturesPreview.slice(0, 8000)}

${args.packageJsonSnippet ? `## package.json\n${args.packageJsonSnippet}` : ""}

## Required JSON Schema
{
  "courseTitle": string,
  "architectureOverview": string,  // 2-4 sentences on the system architecture
  "userProfile": {
    "skillLevel": "beginner" | "intermediate" | "advanced",
    "learningGoals": string
  },
  "modules": [
    {
      "id": string,                  // e.g. "mod-01"
      "title": string,
      "estimatedMinutes": number,
      "businessOutcomeFocus": string,
      "filesInvolved": string[],     // relative paths
      "lessons": [
        {
          "id": string,              // e.g. "lesson-01"
          "title": string,
          "targetFiles": string[],
          "conceptsTaught": string[],
          "breakAndFixTask": {
            "targetFile": string,
            "instructions": string,
            "expectedFailureMode": string,
            "resolutionCriteria": string
          }
        }
      ]
    }
  ]
}

Generate the full CourseBlueprint JSON now.`;

  return { system, user };
}

export function buildLessonPrompt(args: {
  module: Module;
  sourceSnippets: Array<{ path: string; content: string }>;
  signatures: SignatureSummary[];
  skillLevel: string;
}): { system: string; user: string } {
  const system = `You are an expert technical writer and senior engineer teaching from a real codebase.
Generate a deep-dive lesson for one module of a developer course.

Output MUST be valid JSON matching this schema (no markdown fences):
{
  "markdown": string,           // Full lesson body in Markdown. Use headings, code blocks, callouts.
  "mermaidDiagrams": string[],  // 0-3 Mermaid diagram source strings (flowchart / sequence / class)
  "exerciseMarkdown": string,   // Step-by-step Break & Fix exercise instructions
  "checkpoint": {
    "questions": [
      {
        "id": string,
        "prompt": string,
        "options": string[],    // 2-4 choices
        "correctIndex": number, // 0-based
        "explanation": string
      }
    ]
  }
}

Guidelines:
- Teach architectural decisions and business impact, not syntax.
- Reference real file paths and symbols from the provided source.
- Include at least one Mermaid diagram that visualizes a key flow or data model.
- The Break & Fix exercise must be concrete and testable against the real files.
- Checkpoint should have 2–4 multiple-choice questions that probe understanding, not trivia.
- Match the learner's skill level: ${args.skillLevel}.`;

  const sourceBlock = args.sourceSnippets
    .map((s) => `### ${s.path}\n\`\`\`\n${s.content.slice(0, 4000)}\n\`\`\``)
    .join("\n\n");

  const sigBlock = args.signatures
    .filter((s) => args.module.filesInvolved.includes(s.relativePath))
    .map(
      (s) =>
        `${s.relativePath}: exports=[${s.exports.join(", ")}] interfaces=[${s.interfaces.join("; ")}]`
    )
    .join("\n");

  const user = `## Module Spec
ID: ${args.module.id}
Title: ${args.module.title}
Business outcome: ${args.module.businessOutcomeFocus}
Files involved: ${args.module.filesInvolved.join(", ")}
Lessons planned:
${args.module.lessons.map((l) => `- ${l.id}: ${l.title} → concepts: ${l.conceptsTaught.join(", ")}`).join("\n")}

## AST Signatures for involved files
${sigBlock || "(none extracted)"}

## Source code excerpts
${sourceBlock || "(no source loaded)"}

Generate the complete lesson JSON for the FIRST lesson in this module (${args.module.lessons[0]?.id ?? "lesson-01"}).
If the module has multiple lessons, focus on the primary concepts and produce one cohesive deep-dive.`;

  return { system, user };
}
