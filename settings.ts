import { App, PluginSettingTab, Setting, TextComponent, TextAreaComponent, ButtonComponent, ToggleComponent, ColorComponent } from "obsidian";
import type WriterRoomPlugin from "./main";
import type { WriterAgent, WriterRoomSettings } from "./agent";
import { createAgent } from "./agent";

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
      .setDesc("Claude/OpenAI API key for agent calls.")
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
      .setName("Model Name")
      .setDesc("Model identifier (e.g., claude-3-5-sonnet or gpt-4o).")
      .addText((text: TextComponent) => {
        text
          .setPlaceholder("claude-3-5-sonnet")
          .setValue(this.plugin.settings.modelName || "")
          .onChange(async (value) => {
            this.plugin.settings.modelName = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }

  private renderAgentsSection(containerEl: HTMLElement) {
    const header = containerEl.createDiv({ cls: "wr-section-header" });
    header.createEl("h3", { text: "Agents" });
    const addButton = new ButtonComponent(header);
    addButton.setButtonText("New Agent").onClick(async () => {
      this.plugin.settings.agents.push(createAgent());
      await this.plugin.saveSettings();
      this.display();
    });

  this.plugin.settings.agents.forEach((agent: WriterAgent) => {
      this.renderAgentBlock(containerEl, agent);
    });
  }

  private renderAgentBlock(containerEl: HTMLElement, agent: WriterAgent) {
    const block = containerEl.createDiv({ cls: "wr-agent-block" });

    const header = new Setting(block)
      .setName(agent.name || "Agent")
      .setDesc("Configure name, enabled state, and color.");

    header.addText((text: TextComponent) => {
      text
        .setPlaceholder("Agent name")
        .setValue(agent.name)
        .onChange(async (value) => {
          agent.name = value;
          await this.plugin.saveSettings();
          header.setName(agent.name || "Agent");
        });
    });

    header.addToggle((toggle: ToggleComponent) => {
      toggle
        .setValue(agent.enabled)
        .onChange(async (value) => {
          agent.enabled = value;
          await this.plugin.saveSettings();
        });
    }).setDesc("Enabled");

    header.addColorPicker((picker: ColorComponent) => {
      try {
        (picker as any).setValue(agent.color);
      } catch {}
      picker.onChange(async (value) => {
        agent.color = value;
        await this.plugin.saveSettings();
      });
      (picker as any).inputEl.value = agent.color;
    });

    header.addExtraButton((btn) => {
      btn
        .setIcon("trash")
        .setTooltip("Delete agent")
        .onClick(async () => {
          const index = this.plugin.settings.agents.findIndex((item: WriterAgent) => item.id === agent.id);
          if (index >= 0) {
            this.plugin.settings.agents.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }
        });
    });

    const promptRow = new Setting(block)
      .setName("System Prompt")
      .setDesc("Define the agent's behavior.");

    promptRow.addTextArea((textarea: TextAreaComponent) => {
      textarea
        .setPlaceholder("You are [ROLE] in a writer's room...\nProvide feedback as inline comments in the format: [LINE:5] ...")
        .setValue(agent.systemPrompt)
        .onChange(async (value) => {
          agent.systemPrompt = value;
          await this.plugin.saveSettings();
        });
      textarea.inputEl.rows = 6;
      textarea.inputEl.cols = 50;
    });
  }
}
