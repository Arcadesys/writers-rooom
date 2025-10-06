export interface WriterAgent {
  id: string;
  name: string;
  systemPrompt: string;
  color: string;
}

export interface WriterRoomSettings {
  apiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: WriterRoomSettings = {
  apiKey: "",
  model: "latest",
};

export const CLAUDE_MODELS = [
  { id: "latest", label: "Latest (recommended)" },
  { id: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (2024-06-20)" },
  { id: "claude-3-opus-20240229", label: "Claude 3 Opus (2024-02-29)" },
  { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku (2024-03-07)" },
];

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
  const model = resolveClaudeModel(settings.model);
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

function extractAnthropicText(json: any): string {
  const parts = json?.content ?? [];
  return parts
    .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
    .map((p: any) => p.text)
    .join("\n\n");
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
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

function resolveClaudeModel(model: string | undefined): string {
  if (!model || model === "latest") {
    return "claude-3-5-sonnet-latest";
  }
  return model;
}
