import { App, Editor, Notice, Plugin, MarkdownView, TFile, WorkspaceLeaf, TAbstractFile, Modal, Setting } from "obsidian";
import { DEFAULT_SETTINGS, type WriterAgent, type WriterRoomSettings, runAgentsSequential, type WriterComment } from "./agent";
import { applyComments, clearComments } from "./comment-renderer";
import { WriterRoomSettingTab } from "./settings";
import { ensureAgentsFolder, ensureDefaultAgents, loadAgentsFromFolder, AGENTS_FOLDER } from "./agent-store";
import { WriterRoomSidebarView, VIEW_TYPE_WRITER_ROOM } from "./sidebar-view";

export default class WriterRoomPlugin extends Plugin {
	settings: WriterRoomSettings;
	agents: WriterAgent[] = [];
	selectedAgentIds: Set<string> = new Set();
	sidebarView: WriterRoomSidebarView | null = null;
	private agentRefreshTimer: number | null = null;
	private runCounter = 0;

	async onload() {
		await this.loadSettings();
		await ensureAgentsFolder(this.app);
		await ensureDefaultAgents(this.app);
		await this.refreshAgents();

		this.registerView(VIEW_TYPE_WRITER_ROOM, (leaf: WorkspaceLeaf) => {
			const view = new WriterRoomSidebarView(leaf, this);
			this.sidebarView = view;
			return view;
		});

		await this.activateSidebar();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.sidebarView?.render();
			})
		);
		this.registerAgentWatchers();

		// settings tab for agent configuration and API setup
		this.addSettingTab(new WriterRoomSettingTab(this.app, this));

		// ribbon button to trigger feedback run on the active note
		this.addRibbonIcon("bot", "Run Writer Room", async () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view?.editor;
			if (!editor) {
				new Notice("Open a Markdown file to run Writer Room.");
				return;
			}
			await this.runWriterRoomInteractive(editor, view);
		});

		// command palette shortcut
		this.addCommand({
			id: "writer-room-run",
			name: "Run Writer Room",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "R" }],
			editorCallback: async (editor, view) => {
				await this.runWriterRoomInteractive(editor, view as MarkdownView);
			},
		});

		// editor context menu entry
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				menu.addItem((item) =>
					item
						.setTitle("Run Writer Room")
						.setIcon("bot")
						.onClick(async () => {
							await this.runWriterRoomInteractive(editor, view as MarkdownView);
						})
				);
			})
		);

		// command to clear inline comments
		this.addCommand({
			id: "writer-room-clear-comments",
			name: "Clear Writer Room Comments",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "C" }],
			editorCallback: async (editor, view) => {
				const cm: any = (view as any)?.editor?.cm;
				if (cm) clearComments(cm);
				new Notice("Writer Room: Cleared comments.");
			},
		});

		// export feedback summary into a new note
		this.addCommand({
			id: "writer-room-export-feedback",
			name: "Export Writer Room Feedback",
			callback: async () => {
				await this.exportFeedback();
			},
		});

		this.addCommand({
			id: "writer-room-create-agent",
			name: "Writer Room: Add New Agent",
			callback: async () => {
				await this.createNewAgentCommand();
			},
		});
	}

	onunload() {
		if (this.agentRefreshTimer) {
			window.clearTimeout(this.agentRefreshTimer);
			this.agentRefreshTimer = null;
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refreshAgents() {
		this.agents = await loadAgentsFromFolder(this.app);
		this.syncSelectedAgents();
		this.sidebarView?.render();
	}

	private syncSelectedAgents() {
		const existingIds = new Set(this.agents.map((agent) => agent.id));
		for (const id of Array.from(this.selectedAgentIds)) {
			if (!existingIds.has(id)) {
				this.selectedAgentIds.delete(id);
			}
		}
		if (!this.selectedAgentIds.size) {
			for (const id of existingIds) {
				this.selectedAgentIds.add(id);
			}
		}
	}

	private registerAgentWatchers() {
		this.registerEvent(
			this.app.vault.on("create", (file) => this.onVaultChanged(file))
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => this.onVaultChanged(file))
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => this.onVaultChanged(file))
		);
	}

	private onVaultChanged(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;
		if (!file.path.startsWith(`${AGENTS_FOLDER}/`)) return;
		this.scheduleAgentRefresh();
	}

	private scheduleAgentRefresh() {
		if (this.agentRefreshTimer) {
			window.clearTimeout(this.agentRefreshTimer);
		}
		this.agentRefreshTimer = window.setTimeout(() => {
			this.agentRefreshTimer = null;
			void this.refreshAgents();
		}, 300);
	}

	private async activateSidebar() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITER_ROOM);
		if (leaves.length === 0) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: VIEW_TYPE_WRITER_ROOM, active: false });
			} else {
				console.warn("Writer Room → Unable to create sidebar leaf");
			}
		} else if (!this.sidebarView) {
			const view = leaves[0].view;
			if (view instanceof WriterRoomSidebarView) {
				this.sidebarView = view;
			}
		}
	}

	getAgents(): WriterAgent[] {
		return this.agents;
	}

	isAgentSelected(id: string): boolean {
		return this.selectedAgentIds.has(id);
	}

	setAgentSelected(id: string, selected: boolean) {
		if (selected) {
			this.selectedAgentIds.add(id);
		} else {
			this.selectedAgentIds.delete(id);
		}
		this.sidebarView?.render();
	}

	canRunSelectedAgents(): boolean {
		return this.getSelectedAgents().length > 0 && !!this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	getSelectedAgents(): WriterAgent[] {
		const selected = new Set(this.selectedAgentIds);
		return this.agents.filter((agent) => selected.has(agent.id));
	}

	async runSelectedAgentsFromSidebar() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor;
		if (!editor) {
			new Notice("Open a Markdown file to run Writer Room.");
			return;
		}
		await this.runWriterRoom(editor, view, this.getSelectedAgents());
	}

	private async runWriterRoomInteractive(editor: Editor, view?: MarkdownView) {
		await this.ensureSidebarVisible();
		if (!this.agents.length) {
			new Notice("Writer Room: No agents available. Add markdown agents to the writers-room-agents folder.");
			return;
		}

		const chosen = await this.promptForAgentsToRun();
		if (!chosen || !chosen.length) {
			return;
		}

		this.setSelectedAgentIds(chosen.map((agent) => agent.id));
		await this.runWriterRoom(editor, view, chosen);
	}

	private setSelectedAgentIds(ids: Iterable<string>) {
		this.selectedAgentIds = new Set(ids);
		this.sidebarView?.render();
	}

	private async ensureSidebarVisible() {
		await this.activateSidebar();
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITER_ROOM);
		if (leaves.length) {
			const leaf = leaves[0];
			this.app.workspace.revealLeaf(leaf);
			const view = leaf.view;
			if (view instanceof WriterRoomSidebarView) {
				this.sidebarView = view;
				view.render();
			}
		}
	}

	private async promptForAgentsToRun(): Promise<WriterAgent[] | null> {
		if (!this.agents.length) {
			return null;
		}
		const initial = new Set(this.selectedAgentIds);
		const selectedIds = await new Promise<string[] | null>((resolve) => {
			const modal = new AgentSelectionModal(this.app, this.agents, initial, resolve);
			modal.open();
		});
		if (!selectedIds || !selectedIds.length) {
			return null;
		}
		const selectedSet = new Set(selectedIds);
		return this.agents.filter((agent) => selectedSet.has(agent.id));
	}

	async openAgentsFolder() {
		await ensureAgentsFolder(this.app);
		const folder = this.app.vault.getAbstractFileByPath(AGENTS_FOLDER);
		if (!folder) {
			new Notice("Writer Room: Unable to locate agents folder.");
			return;
		}

		const explorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
		if (explorerLeaf?.view && typeof (explorerLeaf.view as any).revealInFolder === "function") {
			// Reveal the existing folder instead of triggering Obsidian to create a new one
			(explorerLeaf.view as any).revealInFolder(folder);
			this.app.workspace.revealLeaf(explorerLeaf);
			return;
		}

		this.app.workspace.openLinkText(AGENTS_FOLDER, "", false);
	}

	async createExampleAgent() {
		await ensureAgentsFolder(this.app);
		const path = `${AGENTS_FOLDER}/example-agent.md`;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing) {
			new Notice("Example agent already exists.");
			return;
		}
		try {
			await this.createAgentFile(path, {
				name: "Punch-Up Specialist",
				color: "hsl(12 80% 60%)",
				body: "You are the punch-up specialist in a TV writer's room.\n\nFocus on infusing dialogue with wit and tightening scenes.\nRespond with inline feedback using the format: [LINE:12] Note.",
			});
			new Notice("Created example agent in writers-room-agents.");
		} catch (error) {
			console.error("Writer Room → failed to create example agent", error);
			new Notice("Writer Room: Failed to create example agent.");
			return;
		}
		await this.refreshAgents();
	}

	private async createAgentFile(
		path: string,
		options: { name?: string; color?: string; body?: string }
	) {
		const { name = "New Agent", color = "hsl(210 80% 70%)", body = "" } = options;
		const content = `---\nname: ${name}\ncolor: ${color}\n---\n${body}`;
		await this.app.vault.create(path, content);
	}

	private generateAgentFilename(baseName: string): string {
		const sanitized = baseName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			|| "agent";
		let candidate = `${AGENTS_FOLDER}/${sanitized}.md`;
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${AGENTS_FOLDER}/${sanitized}-${counter}.md`;
			counter += 1;
		}
		return candidate;
	}

	private async createNewAgentCommand() {
		await ensureAgentsFolder(this.app);
		const name = await this.promptForAgentName();
		if (!name) {
			return;
		}
		const path = this.generateAgentFilename(name);
		const body = `You are ${name} in a writer's room.\n\nDescribe your speciality and provide feedback as [LINE:x] comments.`;
		try {
			await this.createAgentFile(path, { name, body });
		} catch (error) {
			console.error("Writer Room → failed to create agent", error);
			new Notice("Writer Room: Failed to create agent file.");
			return;
		}
		await this.refreshAgents();
		new Notice(`Created agent “${name}”.`);
		await this.openAgentFile(path);
	}

	private async promptForAgentName(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new (class extends PromptModal {
				constructor(plugin: WriterRoomPlugin) {
					super(plugin.app, "New Agent Name", "e.g. Structure Specialist");
				}

				onSubmit(value: string) {
					resolve(value.trim());
				}

				onCancel() {
					resolve(null);
				}
			})(this);
			modal.open();
		});
	}

	private async openAgentFile(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		}
	}

	// orchestrates agent execution and inline feedback application
	async runWriterRoom(editor: Editor, view?: MarkdownView, agentsOverride?: WriterAgent[]) {
		const doc = editor.getValue();
		let agentsToRun = agentsOverride && agentsOverride.length ? agentsOverride : this.getSelectedAgents();
		if (!agentsToRun.length) {
			agentsToRun = this.agents;
		}

		const runId = ++this.runCounter;
		const runLabel = `Writer Room Run #${runId}`;
		const groupLabel = `[Writer Room] ${runLabel}`;
		const startedAt = new Date();
		const activeFilePath = view?.file?.path ?? this.app.workspace.getActiveFile()?.path ?? "(unsaved)";
		const configuredModel = this.settings.model || "latest";
		const agentNames = agentsToRun.map((agent) => `${agent.name} (${agent.id})`);

		console.groupCollapsed(groupLabel);
		console.log("Started:", startedAt.toLocaleString());
		console.log("Source file:", activeFilePath);
		console.log("Document length:", doc.length);
		console.log("Configured model:", configuredModel);
		console.log("Agents requested:", agentNames.length ? agentNames : ["<none>"]);

		if (!agentsToRun.length) {
			console.warn("Aborting run → no agents available.");
			console.groupEnd();
			new Notice("Writer Room: No agents available. Add markdown agents to the writers-room-agents folder.");
			return;
		}

		if (!this.settings.apiKey) {
			console.warn("Aborting run → missing API key in settings.");
			console.groupEnd();
			new Notice("Writer Room: Missing API key in settings.");
			return;
		}

		const agentCount = agentsToRun.length;
		const status = this.addStatusBarItem();
		status.setText(`Writer Room: Running ${agentCount} agent(s)...`);
		new Notice(`Writer Room: Running ${agentCount} agent(s)...`);

		const runStart = Date.now();

		try {
			const results = await runAgentsSequential(this.settings, agentsToRun, doc);
			let totalComments = 0;
			const allComments: WriterComment[] = [];
			const agentSummaries: { agent: string; comments: number; duration: string; error?: string }[] = [];

			for (const r of results) {
				const commentCount = r.comments.length;
				totalComments += commentCount;
				allComments.push(...r.comments);
				agentSummaries.push({
					agent: r.agent.name,
					comments: commentCount,
					duration: this.formatDuration(r.durationMs),
					error: r.error,
				});

				const agentLabel = `${r.agent.name} (${r.agent.id})`;
				if (r.error) {
					console.error(`${agentLabel} error:`, r.error);
				}
				console.groupCollapsed(`[Writer Room] Agent → ${agentLabel}`);
				if (typeof r.durationMs === "number") {
					console.log("Duration:", this.formatDuration(r.durationMs));
				}
				if (r.error) {
					console.log("Error:", r.error);
				}
				if (!r.comments.length) {
					console.log("No comments returned.");
				} else {
					for (const c of r.comments) {
						console.log(`[LINE:${c.line}]`, c.text);
					}
				}
				console.groupEnd();
			}

			const cm: any = (view as any)?.editor?.cm;
			if (cm) {
				applyComments(cm, allComments);
			}
			const totalDuration = Date.now() - runStart;
			if (agentSummaries.length) {
				console.table(agentSummaries);
			}
			console.log(`Total comments: ${totalComments}`);
			console.log(`Run duration: ${this.formatDuration(totalDuration)}`);
			new Notice(`Writer Room: Done. Parsed ${totalComments} comment(s).`);
			(this as any)._lastResults = results;
		} catch (e: any) {
			console.error(`${groupLabel} error`, e);
			new Notice("Writer Room: Error running agents (see console).");
		} finally {
			status.remove();
			console.groupEnd();
		}
	}

	private formatDuration(durationMs?: number): string {
		if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
			return "n/a";
		}
		if (durationMs < 1000) {
			return `${Math.max(0, Math.round(durationMs))}ms`;
		}
		return `${(durationMs / 1000).toFixed(2)}s`;
	}

	private async exportFeedback() {
		const results = (this as any)._lastResults as
			{ agent: { name: string }; comments: WriterComment[]; error?: string }[] | undefined;
		if (!results || !results.length) {
			new Notice("Writer Room: No feedback to export. Run first.");
			return;
		}
		const file = this.app.workspace.getActiveFile();
		const base = file ? file.basename : "Untitled";
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const name = `Writer Room Feedback - ${base} - ${ts}.md`;
		const dir = file?.parent ?? this.app.vault.getRoot();
		const path = dir.path === "/" ? name : `${dir.path}/${name}`;

		let md = `# Writer Room Feedback\n\nSource: ${file ? file.path : "(unsaved)"}\nDate: ${new Date().toLocaleString()}\n\n`;
		for (const r of results) {
			md += `## ${r.agent.name}\n\n`;
			if (r.error) {
				md += `- Error: ${r.error}\n\n`;
			}
			for (const c of r.comments) {
				md += `- [LINE:${c.line}] ${c.text}\n`;
			}
			md += `\n`;
		}

		try {
			const created = await this.app.vault.create(path, md);
			new Notice(`Writer Room: Exported feedback → ${created.path}`);
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(created as TFile);
		} catch (e: any) {
			console.error("Writer Room → export error", e);
			new Notice("Writer Room: Failed to export feedback.");
		}
	}
}

class AgentSelectionModal extends Modal {
	private agents: WriterAgent[];
	private selected: Set<string>;
	private resolve: (value: string[] | null) => void;
	private didSubmit = false;
	private runButton: HTMLButtonElement | null = null;

	constructor(app: App, agents: WriterAgent[], initialSelected: Set<string>, resolve: (value: string[] | null) => void) {
		super(app);
		this.agents = agents;
		this.selected = new Set(initialSelected);
		this.resolve = resolve;
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Select agents to run" });
		contentEl.createEl("p", {
			text: "Pick the writer room agents you want to include in this run.",
			cls: "wr-modal-desc",
		});

		const list = contentEl.createDiv({ cls: "wr-agent-picker" });
		for (const agent of this.agents) {
			const row = list.createEl("label", { cls: "wr-agent-picker__item" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selected.has(agent.id);
			checkbox.onchange = () => this.toggle(agent.id, checkbox.checked);

			const color = row.createSpan({ cls: "wr-agent-picker__color" });
			color.style.backgroundColor = agent.color;
			row.createSpan({ text: agent.name, cls: "wr-agent-picker__name" });
		}

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		this.runButton = buttons.createEl("button", { text: "Run", cls: "mod-cta" });
		this.runButton.onclick = () => this.submit();
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => this.close();

		this.updateRunButtonState();
	}

	override onClose(): void {
		super.onClose();
		this.contentEl.empty();
		if (!this.didSubmit) {
			this.resolve(null);
		}
	}

	private toggle(id: string, checked: boolean) {
		if (checked) {
			this.selected.add(id);
		} else {
			this.selected.delete(id);
		}
		this.updateRunButtonState();
	}

	private submit() {
		if (!this.selected.size) {
			return;
		}
		this.didSubmit = true;
		this.close();
		this.resolve(Array.from(this.selected));
	}

	private updateRunButtonState() {
		if (this.runButton) {
			this.runButton.disabled = this.selected.size === 0;
		}
	}
}

class PromptModal extends Modal {
	private titleText: string;
	private placeholder: string;
	private initialValue: string;
	private didSubmit = false;
	private currentValue: string;

	constructor(app: App, titleText: string, placeholder: string, initialValue = "") {
		super(app);
		this.titleText = titleText;
		this.placeholder = placeholder;
		this.initialValue = initialValue;
		this.currentValue = initialValue;
	}

	protected onSubmit(_value: string): void {}
	protected onCancel(): void {}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });

		new Setting(contentEl)
			.setName("Agent name")
			.setDesc("Pick something descriptive, e.g. Structure Specialist or Tone Coach.")
			.addText((text) => {
				text.setPlaceholder(this.placeholder)
					.setValue(this.initialValue)
					.onChange((value) => {
						this.currentValue = value;
					});
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => text.inputEl.focus(), 50);
			});

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const createBtn = buttons.createEl("button", { text: "Create", cls: "mod-cta" });
		createBtn.onclick = () => this.submit();
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.onclick = () => {
			this.close();
		};
	}

	override onClose(): void {
		super.onClose();
		this.contentEl.empty();
		if (!this.didSubmit) {
			this.onCancel();
		}
	}

	private submit() {
		const trimmed = this.currentValue.trim();
		if (!trimmed) {
			new Notice("Please enter a name for the agent.");
			return;
		}
		this.didSubmit = true;
		this.close();
		this.onSubmit(trimmed);
	}
}
