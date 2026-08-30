import React from "react";
import { render } from "ink";
import { App } from "../ui/App.js";
import { manifestExists } from "../storage/manifestManager.js";

export async function runUi(workspaceRoot: string = process.cwd()): Promise<void> {
  if (!manifestExists(workspaceRoot)) {
    console.error("No course found. Run `vibe-course init` first.");
    process.exitCode = 1;
    return;
  }

  // Ensure we are in the workspace so relative paths resolve
  if (workspaceRoot !== process.cwd()) {
    process.chdir(workspaceRoot);
  }

  const { waitUntilExit } = render(React.createElement(App));
  await waitUntilExit();
}
