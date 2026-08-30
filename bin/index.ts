#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "../src/commands/init.js";
import { runModule } from "../src/commands/module.js";
import { runUi } from "../src/commands/ui.js";

const program = new Command();

program
  .name("vibe-course")
  .description(
    "Zero-config CLI that turns local repositories into structured, interactive developer courses"
  )
  .version("1.0.0");

program
  .command("init")
  .description("Scan the workspace and generate a course blueprint into .course/")
  .action(async () => {
    try {
      await runInit(process.cwd());
    } catch (err) {
      console.error("\n❌ init failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program
  .command("module")
  .description("Generate deep-dive lesson content for a module id (e.g. mod-01)")
  .argument("<id>", "Module id from the manifest (e.g. mod-01)")
  .action(async (id: string) => {
    try {
      await runModule(id, process.cwd());
    } catch (err) {
      console.error("\n❌ module failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program
  .command("ui")
  .description("Launch the interactive terminal course UI")
  .action(async () => {
    try {
      await runUi(process.cwd());
    } catch (err) {
      console.error("\n❌ ui failed:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program.parse();
