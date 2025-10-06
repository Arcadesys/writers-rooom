import { App, TAbstractFile, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import type { WriterAgent } from "./agent";

export const AGENTS_FOLDER = "writers-room-agents";

export async function ensureAgentsFolder(app: App): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(AGENTS_FOLDER);
	if (!existing) {
		try {
			await app.vault.createFolder(AGENTS_FOLDER);
		} catch (error) {
			console.error("Writer Room → Failed to create agents folder", error);
		}
	}
}

export async function loadAgentsFromFolder(app: App): Promise<WriterAgent[]> {
	const folder = app.vault.getAbstractFileByPath(AGENTS_FOLDER);
	if (!folder) return [];
	if (!(folder as any).children) return [];
	const children: TAbstractFile[] = (folder as any).children ?? [];
	const agents: WriterAgent[] = [];
	for (const child of children) {
		if (child instanceof TFile && child.extension === "md") {
			const agent = await loadAgentFromFile(app, child);
			if (agent) agents.push(agent);
		}
	}
	return agents.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadAgentFromFile(app: App, file: TFile): Promise<WriterAgent | null> {
	try {
		const raw = await app.vault.read(file);
		const { frontmatter, body } = extractFrontmatter(raw);
		const name = `${frontmatter.name ?? file.basename}`.trim();
		const color = sanitizeColor(frontmatter.color) ?? colorFromString(file.path);
		const systemPrompt = `${frontmatter.prompt ?? frontmatter.systemPrompt ?? body}`.trim();
		if (!systemPrompt) {
			console.warn(`Writer Room → Agent ${file.path} is missing a prompt.`);
			return null;
		}
		return {
			id: file.path,
			name,
			systemPrompt,
			color,
		};
	} catch (error) {
		console.error("Writer Room → Failed to load agent", file.path, error);
		return null;
	}
}

function extractFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
	if (!content.trim().startsWith("---")) {
		return { frontmatter: {}, body: content.trim() };
	}
	const lines = content.split(/\r?\n/);
	if (lines.length < 3 || lines[0].trim() !== "---") {
		return { frontmatter: {}, body: content.trim() };
	}
	let idx = 1;
	while (idx < lines.length && lines[idx].trim() !== "---") {
		idx += 1;
	}
	if (idx >= lines.length) {
		return { frontmatter: {}, body: content.trim() };
	}
	const fmLines = lines.slice(1, idx).join("\n");
	const body = lines.slice(idx + 1).join("\n");
	let frontmatter: Record<string, any> = {};
	try {
		frontmatter = parseYaml(fmLines) ?? {};
	} catch (error) {
		console.error("Writer Room → Failed to parse agent frontmatter", error);
	}
	return { frontmatter, body: body.trim() };
}

function sanitizeColor(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	return null;
}

function colorFromString(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue} 80% 70%)`;
}
