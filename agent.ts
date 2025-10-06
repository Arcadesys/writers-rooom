export interface WriterAgent {
  id: string;
  name: string;
  systemPrompt: string;
  enabled: boolean;
  color: string;
}

export interface WriterRoomSettings {
  agents: WriterAgent[];
  apiKey: string;
  modelName: string;
}

export const DEFAULT_SETTINGS: WriterRoomSettings = {
  agents: [],
  apiKey: "",
  modelName: ""
};

export function createAgent(partial?: Partial<WriterAgent>): WriterAgent {
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: partial?.name ?? "New Agent",
    systemPrompt: partial?.systemPrompt ?? "",
    enabled: partial?.enabled ?? true,
    color: partial?.color ?? randomColor(),
  };
}

function randomColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue} 80% 70%)`;
}

type FetchResult = Response | { text: string };

export interface WriterComment {
  line: number;
  text: string;
  agentId: string;
  agentName: string;
  color: string;
}

export interface AgentRunResult {
  agent: WriterAgent;
  raw?: unknown;
  comments: WriterComment[];
  error?: string;
}

export async function runAgentsSequential(
  settings: WriterRoomSettings,
  agents: WriterAgent[],
  docContent: string
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = [];
  for (const agent of agents) {
    try {
      const res = await callAgent(settings, agent, docContent);
      results.push(res);
    } catch (e: any) {
      results.push({ agent, comments: [], error: String(e) });
    }
  }
  return results;
}

export async function callAgent(
  settings: WriterRoomSettings,
  agent: WriterAgent,
  docContent: string
): Promise<AgentRunResult> {
  const model = settings.modelName?.trim() || "claude-3-5-sonnet-20240620";
  if (model.startsWith("gpt")) {
    return callAgentOpenAI(settings, agent, docContent, model);
  }
  return callAgentClaude(settings, agent, docContent, model);
}

async function callAgentClaude(
  settings: WriterRoomSettings,
  agent: WriterAgent,
  docContent: string,
  model: string
): Promise<AgentRunResult> {
  if (!settings.apiKey) {
    return { agent, comments: [], error: "Missing API key" };
  }

  const body = {
    model,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: `${agent.systemPrompt}\n\n---\n\n${docContent}`,
      },
    ],
  } as const;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await safeText(resp);
    return { agent, comments: [], error: `HTTP ${resp.status}: ${text}` };
  }
  const json = await resp.json();
  const text = extractAnthropicText(json);
  const comments = parseFeedbackText(text, agent);
  return { agent, raw: json, comments };
}

async function callAgentOpenAI(
  settings: WriterRoomSettings,
  agent: WriterAgent,
  docContent: string,
  model: string
): Promise<AgentRunResult> {
  if (!settings.apiKey) {
    return { agent, comments: [], error: "Missing API key" };
  }

  const body = {
    model,
    messages: [
      { role: "system", content: agent.systemPrompt || "You are an assistant." },
      { role: "user", content: docContent },
    ],
    temperature: 0.2,
  } as const;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await safeText(resp);
    return { agent, comments: [], error: `HTTP ${resp.status}: ${text}` };
  }
  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content || "";
  const comments = parseFeedbackText(text, agent);
  return { agent, raw: json, comments };
}

function extractAnthropicText(json: any): string {
  const parts = json?.content ?? [];
  return parts
    .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
    .map((p: any) => p.text)
    .join("\n\n");
}

async function safeText(resp: FetchResult): Promise<string> {
  try {
    if (resp instanceof Response) {
      return await resp.text();
    }
    return (resp as any)?.text ?? "";
  } catch {
    return "";
  }
}

export function parseFeedbackText(text: string, agent: WriterAgent): WriterComment[] {
  const out: WriterComment[] = [];
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  const re = /^\s*\[LINE\s*:\s*(\d+)\s*\]\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(re);
    if (!match) continue;
    const lineNum = parseInt(match[1], 10);
    const comment = match[2].trim();
    if (!Number.isNaN(lineNum) && comment) {
      out.push({
        line: lineNum,
        text: comment,
        agentId: agent.id,
        agentName: agent.name,
        color: agent.color,
      });
    }
  }
  return out;
}
