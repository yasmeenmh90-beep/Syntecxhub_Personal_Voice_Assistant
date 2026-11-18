import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { defaults } from "./api";
import { capture } from "./audio";
vi.mock("./audio", () => ({ capture: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const button = (label: string) => {
  const element =
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    ) ??
    Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.includes(label),
    );
  if (!element) throw new Error("Missing button: " + label);
  return element;
};
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await tick();
  });
}
async function mount() {
  await act(async () => {
    root.render(<App />);
    await tick();
  });
}
async function send(text: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Command"]',
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  });
}
beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.mocked(capture).mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => ({
      ok: true,
      json: async () =>
        input.includes("settings")
          ? defaults
          : input.includes("health")
            ? { status: "ready" }
            : {
                status: "completed",
                message:
                  JSON.parse(options?.body as string).text === "help"
                    ? "Supported commands"
                    : "The time is 2:30 PM.",
                ended: false,
                action: null,
              },
    })),
  );
  vi.stubGlobal("speechSynthesis", undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
describe("dashboard", () => {
  it("connects and submits typed commands with conversation updates", async () => {
    await mount();
    expect(container.textContent).toContain("Backend connected");
    await send("what time is it");
    expect(container.textContent).toContain("The time is 2:30 PM.");
    expect(container.textContent).toContain("what time is it");
    expect(fetch).toHaveBeenCalledWith(
      "/api/command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "what time is it", confirmed: false }),
      }),
    );
  });
  it("opens the palette with Cmd K, filters commands, and executes with Enter", async () => {
    await mount();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search commands"]',
    )!;
    expect(document.activeElement).toBe(search);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "c l c");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector(".palette-results")?.textContent).toContain(
      "Open Calculator",
    );
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await tick();
    });
    expect(container.querySelector(".command-palette")).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/command",
      expect.objectContaining({
        body: JSON.stringify({ text: "Open Calculator", confirmed: false }),
      }),
    );
  });
  it("reports real request latency and leaves recognition skipped for typed input", async () => {
    await mount();
    expect(container.querySelector(".execution-panel")?.textContent).toContain(
      "AWAITING INPUT",
    );
    await send("hello");
    const trace = container.querySelector(".execution-panel")!;
    expect(trace.textContent).toContain("MS / ROUND TRIP");
    expect(trace.textContent).toContain("typed / skip");
    expect(container.querySelector(".activity-console")?.textContent).toContain(
      "Command submitted: hello",
    );
  });
  it("closes the palette with Escape and restores focus", async () => {
    await mount();
    button("Command palette").focus();
    await click("Command palette");
    await act(async () => {
      container
        .querySelector('input[aria-label="Search commands"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(container.querySelector(".command-palette")).toBeNull();
    expect(document.activeElement).toBe(button("Command palette"));
  });
  it("keeps onboarding optional and remembers a skipped introduction", async () => {
    await mount();
    expect(
      container.querySelector('[aria-label="Welcome to NOVA"]'),
    ).toBeNull();
    await click("Meet NOVA");
    expect(
      container.querySelector('[aria-label="Welcome to NOVA"]'),
    ).not.toBeNull();
    expect(fetch).not.toHaveBeenCalledWith("/api/command", expect.anything());
    await click("Skip introduction");
    expect(window.localStorage.getItem("nova.onboarding.v3")).toBe("done");
    expect(container.querySelector(".first-contact")).toBeNull();
  });
  it("shows actual capture samples and permission in Voice Studio and stops capture on cancel", async () => {
    await mount();
    const cancel = vi.fn(async () => {});
    vi.mocked(capture).mockImplementation(
      async (_device, onLevel, onSamples) => {
        onLevel(0.25);
        onSamples?.([0, 0.5, -0.5, 0]);
        return { cancel, finish: vi.fn() };
      },
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
    await click("Start listening");
    await click("Voice Studio");
    expect(container.querySelector("meter")?.value).toBe(0.25);
    expect(
      container.querySelector(".permission-status")?.textContent,
    ).toContain("Granted");
    expect(
      container
        .querySelector(".studio-signal polyline")
        ?.getAttribute("points"),
    ).toContain("160,26");
    await click("Cancel studio recording");
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      container
        .querySelector(".studio-signal polyline")
        ?.getAttribute("points"),
    ).not.toContain("160,26");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).includes("transcribe")),
    ).toBe(false);
  });
  it("clears only activity while preserving the conversation", async () => {
    await mount();
    await send("hello");
    await click("Clear activity");
    expect(container.querySelector(".activity-console")?.textContent).toContain(
      "0 EVENTS",
    );
    expect(container.querySelector(".messages")?.textContent).toContain(
      "The time is 2:30 PM.",
    );
  });
  it("shows command failures", async () => {
    await mount();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Connection lost"));
    await send("hello");
    expect(container.textContent).toContain("Connection lost");
    expect(container.querySelector(".state")?.textContent).toContain("Error");
  });
  it("clears history", async () => {
    await mount();
    await click("Say hello");
    expect(container.textContent).toContain("The time is 2:30 PM.");
    await click("Clear conversation");
    expect(container.textContent).toContain(
      "A clear channel. A new possibility.",
    );
    expect(container.querySelector(".messages")?.textContent).not.toContain(
      "The time is 2:30 PM.",
    );
  });
  it("requires confirmation before executing app actions", async () => {
    await mount();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "confirmation_required",
        message: "Confirm opening",
        ended: false,
        action: null,
      }),
    } as Response);
    await click("Open Calculator");
    expect(container.textContent).toContain("Confirm action");
    await click("Confirm action");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/command",
      expect.objectContaining({
        body: JSON.stringify({ text: "Open Calculator", confirmed: true }),
      }),
    );
  });
  it("saves preferences to backend", async () => {
    await mount();
    await click("Open settings");
    await click("Save preferences");
    expect(container.textContent).toContain("Settings saved locally.");
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });
  it("disables microphone when backend is offline", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    await mount();
    expect(container.textContent).toContain("Backend offline");
    expect(button("Start listening").disabled).toBe(true);
  });
  it("shows permission errors and permits retry", async () => {
    await mount();
    vi.mocked(capture).mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    await click("Start listening");
    expect(container.textContent).toContain("Microphone permission denied");
    expect(button("Start listening").disabled).toBe(false);
  });
  it("cancels capture and returns to Ready without transcription", async () => {
    await mount();
    const cancel = vi.fn(async () => {});
    vi.mocked(capture).mockResolvedValue({ cancel, finish: vi.fn() });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
    await click("Start listening");
    expect(container.querySelector(".state")?.textContent).toBe("Listening");
    await click("Cancel recording");
    expect(cancel).toHaveBeenCalledOnce();
    expect(container.querySelector(".state")?.textContent).toBe("Ready");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).includes("transcribe")),
    ).toBe(false);
  });
  it("transcribes a finished recording then routes recognized text", async () => {
    await mount();
    vi.mocked(capture).mockResolvedValue({
      cancel: vi.fn(),
      finish: vi.fn(async () => new Blob(["wav"])),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
    await click("Start listening");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: "what time is it" }),
    } as Response);
    await click("Finish recording");
    expect(container.textContent).toContain("what time is it");
    expect(container.textContent).toContain("The time is 2:30 PM.");
    expect(fetch).toHaveBeenCalledWith(
      "/api/transcribe",
      expect.objectContaining({ method: "POST", body: expect.any(Blob) }),
    );
  });
  it("handles recognition service failures without executing a command", async () => {
    await mount();
    vi.mocked(capture).mockResolvedValue({
      cancel: vi.fn(),
      finish: vi.fn(async () => new Blob(["wav"])),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
    await click("Start listening");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ detail: "Recognition service unavailable." }),
    } as Response);
    await click("Finish recording");
    expect(container.textContent).toContain("Recognition service unavailable.");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).endsWith("/command")),
    ).toBe(false);
  });
  it("updates Speaking state from playback events and stops playback", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      cancel,
      speak: (utterance: SpeechSynthesisUtterance) =>
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent),
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        rate = 1;
        voice = null;
        onstart: ((event: Event) => void) | null = null;
        onend = null;
        onerror = null;
        constructor(public text: string) {}
      },
    );
    await mount();
    await click("Say hello");
    expect(container.querySelector(".state")?.textContent).toBe("Speaking");
    await click("Stop speaking");
    expect(cancel).toHaveBeenCalled();
    expect(container.querySelector(".state")?.textContent).toBe("Ready");
  });
  it("does not release the microphone lock when voice is muted", async () => {
    await mount();
    const cancel = vi.fn(async () => {});
    vi.mocked(capture).mockResolvedValue({ cancel, finish: vi.fn() });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
    await click("Start listening");
    await click("Voice on");
    expect(container.querySelector(".state")?.textContent).toBe("Listening");
    expect(button("Open Calculator").disabled).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    await click("Cancel recording");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("uses current mute setting after an in-flight command completes", async () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      cancel: vi.fn(),
      speak,
    });
    await mount();
    let complete!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    await send("hello");
    await click("Voice on");
    expect(container.querySelector(".state")?.textContent).toBe("Processing");
    await act(async () => {
      complete({
        ok: true,
        json: async () => ({
          status: "completed",
          message: "Hello!",
          ended: false,
          action: null,
        }),
      } as Response);
      await tick();
    });
    expect(container.textContent).toContain("Hello!");
    expect(speak).not.toHaveBeenCalled();
    expect(container.querySelector(".state")?.textContent).toBe("Completed");
  });
  it("copies actual response text", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await mount();
    await send("hello");
    await click("Copy assistant message");
    expect(writeText).toHaveBeenCalledWith("The time is 2:30 PM.");
  });
  it("shows a useful error when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await mount();
    await send("hello");
    await click("Copy assistant message");
    expect(container.textContent).toContain(
      "Clipboard unavailable. Select the message text to copy it.",
    );
    await click("Dismiss notification");
    expect(container.textContent).not.toContain("Clipboard unavailable.");
  });
  it("switches theme and persists the preference", async () => {
    await mount();
    await click("Toggle theme");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ ...defaults, theme: "light" }),
      }),
    );
  });
  it.each([
    "Open Calculator",
    "Open Notes",
    "Open Safari",
    "Open YouTube",
    "Open GitHub",
    "Tell Current Time",
    "Tell Today's Date",
  ])("routes quick command %s", async (title) => {
    await mount();
    await click(title);
    expect(fetch).toHaveBeenCalledWith(
      "/api/command",
      expect.objectContaining({
        body: JSON.stringify({ text: title, confirmed: false }),
      }),
    );
  });
  it.each([
    ["Start 5-Minute Timer", "set a timer for 5 minutes"],
    ["Weather Today", "weather today"],
    ["Tell a Joke", "Tell a Joke"],
  ])("routes new quick command %s", async (title, text) => {
    await mount();
    await click(title);
    expect(fetch).toHaveBeenCalledWith(
      "/api/command",
      expect.objectContaining({
        body: JSON.stringify({ text, confirmed: false }),
      }),
    );
  });
  it("prefills Quick Maths instead of sending an empty calculation", async () => {
    await mount();
    await click("Quick Maths");
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Command"]')!
        .value,
    ).toBe("calculate ");
  });
  it("runs a countdown for timer actions, alerts, and can be cancelled", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        ({
          ok: true,
          json: async () =>
            String(input).includes("settings")
              ? defaults
              : String(input).includes("health")
                ? { status: "ready" }
                : {
                    status: "completed",
                    message: "Timer set for 1 second.",
                    ended: false,
                    action: { type: "timer", target: "1" },
                  },
        }) as Response,
    );
    await mount();
    await send("set a timer for 1 second");
    expect(container.textContent).toContain("1 second timer");
    expect(button("Cancel timer")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
    });
    expect(container.textContent).toContain("Time's up");
    expect(container.textContent).toContain("Your 1 second timer is done.");
    await click("Dismiss timer");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(container.textContent).not.toContain("Time's up");
  });
  it("fills and focuses Google search without launching a blank query", async () => {
    await mount();
    await click("Search Google");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Command"]',
    )!;
    expect(input.value).toBe("search for ");
    expect(document.activeElement).toBe(input);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).endsWith("/command")),
    ).toBe(false);
  });
  it("disables microphone and explains missing backend recognition", async () => {
    vi.mocked(fetch).mockImplementation(
      async (input) =>
        ({
          ok: true,
          json: async () =>
            String(input).includes("health")
              ? { status: "ready", capabilities: { transcription: false } }
              : defaults,
        }) as Response,
    );
    await mount();
    expect(button("Start listening").disabled).toBe(true);
    expect(container.textContent).toContain("Voice input unavailable");
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Command"]')
        ?.disabled,
    ).toBe(false);
  });
});
