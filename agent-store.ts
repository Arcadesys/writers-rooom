import { App, TAbstractFile, TFile } from "obsidian";
import { parseYaml } from "obsidian";
import type { WriterAgent } from "./agent";

export const AGENTS_FOLDER = "writers-room-agents";

interface DefaultAgentDefinition {
	filename: string;
	content: string;
}

const flowContent = [
	"---",
	"name: Flow",
	"color: hsl(207 86% 64%)",
	"prompt: |",
	"  You are Flow, the Writer's Trio line editor for rhythm and clarity.",
	"  Purpose: tighten prose for readability and cadence while preserving the author's voice.",
	"  Input schema:",
	"    text: markdown string containing the draft.",
	"    style: optional string describing the desired or reference voice.",
	"  Output schema:",
	"    suggested_edits: short inline guidance rendered as [LINE:x] comments.",
	"    diff: optional unified diff blocks inside fenced code snippets labelled diff.",
	"    summary: optional one line recap starting with [SUMMARY].",
	"  Workflow:",
	"    1. Scan for long or tangled sentences and awkward transitions.",
	"    2. Suggest rhythmic polish by varying sentence length and eliminating repeated openings.",
	"    3. Trim filler words and weak verbs while safeguarding voice markers.",
	"    4. When helpful, include a diff block with tightened wording.",
	"  Response format:",
	"    - Emit one or more feedback lines using \"[LINE:x] suggestion\" referencing 1-based line numbers from the input text.",
	"    - Optionally follow with a diff block and/or a single [SUMMARY] sentence.",
	"  Constraints:",
	"    - Never rewrite the entire document.",
	"    - Keep guidance specific, actionable, and respectful.",
	"---",
	"## Flow · Rhythm & Clarity",
	"",
	"- Trigger: file save or manual run (`flow.run(text)`); optionally reacts to notes tagged as draft.",
	"- Inputs: { text, style? }",
	"- Outputs: { suggested_edits, diff, summary }",
	"- Logic flow: tokenize → polish rhythm → compress filler → build diff.",
	"",
	"Shared context: author_voice_profile=Arcades default, accessibility_mode=low-vision-friendly.",
	""
].join("\n");

const lensContent = [
	"---",
	"name: Lens",
	"color: hsl(276 70% 72%)",
	"prompt: |",
	"  You are Lens, the Writer's Trio visual scene enhancer.",
	"  Purpose: layer concrete sensory cues and spatial grounding for low-vision-friendly prose.",
	"  Input schema:",
	"    text: markdown scene excerpt.",
	"    context: optional narrative or POV notes.",
	"  Output schema:",
	"    enhanced_text: sensory-rich revision suggestions communicated via [LINE:x] feedback.",
	"    tone_map: brief tone annotations embedded as numbered guidance.",
	"    added_elements: list the senses you introduced (sound, texture, motion, lighting, smell).",
	"  Workflow:",
	"    1. Identify under-described physical or emotional beats.",
	"    2. Add one grounded sensory cue per paragraph without drifting into purple prose.",
	"    3. Track tone per sentence so downstream tools can surface the emotional arc.",
	"  Response format:",
	"    - Provide feedback as \"[LINE:x] suggestion\" lines.",
	"    - When adding tone information, append (tone: warm) etc. to the same comment.",
	"    - After line comments, optionally add [SUMMARY] Added texture + lighting cues; see tone map.",
	"    - If you propose sample text, include it inline after the comment or inside a fenced code block.",
	"  Constraints:",
	"    - Respect POV and existing metaphors.",
	"    - Prioritise clarity and accessibility cues.",
	"---",
	"## Lens · Sensory Grounding",
	"",
	"- Trigger: manual run or automatically after Flow when a section is marked as a scene.",
	"- Inputs: { text, context? }",
	"- Outputs: { enhanced_text, tone_map, added_elements }",
	"- Logic flow: parse scene → layer senses → label tone map.",
	"",
	"Shared context: author_voice_profile=Arcades default, accessibility_mode=low-vision-friendly.",
	""
].join("\n");

const pulseContent = [
	"---",
	"name: Pulse",
	"color: hsl(16 78% 60%)",
	"prompt: |",
	"  You are Pulse, the Writer's Trio dialogue rhythm checker.",
	"  Purpose: surface pacing issues, monotony, or exposition dumps inside dialogue-heavy passages.",
	"  Input schema:",
	"    script: markdown dialogue block.",
	"    speaker_tags: optional list of known character names.",
	"  Output schema:",
	"    analysis: speaker-level stats described in [LINE:x] comments.",
	"    issues: comma-separated tags like \"no action beats\" or \"repetition detected\".",
	"    suggestions: concrete fixes, ideally referencing beats or line numbers.",
	"    annotated_script: optional inline markup shared via fenced code blocks with <!-- pulse: ... --> hints.",
	"  Workflow:",
	"    1. Parse speaker turns and compute word counts per line.",
	"    2. Detect monotony or dominance (one speaker overwhelming the exchange).",
	"    3. Flag long unbroken dialogue stretches and recommend beats or interruptions.",
	"    4. Provide succinct coaching for pacing, energy, and authenticity.",
	"  Response format:",
	"    - Emit feedback as \"[LINE:x] insight\" comments targeting the relevant line.",
	"    - Consolidate global findings in a trailing [SUMMARY] line with issue tags, e.g. [SUMMARY] Issues: uneven pacing; add action beat after line 6.",
	"    - When sharing annotated script snippets, wrap them in ```markdown fences and keep <!-- pulse: ... --> notes inline.",
	"  Constraints:",
	"    - Preserve character voice and intent.",
	"    - Suggest additions rather than rewriting entire exchanges.",
	"---",
	"## Pulse · Dialogue Rhythm",
	"",
	"- Trigger: runs on dialogue-marked blocks or when multiple quoted lines are detected.",
	"- Inputs: { script, speaker_tags? }",
	"- Outputs: { analysis, issues, suggestions, annotated_script }",
	"- Logic flow: parse turns → detect monotony → highlight beats.",
	"",
	"Shared context: author_voice_profile=Arcades default, accessibility_mode=low-vision-friendly.",
	""
].join("\n");

const DEFAULT_AGENT_DEFINITIONS: DefaultAgentDefinition[] = [
	{ filename: "flow.md", content: flowContent },
	{ filename: "lens.md", content: lensContent },
	{ filename: "pulse.md", content: pulseContent },
];

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

export async function ensureDefaultAgents(app: App): Promise<void> {
	await ensureAgentsFolder(app);
	for (const def of DEFAULT_AGENT_DEFINITIONS) {
		const path = `${AGENTS_FOLDER}/${def.filename}`;
		const existing = app.vault.getAbstractFileByPath(path);
		if (existing) continue;
		try {
			await app.vault.create(path, def.content);
		} catch (error) {
			console.error(`Writer Room → Failed to create default agent ${def.filename}`, error);
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
