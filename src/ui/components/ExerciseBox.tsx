import React from "react";
import { Box, Text } from "ink";
import type { BreakAndFixTask } from "../../engine/schemas.js";
import { wrapText, getTerminalSize } from "../utils/terminalSize.js";

interface Props {
  task: BreakAndFixTask;
  completed: boolean;
}

export function ExerciseBox({ task, completed }: Props): React.ReactElement {
  const { columns } = getTerminalSize();
  const width = Math.max(40, columns - 6);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={completed ? "green" : "yellow"}
      paddingX={1}
      marginY={1}
    >
      <Text bold color={completed ? "green" : "yellow"}>
        {completed ? "✓ Break & Fix Complete" : "⚡ Break & Fix Exercise"}
      </Text>
      <Text dimColor>Target: {task.targetFile}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Instructions</Text>
        {wrapText(task.instructions, width).map((l, i) => (
          <Text key={`i${i}`}>{l}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="red">
          Expected failure mode
        </Text>
        {wrapText(task.expectedFailureMode, width).map((l, i) => (
          <Text key={`f${i}`}>{l}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="green">
          Resolution criteria
        </Text>
        {wrapText(task.resolutionCriteria, width).map((l, i) => (
          <Text key={`r${i}`}>{l}</Text>
        ))}
      </Box>
      {!completed && (
        <Box marginTop={1}>
          <Text dimColor>
            Press [c] to mark this exercise complete after you have fixed the code.
          </Text>
        </Box>
      )}
    </Box>
  );
}
