import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityConsole,
  ExecutionPanel,
  type ActivityEvent,
} from "./Workspace";
import { Signal } from "./Signal";
import { VoiceStudio } from "./VoiceStudio";
import { defaults } from "./api";
let root: Root;
let container: HTMLDivElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
    await tick();
  });
}
async function click(selector: string) {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(selector)!.click();
    await tick();
  });
}
async function change(selector: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector,
    )!;
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await tick();
  });
}
const events: ActivityEvent[] = [
  {
    id: 1,
    time: "09:00:01",
    text: "Backend connected",
    category: "connection",
    severity: "success",
  },
  {
    id: 2,
    time: "09:00:02",
    text: "Command submitted: time",
    category: "command",
    severity: "info",
  },
  {
    id: 3,
    time: "09:00:03",
    text: "Microphone permission denied",
    category: "voice",
    severity: "error",
  },
];
describe("V3 developer tools", () => {
  it("filters and searches actual console events, then copies complete event text", async () => {
    const onClear = vi.fn(),
      onError = vi.fn(),
      writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await render(
      <ActivityConsole
        events={events}
        expanded
        onClear={onClear}
        onError={onError}
      />,
    );
    await change('[aria-label="Activity category"]', "voice");
    expect(container.querySelector(".console-lines")?.textContent).toContain(
      "Microphone permission denied",
    );
    expect(
      container.querySelector(".console-lines")?.textContent,
    ).not.toContain("Backend connected");
    await change('[aria-label="Search activity"]', "not present");
    expect(container.textContent).toContain("No events match your filters.");
    await change('[aria-label="Search activity"]', "permission");
    await act(async () => {
      container.querySelector("details")!.open = true;
    });
    await click('[aria-label="Copy event 3"]');
    expect(writeText).toHaveBeenCalledWith(
      "[09:00:03] [voice] Microphone permission denied",
    );
    await click('[aria-label="Clear activity"]');
    expect(onClear).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
  it("reports copy failure and keeps the full event available", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const error = vi.fn();
    await render(
      <ActivityConsole
        events={events}
        expanded
        onClear={() => {}}
        onError={error}
      />,
    );
    await act(async () => {
      container.querySelector("details")!.open = true;
    });
    await click('[aria-label="Copy event 3"]');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Clipboard unavailable"),
    );
    expect(container.textContent).toContain("Microphone permission denied");
  });
  it("does not mark intent, execution, or response successful for a failed request", async () => {
    await render(
      <ExecutionPanel
        execution={{
          text: "time",
          source: "text",
          status: "error",
          latency: null,
          action: null,
          error: "Connection lost",
        }}
        events={[]}
        expanded={false}
        onClear={() => {}}
        onError={() => {}}
      />,
    );
    const stages = container.querySelectorAll(".trace-stage");
    expect(stages[2].classList.contains("done")).toBe(false);
    expect(stages[3].classList.contains("error")).toBe(true);
    expect(stages[4].textContent).toContain("No response");
    await click(".trace-stage:nth-child(4)");
    expect(container.querySelector(".stage-detail")?.textContent).toContain(
      "Connection lost",
    );
  });
  it("shows the measured recognition time and the approval boundary", async () => {
    await render(
      <ExecutionPanel
        execution={{
          text: "open notes",
          source: "voice",
          status: "confirmation_required",
          latency: 125,
          recognitionMs: 430,
          action: null,
          response: "Confirm to launch",
        }}
        events={[]}
        expanded={false}
        onClear={() => {}}
        onError={() => {}}
      />,
    );
    expect(container.textContent).toContain("125 MS / ROUND TRIP");
    await click(".trace-stage:nth-child(2)");
    expect(container.querySelector(".stage-detail")?.textContent).toContain(
      "430 ms",
    );
    await click(".trace-stage:nth-child(4)");
    expect(container.querySelector(".stage-detail")?.textContent).toContain(
      "No application or page has been launched",
    );
  });
  it("renders supplied signed PCM samples and a flat line when inactive", async () => {
    await render(<Signal active samples={[0, 1, -1, 0]} />);
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe(
      "0,45 160,7 320,83 480,45",
    );
    await render(<Signal active={false} samples={[0, 1, -1, 0]} />);
    const points = container
      .querySelector("polyline")!
      .getAttribute("points")!
      .split(" ");
    expect(points.every((point) => point.endsWith(",45"))).toBe(true);
  });
  it("lists and selects only browser-provided voices and previews through its real callback", async () => {
    const onChange = vi.fn(),
      onPreview = vi.fn();
    const voices = [
      {
        voiceURI: "local-1",
        name: "Actual voice",
        lang: "en-GB",
        localService: true,
      },
    ] as SpeechSynthesisVoice[];
    await render(
      <VoiceStudio
        view="Voice Studio"
        settings={defaults}
        voices={voices}
        devices={[]}
        state="Ready"
        level={0}
        samples={[]}
        permission="prompt"
        locked={false}
        canRecord
        pending={false}
        onChange={onChange}
        onClose={() => {}}
        onSave={() => {}}
        onListen={() => {}}
        onFinish={() => {}}
        onCancel={() => {}}
        onDiscover={() => {}}
        onPreview={onPreview}
        onStop={() => {}}
      />,
    );
    expect(container.querySelectorAll(".voice-options button")).toHaveLength(2);
    await click(".voice-options button:nth-child(2)");
    expect(onChange).toHaveBeenCalledWith({ voice: "local-1" });
    await change('[aria-label="Search voices"]', "missing");
    expect(container.textContent).toContain("No voices match your search.");
    await click(".studio-preview button");
    expect(onPreview).toHaveBeenCalledOnce();
    expect(
      container.querySelector(".permission-status")?.textContent,
    ).toContain("Not requested");
  });
});
