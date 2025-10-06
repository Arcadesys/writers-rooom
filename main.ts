import { Editor, Notice, Plugin, MarkdownView, TFile, WorkspaceLeaf, TAbstractFile } from "obsidian";
import { DEFAULT_SETTINGS, type WriterAgent, type WriterRoomSettings, runAgentsSequential, type WriterComment } from "./agent";
import { applyComments, clearComments } from "./comment-renderer";
import { WriterRoomSettingTab } from "./settings";
import { ensureAgentsFolder, loadAgentsFromFolder, AGENTS_FOLDER } from "./agent-store";
import { WriterRoomSidebarView, VIEW_TYPE_WRITER_ROOM } from "./sidebar-view";

export default class WriterRoomPlugin extends Plugin {
	settings: WriterRoomSettings;
	agents: WriterAgent[] = [];
	selectedAgentIds: Set<string> = new Set();
	sidebarView: WriterRoomSidebarView | null = null;
	private agentRefreshTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		await ensureAgentsFolder(this.app);
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
			await this.runWriterRoom(editor, view);
		});

		// command palette shortcut
		this.addCommand({
			id: "writer-room-run",
			name: "Run Writer Room",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "R" }],
			editorCallback: async (editor, view) => {
				await this.runWriterRoom(editor, view as MarkdownView);
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
							await this.runWriterRoom(editor, view as MarkdownView);
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

	async openAgentsFolder() {
		await ensureAgentsFolder(this.app);
		this.app.workspace.openLinkText(`${AGENTS_FOLDER}/`, "", false);
	}

	async createExampleAgent() {
		await ensureAgentsFolder(this.app);
		const path = `${AGENTS_FOLDER}/example-agent.md`;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing) {
			new Notice("Example agent already exists.");
			return;
		}
		const content = `---\nname: Punch-Up Specialist\ncolor: hsl(12 80% 60%)\n---\nYou are the punch-up specialist in a TV writer's room.\n\nFocus on infusing dialogue with wit and tightening scenes.\nRespond with inline feedback using the format: [LINE:12] Note.`;
		await this.app.vault.create(path, content);
		new Notice("Created example agent in writers-room-agents.");
		await this.refreshAgents();
	}

	// orchestrates agent execution and inline feedback application
	async runWriterRoom(editor: Editor, view?: MarkdownView, agentsOverride?: WriterAgent[]) {
		const doc = editor.getValue();
		let agentsToRun = agentsOverride && agentsOverride.length ? agentsOverride : this.getSelectedAgents();
		if (!agentsToRun.length) {
			agentsToRun = this.agents;
		}

		if (!agentsToRun.length) {
			new Notice("Writer Room: No agents available. Add markdown agents to the writers-room-agents folder.");
			return;
		}

		if (!this.settings.apiKey) {
			new Notice("Writer Room: Missing API key in settings.");
			return;
		}

		const status = this.addStatusBarItem();
		status.setText(`Writer Room: Running ${agentsToRun.length} agent(s)...`);
		new Notice(`Writer Room: Running ${agentsToRun.length} agent(s)...`);
		console.log("Writer Room → Document length:", doc.length);

		try {
			const results = await runAgentsSequential(this.settings, agentsToRun, doc);
			let totalComments = 0;
			const allComments: WriterComment[] = [];
			for (const r of results) {
				if (r.error) {
					console.warn(`Agent ${r.agent.name} error:`, r.error);
				}
				console.group(`Writer Room → ${r.agent.name}`);
				for (const c of r.comments) {
					console.log(`[LINE:${c.line}]`, c.text);
				}
				console.groupEnd();
				totalComments += r.comments.length;
				allComments.push(...r.comments);
			}
			const cm: any = (view as any)?.editor?.cm;
			if (cm) {
				applyComments(cm, allComments);
			}
			new Notice(`Writer Room: Done. Parsed ${totalComments} comment(s).`);
			(this as any)._lastResults = results;
		} catch (e: any) {
			console.error("Writer Room → run error", e);
			new Notice("Writer Room: Error running agents (see console).");
		}
		status.remove();
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
