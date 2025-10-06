import { App, PluginSettingTab, Setting, TextComponent, DropdownComponent } from "obsidian";
import type WriterRoomPlugin from "./main";
import { CLAUDE_MODELS } from "./agent";
import { AGENTS_FOLDER } from "./agent-store";

export class WriterRoomSettingTab extends PluginSettingTab {
  plugin: WriterRoomPlugin;

  constructor(app: App, plugin: WriterRoomPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Writer Room Settings" });

    this.renderApiSection(containerEl);
    this.renderModelSection(containerEl);
    this.renderAgentsSection(containerEl);
  }

  private renderApiSection(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Claude API key used with the Claude Agents SDK. Stored locally in this vault.")
      .addText((text: TextComponent) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey || "")
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }

  private renderModelSection(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Claude Model")
      .setDesc("Pick which Claude model the agents should call.")
      .addDropdown((dropdown: DropdownComponent) => {
        for (const option of CLAUDE_MODELS) {
          dropdown.addOption(option.id, option.label);
        }
        dropdown
          .setValue(this.plugin.settings.model || "latest")
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private renderAgentsSection(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Agent Library" });
    const desc = containerEl.createEl("p");
    desc.setText(
      `Agents live as markdown files inside the “${AGENTS_FOLDER}” folder. Each file’s contents become the agent prompt, and optional frontmatter can provide a name or color.`
    );

    new Setting(containerEl)
      .setName("Agents Folder")
      .setDesc(`Manage your agent markdown files in the vault folder: ${AGENTS_FOLDER}`)
      .addButton((button) =>
        button
          .setButtonText("Open Folder")
          .onClick(() => this.plugin.openAgentsFolder())
      )
      .addExtraButton((button) =>
        button
          .setIcon("document")
          .setTooltip("Create example agent")
          .onClick(async () => {
            await this.plugin.createExampleAgent();
          })
      );
  }
}
