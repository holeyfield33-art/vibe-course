import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface Props {
  questions: QuizQuestion[];
  onComplete: (score: number, total: number) => void;
}

export function QuizWidget({ questions, onComplete }: Props): React.ReactElement {
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[qIndex];

  useInput((input, key) => {
    if (finished || !q) return;

    if (!revealed) {
      if (key.upArrow) {
        setSelected((s) => (s > 0 ? s - 1 : q.options.length - 1));
      } else if (key.downArrow) {
        setSelected((s) => (s < q.options.length - 1 ? s + 1 : 0));
      } else if (key.return) {
        const correct = selected === q.correctIndex;
        if (correct) setScore((s) => s + 1);
        setRevealed(true);
      }
    } else {
      if (key.return || input === " ") {
        if (qIndex + 1 >= questions.length) {
          setFinished(true);
          // score already includes this question from the confirm step
          onComplete(score, questions.length);
        } else {
          setQIndex((i) => i + 1);
          setSelected(0);
          setRevealed(false);
        }
      }
    }
  });

  if (!q) {
    return (
      <Box>
        <Text color="red">No questions available.</Text>
      </Box>
    );
  }

  if (finished) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text bold color="green">
          Checkpoint complete
        </Text>
        <Text>
          Score: {score}/{questions.length}
        </Text>
        <Text dimColor>Press [q] to return to module list.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        Checkpoint {qIndex + 1}/{questions.length}
      </Text>
      <Box marginY={1}>
        <Text>{q.prompt}</Text>
      </Box>
      {q.options.map((opt, i) => {
        const isSel = i === selected;
        let color: string | undefined;
        if (revealed) {
          if (i === q.correctIndex) color = "green";
          else if (isSel) color = "red";
        } else if (isSel) {
          color = "cyan";
        }
        return (
          <Text key={i} color={color}>
            {isSel ? "❯ " : "  "}
            {String.fromCharCode(65 + i)}. {opt}
          </Text>
        );
      })}
      {revealed && (
        <Box marginTop={1} flexDirection="column">
          <Text color={selected === q.correctIndex ? "green" : "red"}>
            {selected === q.correctIndex ? "Correct!" : "Not quite."}
          </Text>
          <Text dimColor>{q.explanation}</Text>
          <Text dimColor>
            {qIndex + 1 >= questions.length
              ? "Press Enter to finish."
              : "Press Enter for next question."}
          </Text>
        </Box>
      )}
      {!revealed && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ select · Enter confirm</Text>
        </Box>
      )}
    </Box>
  );
}
