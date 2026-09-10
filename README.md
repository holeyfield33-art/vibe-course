# vibe-course

**Zero-config CLI that turns any local repository into a structured, interactive end-to-end course for developers.**

Focuses on core domain logic, architectural trade-offs, state management, and business outcomes — not boilerplate.

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
| `vibe-course init` | Scan workspace → AST summaries → LLM course blueprint → `.course/manifest.json` |
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
├── bin/index.ts
├── src/
│   ├── commands/     # init, module, ui
│   ├── scanner/      # tree, AST, budget
│   ├── engine/       # LLM client, prompts, Zod enforcement
│   ├── storage/      # .course/manifest.json
│   └── ui/           # Ink TUI
├── package.json
└── tsconfig.json
```

## Ollama configuration

- `OLLAMA_HOST` accepts a bare host (`127.0.0.1:11434`) or a full URL; `http://`
  is added automatically if no scheme is present.
- `OLLAMA_TIMEOUT_MS` (default 15 minutes) controls both the request and
  headers/body timeout used for local-model calls — raise it for slower models
  or larger prompts.

## Known limitations

- `vibe-course init` reads its skill-level/goals prompts interactively; run
  with a non-TTY stdin (piped or redirected) and it exits silently without
  generating a course, rather than erroring or accepting flags. There is
  currently no non-interactive flag — script around it by calling the
  scan → summarize → blueprint pipeline directly if you need to automate `init`.
- No automated test suite yet. Treat schema/pipeline changes as unverified
  until this is added.
- Course quality depends heavily on the model behind it: small local Ollama
  models (e.g. 1.5B) can complete the pipeline and pass schema validation but
  tend to produce generic, low-detail course content. A capable hosted model
  (OpenAI/Anthropic) or a larger local model is recommended for real use.

## License

MIT
