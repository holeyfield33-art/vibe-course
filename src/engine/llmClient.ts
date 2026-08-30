/**
 * Multi-provider LLM client.
 * Supports OpenAI, Anthropic, and Ollama via environment variables.
 * No heavy SDK dependency — uses native fetch for maximum portability.
 */

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
  // Default to Ollama local
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
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

  const res = await fetch(`${cfg.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
