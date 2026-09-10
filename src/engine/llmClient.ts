/**
 * Multi-provider LLM client.
 * Supports OpenAI, Anthropic, and Ollama via environment variables.
 * No heavy SDK dependency — uses native fetch for maximum portability.
 */
// Mixing Node's built-in fetch (its own bundled undici copy) with a dispatcher
// built from the standalone `undici` package breaks at the handler-interface
// level (UND_ERR_INVALID_ARG). Use undici's own fetch + Agent together so
// both come from the same version.
import { Agent, fetch as undiciFetch } from "undici";

export type Provider = "openai" | "anthropic" | "ollama";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMResponse {
  content: string;
  provider: Provider;
  model: string;
}

function detectProvider(): { provider: Provider; model: string; baseUrl: string; apiKey: string } {
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  // Default to Ollama local. OLLAMA_HOST is commonly set without a scheme
  // (e.g. "127.0.0.1:11434", matching Ollama's own CLI convention) — fetch
  // rejects that outright, so normalize it rather than crash on a raw URL error.
  let host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  return {
    provider: "ollama",
    model: process.env.OLLAMA_MODEL ?? "llama3.2",
    baseUrl: host,
    apiKey: "",
  };
}

async function callOpenAI(
  messages: LLMMessage[],
  opts: LLMOptions,
  cfg: ReturnType<typeof detectProvider>
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

async function callAnthropic(
  messages: LLMMessage[],
  opts: LLMOptions,
  cfg: ReturnType<typeof detectProvider>
): Promise<string> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.4,
    system,
    messages: userMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  };

  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

async function callOllama(
  messages: LLMMessage[],
  opts: LLMOptions,
  cfg: ReturnType<typeof detectProvider>
): Promise<string> {
  const body = {
    model: cfg.model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.4,
      num_predict: opts.maxTokens ?? 4096,
    },
    format: opts.jsonMode ? "json" : undefined,
  };

  // Local models can genuinely take minutes on modest hardware. Two separate
  // timeouts can kill this before Ollama replies: our own AbortSignal (fine,
  // we control it) and undici's internal headersTimeout/bodyTimeout, which
  // default to 5 minutes and fire regardless of the AbortSignal we pass to
  // fetch. Only a custom dispatcher raises that ceiling. Let OLLAMA_TIMEOUT_MS
  // override both; default to 15 minutes.
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 15 * 60 * 1000);
  const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });

  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(`${cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        `Ollama request timed out after ${timeoutMs}ms waiting on model "${cfg.model}". ` +
          `Try a smaller model, or raise the limit with OLLAMA_TIMEOUT_MS.`
      );
    }
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Ollama error ${res.status}: ${errText}\nIs Ollama running? Try: ollama serve`
    );
  }

  const data = (await res.json()) as { message: { content: string } };
  return data.message?.content ?? "";
}

/**
 * Send a chat completion request to the configured provider.
 */
export async function chat(
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<LLMResponse> {
  if (process.env.VIBE_COURSE_MOCK === "1") {
    return {
      content: buildMockResponse(messages),
      provider: "ollama",
      model: "mock",
    };
  }

  const cfg = detectProvider();

  let content: string;
  switch (cfg.provider) {
    case "openai":
      content = await callOpenAI(messages, opts, cfg);
      break;
    case "anthropic":
      content = await callAnthropic(messages, opts, cfg);
      break;
    case "ollama":
      content = await callOllama(messages, opts, cfg);
      break;
    default:
      throw new Error(`Unknown provider: ${cfg.provider as string}`);
  }

  return {
    content: content.trim(),
    provider: cfg.provider,
    model: cfg.model,
  };
}

export function getActiveProvider(): { provider: Provider; model: string } {
  const cfg = detectProvider();
  return { provider: cfg.provider, model: cfg.model };
}

export function hasAnyProviderConfigured(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OLLAMA_HOST ||
    true // Ollama is always a fallback (may or may not be running)
  );
}

function buildMockResponse(messages: LLMMessage[]): string {
  const prompt = messages.map((m) => m.content).join("\n\n");
  if (prompt.includes('"courseTitle"')) {
    return JSON.stringify({
      courseTitle: "Runtime Firewall MVP Developer Course",
      architectureOverview:
        "This course explains how the runtime firewall scans policy inputs, routes decisions through agent-facing controls, and validates behavior with tests and operational scripts. It is generated in mock mode so the course UI and storage flow can be tested without waiting on an external LLM.",
      userProfile: {
        skillLevel: "intermediate",
        learningGoals:
          "Understand the runtime firewall architecture, policy flow, agent behavior, tests, and how to safely ship changes.",
      },
      modules: [
        {
          id: "mod-01",
          title: "Repository Map and Runtime Boundaries",
          estimatedMinutes: 30,
          businessOutcomeFocus:
            "Build confidence navigating the runtime firewall MVP and identifying the files that control execution behavior.",
          filesInvolved: ["package.json", "README.md"],
          lessons: [
            {
              id: "lesson-01",
              title: "How the repo is organized",
              targetFiles: ["package.json", "README.md"],
              conceptsTaught: ["entry points", "package scripts", "documentation as operating context"],
              breakAndFixTask: {
                targetFile: "README.md",
                instructions:
                  "Find one setup or run instruction in the README and verify whether it matches package.json. Update the README if the command has drifted.",
                expectedFailureMode:
                  "A new contributor follows stale documentation and runs the wrong command.",
                resolutionCriteria:
                  "The documented command sequence matches the scripts and can be followed from a fresh checkout.",
              },
            },
          ],
        },
        {
          id: "mod-02",
          title: "Policy Flow and Decision Points",
          estimatedMinutes: 45,
          businessOutcomeFocus:
            "Understand where requests become allow, block, audit, or review decisions.",
          filesInvolved: ["policy.signed.json", "packages"],
          lessons: [
            {
              id: "lesson-01",
              title: "Following a policy from config to enforcement",
              targetFiles: ["policy.signed.json", "packages"],
              conceptsTaught: ["policy schema", "decision lifecycle", "enforcement boundaries"],
              breakAndFixTask: {
                targetFile: "policy.signed.json",
                instructions:
                  "Trace one policy rule to the code that consumes it, then add a note describing the expected behavior before changing any code.",
                expectedFailureMode:
                  "A rule appears configured but is not enforced where the operator expects.",
                resolutionCriteria:
                  "The trace identifies the config field, consumer, and expected observable result.",
              },
            },
          ],
        },
      ],
    });
  }

  return JSON.stringify({
    markdown:
      "# Mock Lesson\n\nThis lesson was generated with `VIBE_COURSE_MOCK=1` to validate the CLI, storage, and UI flow.\n\n## What to inspect\n\nOpen the target files listed in the module manifest and compare the generated course claims against the repository. Replace mock mode with a real LLM provider for production-quality lessons.",
    mermaidDiagrams: [
      "flowchart TD\n  A[Repository scan] --> B[Course manifest]\n  B --> C[Module generation]\n  C --> D[Terminal UI]",
    ],
    exerciseMarkdown:
      "# Break & Fix Exercise\n\nUse this mock exercise to verify that generated exercise files render in the UI. For a real run, configure OpenAI, Anthropic, or a responsive Ollama model.",
    checkpoint: {
      questions: [
        {
          id: "q1",
          prompt: "What does `vibe-course init` create first?",
          options: [".course/manifest.json", "A production build", "A GitHub release"],
          correctIndex: 0,
          explanation: "Initialization creates the course manifest and module scaffold.",
        },
        {
          id: "q2",
          prompt: "Why was mock mode used in this run?",
          options: [
            "To test the generated course UI and files without waiting on a slow local model",
            "To skip scanning the repository",
            "To delete generated modules",
          ],
          correctIndex: 0,
          explanation: "Mock mode only replaces the LLM response; scanning and file writing still run.",
        },
      ],
    },
  });
}
