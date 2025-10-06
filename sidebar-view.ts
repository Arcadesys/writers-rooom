import { ItemView, WorkspaceLeaf } from "obsidian";
import type WriterRoomPlugin from "./main";
import { AGENTS_FOLDER } from "./agent-store";

export const VIEW_TYPE_WRITER_ROOM = "writers-room-sidebar";

export class WriterRoomSidebarView extends ItemView {
	plugin: WriterRoomPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: WriterRoomPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_WRITER_ROOM;
	}

	getDisplayText(): string {
		return "Writer Room";
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.plugin.sidebarView === this) {
			this.plugin.sidebarView = null;
		}
	}

	render(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("wr-sidebar");

		const header = containerEl.createDiv({ cls: "wr-sidebar-header" });
		header.createEl("h2", { text: "Writer Room" });

		const activeFile = this.plugin.app.workspace.getActiveFile();
		const fileInfo = header.createEl("p", { cls: "wr-sidebar-active" });
		if (activeFile) {
			fileInfo.setText(`Active note: ${activeFile.basename}`);
		} else {
			fileInfo.setText("No active Markdown note");
		}

		const agents = this.plugin.getAgents();
		if (!agents.length) {
			const empty = containerEl.createDiv({ cls: "wr-sidebar-empty" });
			empty.setText(
				`No agents found yet. Add markdown files to the “${AGENTS_FOLDER}” folder to define your writer room.`
			);
			const openBtn = empty.createEl("button", { text: "Open Agents Folder" });
			openBtn.onclick = () => this.plugin.openAgentsFolder();
			return;
		}

		const list = containerEl.createDiv({ cls: "wr-sidebar-list" });
		for (const agent of agents) {
			const item = list.createDiv({ cls: "wr-sidebar-item" });
			const label = item.createEl("label", { cls: "wr-sidebar-label" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.plugin.isAgentSelected(agent.id);
			checkbox.onchange = () => {
				this.plugin.setAgentSelected(agent.id, checkbox.checked);
			};
			const color = label.createSpan({ cls: "wr-sidebar-color" });
			color.style.backgroundColor = agent.color;
			label.createSpan({ text: agent.name, cls: "wr-sidebar-name" });
		}

		const controls = containerEl.createDiv({ cls: "wr-sidebar-controls" });
		const runBtn = controls.createEl("button", { text: "Run Selected Agents" });
		runBtn.onclick = () => {
			void this.plugin.runSelectedAgentsFromSidebar();
		};
		runBtn.disabled = !this.plugin.canRunSelectedAgents();

		const manageLink = controls.createEl("button", { text: "Manage Agents" });
		manageLink.onclick = () => this.plugin.openAgentsFolder();
	}
}
