import { Editor, Notice, Plugin, MarkdownView, TFile } from "obsidian";
import { DEFAULT_SETTINGS, type WriterAgent, type WriterRoomSettings, runAgentsSequential, type WriterComment } from "./agent";
import { applyComments, clearComments } from "./comment-renderer";
import { WriterRoomSettingTab } from "./settings";

export default class WriterRoomPlugin extends Plugin {
	settings: WriterRoomSettings;

	async onload() {
		await this.loadSettings();

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
		// placeholder for future cleanup hooks
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// orchestrates agent execution and inline feedback application
	async runWriterRoom(editor: Editor, view?: MarkdownView) {
		const doc = editor.getValue();
		const enabledAgents = (this.settings.agents || []).filter((a: WriterAgent) => a.enabled);

		if (!enabledAgents.length) {
			new Notice("Writer Room: No enabled agents. Add or enable in settings.");
			return;
		}

		if (!this.settings.apiKey) {
			new Notice("Writer Room: Missing API key in settings.");
			return;
		}

		const status = this.addStatusBarItem();
		status.setText(`Writer Room: Running ${enabledAgents.length} agent(s)...`);
		new Notice(`Writer Room: Running ${enabledAgents.length} agent(s)...`);
		console.log("Writer Room → Document length:", doc.length);

		try {
			const results = await runAgentsSequential(this.settings, enabledAgents, doc);
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
