import Anthropic from "@anthropic-ai/sdk";
import { AnthropicError, APIError } from "@anthropic-ai/sdk/error";

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
  durationMs?: number;
  startedAt?: string;
}

const anthropicClients = new Map<string, Anthropic>();

function getAnthropicClient(apiKey: string): Anthropic {
  let client = anthropicClients.get(apiKey);
  if (!client) {
    client = new Anthropic({ apiKey });
    anthropicClients.set(apiKey, client);
  }
  return client;
}

export async function runAgentsSequential(
  settings: WriterRoomSettings,
  agents: WriterAgent[],
  docContent: string
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = [];
  for (const agent of agents) {
    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    try {
      const res = await callAgent(settings, agent, docContent);
      const durationMs = Date.now() - startTime;
      results.push({ ...res, durationMs, startedAt });
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      results.push({ agent, comments: [], error: String(e), durationMs, startedAt });
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

  const client = getAnthropicClient(settings.apiKey);
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: agent.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildDocumentPayload(docContent),
            },
          ],
        },
      ],
    });

    const text = extractAnthropicText(response);
    const comments = parseFeedbackText(text, agent);
    return { agent, raw: response, comments };
  } catch (error: unknown) {
    const message = describeAnthropicError(error);
    return { agent, comments: [], error: message };
  }
}

function extractAnthropicText(json: { content?: Array<{ type?: string; text?: string }> }): string {
  const parts = json?.content ?? [];
  return parts
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

function buildDocumentPayload(docContent: string): string {
  return `Here is the document to review. Provide feedback using [LINE:x] format.\n\n---\n${docContent}\n---`;
}

function describeAnthropicError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof AnthropicError) {
    const apiError = error as APIError;
    const details: string[] = [];
    if (typeof apiError.status === "number") {
      details.push(`HTTP ${apiError.status}`);
    }
    if (apiError.requestID) {
      details.push(`request ${apiError.requestID}`);
    }
    if (apiError.error && typeof apiError.error === "object") {
      const code = (apiError.error as { type?: string; code?: string }).code ?? (apiError.error as { type?: string }).type;
      if (code) {
        details.push(String(code));
      }
    }
    const baseMessage = apiError.message || "Anthropic API error";
    const suffix = details.length ? ` (${details.join(", ")})` : "";
    return `${baseMessage}${suffix}`;
  }
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
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
