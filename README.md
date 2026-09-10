# vibe-course

**Zero-config CLI that turns any local repository into a structured, interactive end-to-end course for developers.**

Focuses on core domain logic, architectural trade-offs, state management, and business outcomes â€” not boilerplate.

## Requirements

- Node.js 20+
- An LLM provider:
  - `OPENAI_API_KEY` (optional `OPENAI_MODEL`, default `gpt-4o`)
  - **or** `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`)
  - **or** local [Ollama](https://ollama.com) (`OLLAMA_HOST`, `OLLAMA_MODEL`)

## Install / Run

```bash
# from this package
npm install
npm run build

# use via npx / local bin
npx vibe-course init
npx vibe-course module mod-01
npx vibe-course ui
```

Or link globally:

```bash
npm link
vibe-course init
```

## Commands

| Command | Description |
|---------|-------------|
| `vibe-course init` | Scan workspace â†’ AST summaries â†’ LLM course blueprint â†’ `.course/manifest.json` |
| `vibe-course module <id>` | Generate lesson Markdown, Mermaid diagrams, Break & Fix exercise, and quiz checkpoint |
| `vibe-course ui` | Interactive Ink TUI â€” browse modules, read lessons, run exercises & quizzes |

## How it works

1. **Scanner** walks the repo with `globby` + `.gitignore` / `.courseignore`, extracts export/interface/class signatures via Babel AST (no execution).
2. **Context budgeter** partitions files into logical modules and estimates token cost so prompts stay focused.
3. **LLM engine** supports OpenAI, Anthropic, and Ollama. All structured outputs are validated with Zod (1 automatic repair retry).
4. **Storage** keeps everything inside `.course/` (auto git-ignored).
5. **Ink UI** renders lessons, Mermaid source, exercises, and interactive checkpoints in the terminal.

## Project layout

```
vibe-course/
â”œâ”€â”€ bin/index.ts
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ commands/     # init, module, ui
â”‚   â”œâ”€â”€ scanner/      # tree, AST, budget
â”‚   â”œâ”€â”€ engine/       # LLM client, prompts, Zod enforcement
â”‚   â”œâ”€â”€ storage/      # .course/manifest.json
â”‚   â””â”€â”€ ui/           # Ink TUI
â”œâ”€â”€ package.json
â””â”€â”€ tsconfig.json
```

## License

MIT
