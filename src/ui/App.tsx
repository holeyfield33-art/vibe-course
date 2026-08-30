import React, { useState, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  getManifest,
  markLessonComplete,
  readModuleFile,
  listModuleFiles,
  updateModuleStatus,
} from "../storage/manifestManager.js";
import type { Manifest, Module, BreakAndFixTask } from "../engine/schemas.js";
import { LessonViewer, countLessonLines } from "./components/LessonViewer.js";
import { ExerciseBox } from "./components/ExerciseBox.js";
import { QuizWidget, type QuizQuestion } from "./components/QuizWidget.js";
import { getTerminalSize, clamp } from "./utils/terminalSize.js";

type View =
  | { kind: "modules" }
  | { kind: "lesson"; moduleId: string; lessonId: string }
  | { kind: "exercise"; moduleId: string; lessonId: string }
  | { kind: "quiz"; moduleId: string; lessonId: string };

interface ModuleContent {
  markdown: string;
  mermaidDiagrams: string[];
  exerciseMarkdown: string;
  checkpoint: { questions: QuizQuestion[] };
  breakAndFix: BreakAndFixTask | null;
}

function loadModuleContent(moduleId: string, mod: Module): ModuleContent | null {
  try {
    const files = listModuleFiles(moduleId);
    if (!files.includes("README.md")) return null;

    const markdown = readModuleFile(moduleId, "README.md");
    let exerciseMarkdown = "";
    if (files.includes("exercise.md")) {
      exerciseMarkdown = readModuleFile(moduleId, "exercise.md");
    }
    let checkpoint: { questions: QuizQuestion[] } = { questions: [] };
    if (files.includes("checkpoint.json")) {
      try {
        checkpoint = JSON.parse(readModuleFile(moduleId, "checkpoint.json")) as {
          questions: QuizQuestion[];
        };
      } catch {
        // ignore malformed
      }
    }

    // Extract mermaid blocks from markdown
    const mermaidDiagrams: string[] = [];
    const mermaidRe = /```mermaid\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = mermaidRe.exec(markdown)) !== null) {
      mermaidDiagrams.push(m[1]!.trim());
    }

    const lesson = mod.lessons[0];
    return {
      markdown,
      mermaidDiagrams,
      exerciseMarkdown,
      checkpoint,
      breakAndFix: lesson?.breakAndFixTask ?? null,
    };
  } catch {
    return null;
  }
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const [manifest, setManifest] = useState<Manifest>(() => getManifest());
  const [view, setView] = useState<View>({ kind: "modules" });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [exerciseDone, setExerciseDone] = useState(false);

  const modules = manifest.blueprint.modules;
  const { rows } = getTerminalSize();
  const maxVisible = Math.max(8, rows - 12);

  const activeModule: Module | undefined =
    view.kind !== "modules"
      ? modules.find((m) => m.id === view.moduleId)
      : undefined;

  const content = useMemo(() => {
    if (!activeModule || view.kind === "modules") return null;
    return loadModuleContent(view.moduleId, activeModule);
  }, [view, activeModule]);

  useInput((input, key) => {
    if (input === "q" && view.kind === "modules") {
      exit();
      return;
    }
    if (input === "q" && view.kind !== "modules") {
      setView({ kind: "modules" });
      setScrollOffset(0);
      setExerciseDone(false);
      return;
    }

    if (view.kind === "modules") {
      if (key.upArrow) {
        setSelectedIdx((i) => (i > 0 ? i - 1 : modules.length - 1));
      } else if (key.downArrow) {
        setSelectedIdx((i) => (i < modules.length - 1 ? i + 1 : 0));
      } else if (key.return) {
        const mod = modules[selectedIdx];
        if (!mod) return;
        // Mark in progress
        try {
          const updated = updateModuleStatus(mod.id, "in_progress");
          setManifest(updated);
        } catch {
          // ignore
        }
        const files = listModuleFiles(mod.id);
        if (!files.includes("README.md")) {
          // Module content not generated yet
          return;
        }
        setView({
          kind: "lesson",
          moduleId: mod.id,
          lessonId: mod.lessons[0]?.id ?? "lesson-01",
        });
        setScrollOffset(0);
        setExerciseDone(false);
      }
    } else if (view.kind === "lesson") {
      if (key.upArrow || input === "k") {
        setScrollOffset((o) => clamp(o - 3, 0, 9999));
      } else if (key.downArrow || input === "j") {
        const total = content
          ? countLessonLines(content.markdown, content.mermaidDiagrams)
          : 0;
        setScrollOffset((o) => clamp(o + 3, 0, Math.max(0, total - maxVisible)));
      } else if (input === "e") {
        setView({ ...view, kind: "exercise" });
      } else if (input === "t") {
        setView({ ...view, kind: "quiz" });
      }
    } else if (view.kind === "exercise") {
      if (input === "c") {
        setExerciseDone(true);
        if (activeModule && view.lessonId) {
          try {
            const updated = markLessonComplete(view.moduleId, view.lessonId);
            setManifest(updated);
          } catch {
            // ignore
          }
        }
      } else if (input === "l") {
        setView({ ...view, kind: "lesson" });
      } else if (input === "t") {
        setView({ ...view, kind: "quiz" });
      }
    } else if (view.kind === "quiz") {
      if (input === "l") {
        setView({ ...view, kind: "lesson" });
      }
    }
  });

  // ── Module list view ──────────────────────────────────────────────
  if (view.kind === "modules") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          {manifest.blueprint.courseTitle}
        </Text>
        <Text dimColor>{manifest.blueprint.architectureOverview}</Text>
        <Box marginY={1} flexDirection="column">
          <Text bold>Modules</Text>
          {modules.map((mod, i) => {
            const status =
              manifest.moduleStatuses.find((s) => s.moduleId === mod.id)?.status ??
              "pending";
            const hasContent = listModuleFiles(mod.id).includes("README.md");
            const marker = i === selectedIdx ? "❯" : " ";
            const statusIcon =
              status === "completed" ? "✓" : status === "in_progress" ? "●" : "○";
            const color =
              status === "completed"
                ? "green"
                : status === "in_progress"
                  ? "yellow"
                  : undefined;
            return (
              <Box key={mod.id}>
                <Text color={i === selectedIdx ? "cyan" : color}>
                  {marker} {statusIcon} {mod.id}  {mod.title}
                  {!hasContent ? "  [run: vibe-course module " + mod.id + "]" : ""}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Text dimColor>
          ↑↓ navigate · Enter open · q quit
        </Text>
        <Text dimColor>
          Skill: {manifest.blueprint.userProfile.skillLevel} · Goals:{" "}
          {manifest.blueprint.userProfile.learningGoals.slice(0, 60)}
        </Text>
      </Box>
    );
  }

  // ── Content not generated ─────────────────────────────────────────
  if (!content) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">
          Module content not generated yet.
        </Text>
        <Text>
          Run: <Text color="cyan">vibe-course module {view.moduleId}</Text>
        </Text>
        <Text dimColor>Press q to go back.</Text>
      </Box>
    );
  }

  // ── Lesson view ───────────────────────────────────────────────────
  if (view.kind === "lesson") {
    return (
      <Box flexDirection="column" padding={1}>
        <LessonViewer
          title={activeModule?.title ?? view.moduleId}
          markdown={content.markdown}
          mermaidDiagrams={content.mermaidDiagrams}
          scrollOffset={scrollOffset}
          maxVisibleLines={maxVisible}
        />
        <Box marginTop={1}>
          <Text dimColor>
            j/k or ↑↓ scroll · e exercise · t checkpoint · q back
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Exercise view ─────────────────────────────────────────────────
  if (view.kind === "exercise") {
    return (
      <Box flexDirection="column" padding={1}>
        {content.breakAndFix ? (
          <ExerciseBox task={content.breakAndFix} completed={exerciseDone} />
        ) : (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold color="yellow">
              Break & Fix Exercise
            </Text>
            <Text>{content.exerciseMarkdown || "No exercise content."}</Text>
          </Box>
        )}
        <Text dimColor>c mark complete · l lesson · t checkpoint · q back</Text>
      </Box>
    );
  }

  // ── Quiz view ─────────────────────────────────────────────────────
  if (view.kind === "quiz") {
    const questions = content.checkpoint.questions;
    if (!questions.length) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No checkpoint questions for this module.</Text>
          <Text dimColor>Press q or l to go back.</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" padding={1}>
        <QuizWidget
          questions={questions}
          onComplete={() => {
            if (activeModule && view.lessonId) {
              try {
                const updated = markLessonComplete(view.moduleId, view.lessonId);
                setManifest(updated);
              } catch {
                // ignore
              }
            }
          }}
        />
        <Text dimColor>l lesson · q back</Text>
      </Box>
    );
  }

  return <Text>Unknown view</Text>;
}
