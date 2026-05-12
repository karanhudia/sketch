import { describe, expect, it } from "vitest";
import type { ProgressDisplaySettings } from "../progress-settings";
import type { ProgressEvent } from "./runner";
import { createProgressRenderer, getProgressTransportStrategy } from "./tool-progress";

function renderEvents(settings: ProgressDisplaySettings, events: ProgressEvent[]) {
  const renderer = createProgressRenderer(settings);
  for (const event of events) {
    renderer.renderEvent(event);
  }
  return { lines: renderer.getLines() };
}

describe("createProgressRenderer", () => {
  it("renders technical mode with clipped primary args", () => {
    const longPath = `src/${"very-long-folder-name/".repeat(5)}index.ts`;
    const { lines } = renderEvents({ toolProgress: "technical", reasoningText: false }, [
      { kind: "tool_use", toolName: "Read", input: { file_path: longPath } },
    ]);

    expect(lines).toEqual([`📖 Read: "${longPath.slice(0, 80)}..."`]);
  });

  it("suppresses intermediate text when reasoning text is off", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "intermediate_text", text: "Thinking..." },
    ]);
    expect(lines).toEqual([]);
  });

  it("renders reasoning-only updates when tool progress is off", () => {
    const { lines } = renderEvents({ toolProgress: "off", reasoningText: true }, [
      { kind: "intermediate_text", text: "Checking config" },
    ]);
    expect(lines).toEqual(["💬 Checking config"]);
  });

  it("renders nothing when both tool progress and reasoning text are off", () => {
    const { lines } = renderEvents({ toolProgress: "off", reasoningText: false }, [
      { kind: "intermediate_text", text: "Checking config" },
      { kind: "tool_use", toolName: "Read", input: { file_path: "a.ts" } },
    ]);
    expect(lines).toEqual([]);
  });

  it("renders friendly file operations with targets", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "tool_use", toolName: "Read", input: { file_path: "src/index.ts" } },
      { kind: "tool_use", toolName: "Write", input: { file_path: "notes.md" } },
      { kind: "tool_use", toolName: "Edit", input: { file_path: "src/index.ts" } },
    ]);

    expect(lines).toEqual(['📖 Reading "src/index.ts"', '✍️ Creating "notes.md"', '🔧 Editing "src/index.ts"']);
  });

  it("renders friendly search and shell operations with targets", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "tool_use", toolName: "Glob", input: { pattern: "**/*.ts" } },
      { kind: "tool_use", toolName: "Grep", input: { pattern: "TOOL_PROGRESS_OPTIONS" } },
      { kind: "tool_use", toolName: "Bash", input: { command: "pnpm test" } },
    ]);

    expect(lines).toEqual([
      '📂 Finding files matching "**/*.ts"',
      '🔎 Searching for "TOOL_PROGRESS_OPTIONS"',
      '💻 Running "pnpm test"',
    ]);
  });

  it("collapses repeated identical friendly operations", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "tool_use", toolName: "Edit", input: { file_path: "a.ts" } },
      { kind: "tool_use", toolName: "Edit", input: { file_path: "a.ts" } },
      { kind: "tool_use", toolName: "Edit", input: { file_path: "a.ts" } },
    ]);

    expect(lines).toEqual(['🔧 Editing "a.ts" (x3)']);
  });

  it("renders Canvas CLI Bash calls as Canvas actions in friendly mode", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      {
        kind: "tool_use",
        toolName: "Bash",
        input: {
          command:
            '$CANVAS_CLI direct-execute-action --component-key slack-send-message --configured-props \'{"text":"hi"}\' --output json',
        },
      },
    ]);

    expect(lines).toEqual(['🧩 Canvas action: "slack-send-message"']);
  });

  it("renders quoted Canvas CLI Bash calls as Canvas actions in technical mode", () => {
    const { lines } = renderEvents({ toolProgress: "technical", reasoningText: false }, [
      {
        kind: "tool_use",
        toolName: "Bash",
        input: {
          command:
            "sh -c '\"$CANVAS_CLI\" direct-execute-action --component-key slack-send-message --output json' | jq .",
        },
      },
    ]);

    expect(lines).toEqual(['🧩 Canvas: "direct-execute-action slack-send-message"']);
  });

  it("renders Canvas web commands with the operation target", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      {
        kind: "tool_use",
        toolName: "Bash",
        input: {
          command: '$CANVAS_CLI direct-execute-web-search --query "TypeScript best practices" --limit 5 --output json',
        },
      },
    ]);

    expect(lines).toEqual(['🧩 Canvas web search: "TypeScript best practices"']);
  });

  it("renders a clear fallback for unknown tools with safe available input", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "tool_use", toolName: "mcp__google_drive__list_files", input: { folder: "root" } },
    ]);
    expect(lines).toEqual(['⚙️ Using list_files: "root"']);
  });

  it("does not include unsafe fallback input fields", () => {
    const { lines } = renderEvents({ toolProgress: "friendly", reasoningText: false }, [
      { kind: "tool_use", toolName: "UnknownTool", input: { apiKey: "secret", message: "hello" } },
    ]);
    expect(lines).toEqual(["⚙️ Using UnknownTool"]);
  });

  it("strips the mcp__<server>__ prefix when picking the friendly pool", () => {
    const { lines } = renderEvents(
      { toolProgress: "friendly", reasoningText: false },
      [{ kind: "tool_use", toolName: "mcp__sketch__SendFileToChat", input: { file_path: "a.ts" } }],
      () => 0,
    );
    expect(lines).toEqual(["📦 Wrapping up a file for you"]);
  });

  it("strips the mcp__<server>__ prefix in technical mode and renders the bare name with primary arg", () => {
    const { lines } = renderEvents({ toolProgress: "technical", reasoningText: false }, [
      { kind: "tool_use", toolName: "mcp__sketch__SendFileToChat", input: { file_path: "a.ts" } },
    ]);
    expect(lines).toEqual(['📎 SendFileToChat: "a.ts"']);
  });

  it("strips the mcp__<server>__ prefix in verbose mode and renders the bare name with full input", () => {
    const { lines } = renderEvents({ toolProgress: "verbose", reasoningText: false }, [
      { kind: "tool_use", toolName: "mcp__sketch__SendFileToChat", input: { file_path: "a.ts" } },
    ]);
    expect(lines).toEqual(['📎 SendFileToChat: {"file_path":"a.ts"}']);
  });

  it("strips the mcp__<server>__ prefix when the server segment contains underscores", () => {
    const { lines } = renderEvents({ toolProgress: "technical", reasoningText: false }, [
      { kind: "tool_use", toolName: "mcp__plugin_pipedream__SendFileToChat", input: { file_path: "a.ts" } },
    ]);
    expect(lines).toEqual(['📎 SendFileToChat: "a.ts"']);
  });

  it("strips the mcp__<server>__ prefix only up to the first __ so underscores in the tool name survive", () => {
    const { lines } = renderEvents({ toolProgress: "verbose", reasoningText: false }, [
      { kind: "tool_use", toolName: "mcp__google_drive__list_files", input: { folder: "root" } },
    ]);
    expect(lines).toEqual(['⚙️ list_files: {"folder":"root"}']);
  });

  it("strips the mcp__<server>__ prefix in friendly mode for an underscored server", () => {
    const { lines } = renderEvents(
      { toolProgress: "friendly", reasoningText: false },
      [{ kind: "tool_use", toolName: "mcp__plugin_pipedream__SendFileToChat", input: {} }],
      () => 0,
    );
    expect(lines).toEqual(["📦 Wrapping up a file for you"]);
  });
});

describe("getProgressTransportStrategy", () => {
  it("returns none when both settings disable live progress", () => {
    expect(getProgressTransportStrategy({ toolProgress: "off", reasoningText: false })).toBe("none");
  });

  it("returns accumulate for reasoning-only and enabled tool-progress modes", () => {
    expect(getProgressTransportStrategy({ toolProgress: "off", reasoningText: true })).toBe("accumulate");
    expect(getProgressTransportStrategy({ toolProgress: "friendly", reasoningText: false })).toBe("accumulate");
    expect(getProgressTransportStrategy({ toolProgress: "technical", reasoningText: true })).toBe("accumulate");
  });
});
