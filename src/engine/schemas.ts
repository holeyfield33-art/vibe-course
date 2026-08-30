import { z } from "zod";

export const UserProfileSchema = z.object({
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]),
  learningGoals: z.string(),
});

export const BreakAndFixTaskSchema = z.object({
  targetFile: z.string(),
  instructions: z.string(),
  expectedFailureMode: z.string(),
  resolutionCriteria: z.string(),
});

export const LessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  targetFiles: z.array(z.string()),
  conceptsTaught: z.array(z.string()),
  breakAndFixTask: BreakAndFixTaskSchema,
});

export const ModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  estimatedMinutes: z.number(),
  businessOutcomeFocus: z.string(),
  filesInvolved: z.array(z.string()),
  lessons: z.array(LessonSchema),
});

export const CourseBlueprintSchema = z.object({
  courseTitle: z.string(),
  architectureOverview: z.string(),
  userProfile: UserProfileSchema,
  modules: z.array(ModuleSchema),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;
export type BreakAndFixTask = z.infer<typeof BreakAndFixTaskSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type CourseBlueprint = z.infer<typeof CourseBlueprintSchema>;

/** Runtime progress tracking stored alongside the blueprint */
export const ModuleStatusSchema = z.object({
  moduleId: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  completedLessons: z.array(z.string()).default([]),
});

export const ManifestSchema = z.object({
  version: z.literal("1.0.0"),
  createdAt: z.string(),
  updatedAt: z.string(),
  blueprint: CourseBlueprintSchema,
  moduleStatuses: z.array(ModuleStatusSchema).default([]),
});

export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/** Lesson content written to disk by the module generator */
export const LessonContentSchema = z.object({
  markdown: z.string(),
  mermaidDiagrams: z.array(z.string()).default([]),
  exerciseMarkdown: z.string(),
  checkpoint: z.object({
    questions: z.array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        options: z.array(z.string()).min(2),
        correctIndex: z.number().int().min(0),
        explanation: z.string(),
      })
    ),
  }),
});

export type LessonContent = z.infer<typeof LessonContentSchema>;
