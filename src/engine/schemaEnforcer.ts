import { z } from "zod";
import { chat, type LLMMessage } from "./llmClient.js";
import {
  CourseBlueprintSchema,
  LessonContentSchema,
  type CourseBlueprint,
  type LessonContent,
} from "./schemas.js";

function extractJson(raw: string): string {
  // Strip markdown code fences if the model ignored instructions
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    text = fence[1].trim();
  }
  // Find outermost { … }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text;
}

/**
 * Parse + validate LLM JSON output. On failure, perform a single repair retry.
 */
export async function enforceSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
  repairContext?: { system: string; originalUser: string }
): Promise<T> {
  const attempt = (text: string): T => {
    const jsonStr = extractJson(text);
    const parsed: unknown = JSON.parse(jsonStr);
    return schema.parse(parsed);
  };

  try {
    return attempt(raw);
  } catch (firstErr) {
    if (!repairContext) {
      throw new Error(
        `Schema validation failed and no repair context provided.\n${String(firstErr)}`
      );
    }

    const repairMessages: LLMMessage[] = [
      {
        role: "system",
        content: `${repairContext.system}

Your previous response failed JSON schema validation.
Return ONLY corrected valid JSON. No commentary.`,
      },
      { role: "user", content: repairContext.originalUser },
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `Validation error:\n${String(firstErr)}\n\nPlease output the corrected JSON only.`,
      },
    ];

    const retry = await chat(repairMessages, { temperature: 0.2, jsonMode: true });
    try {
      return attempt(retry.content);
    } catch (secondErr) {
      throw new Error(
        `Schema validation failed after 1 retry.\nFirst: ${String(firstErr)}\nSecond: ${String(secondErr)}`
      );
    }
  }
}

export async function enforceCourseBlueprint(
  raw: string,
  repairContext: { system: string; originalUser: string }
): Promise<CourseBlueprint> {
  return enforceSchema(raw, CourseBlueprintSchema, repairContext);
}

export async function enforceLessonContent(
  raw: string,
  repairContext: { system: string; originalUser: string }
): Promise<LessonContent> {
  return enforceSchema(raw, LessonContentSchema, repairContext) as Promise<LessonContent>;
}
