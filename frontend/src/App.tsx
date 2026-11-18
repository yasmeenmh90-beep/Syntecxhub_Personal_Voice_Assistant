import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  NeuralCore,
  CommandPalette,
  ExecutionPanel,
  type Execution,
  type ActivityEvent,
  type EventCategory,
} from "./Workspace";
import { VoiceStudio, useMicrophonePermission } from "./VoiceStudio";
import {
  Onboarding,
  hasCompletedOnboarding,
  rememberOnboarding,
} from "./Onboarding";
import { Signal } from "./Signal";
import { TimerDock, chime, describe, type Timer } from "./Timers";
import {
  Activity,
  ArrowUpRight,
  Calculator,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Github,
  Globe,
  HelpCircle,
  LayoutDashboard,
  Mic,
  Moon,
  NotebookPen,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Youtube,
  CalendarDays,
  Laugh,
  Timer as TimerIcon,
  Sigma,
  Coins,
  BookOpen,
  CloudSun,
  type LucideIcon,
} from "lucide-react";
import { api, defaults, type Settings, type Result } from "./api";
import { capture, type Capture } from "./audio";
type State =
  "Ready" | "Listening" | "Processing" | "Speaking" | "Completed" | "Error";
type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  error?: boolean;
};
type QuickCommand = {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Prefill the command field instead of running immediately. */
  fill?: string;
  /** Spoken phrase sent to the backend when it differs from the title. */
  run?: string;
  tone?: string;
};
const commands: QuickCommand[] = [
  { title: "Open Calculator", description: "A little help with the numbers", icon: Calculator },
  { title: "Open Notes", description: "Make room for a new idea", icon: NotebookPen },
  { title: "Open Safari", description: "Your window to the web", icon: Globe },
  { title: "Search Google", description: "Find something worth knowing", icon: Search, fill: "search for " },
  { title: "Open YouTube", description: "A world of inspiration", icon: Youtube, tone: "red" },
  { title: "Open GitHub", description: "Where your ideas take shape", icon: Github },
  { title: "Tell Current Time", description: "Stay in the moment", icon: Clock3 },
  { title: "Tell Today's Date", description: "Make today count", icon: CalendarDays },
  { title: "Quick Maths", description: "Say “calculate 12 times 8”", icon: Sigma, fill: "calculate ", tone: "cyan" },
  { title: "Start 5-Minute Timer", description: "A gentle chime when it ends", icon: TimerIcon, run: "set a timer for 5 minutes", tone: "cyan" },
  { title: "Search Wikipedia", description: "Go deeper on any topic", icon: BookOpen, fill: "search wikipedia for " },
  { title: "Weather Today", description: "Check the sky before you go", icon: CloudSun, run: "weather today" },
  { title: "Tell a Joke", description: "A small dose of delight", icon: Laugh, tone: "gold" },
  { title: "Flip a Coin", description: "Let chance decide", icon: Coins, tone: "gold" },
];
// Twelve dashboard cards keep the 4-column grid even; every command stays in the palette.
const gridCommands = commands.filter(
  (c) => !["Search Wikipedia", "Flip a Coin"].includes(c.title),
);
export default function App() {
  const [state, setState] = useState<State>("Ready"),
    [online, setOnline] = useState(false),
    [checked, setChecked] = useState(false),
    [voiceAvailable, setVoiceAvailable] = useState(true),
    [input, setInput] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [settings, setSettings] = useState<Settings>(defaults),
    [panel, setPanel] = useState(false),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<string | null>(null),
    [level, setLevel] = useState(0),
    [copied, setCopied] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [view, setView] = useState("Dashboard");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [samples, setSamples] = useState<number[]>([]);
  const [permission, setPermission] = useMicrophonePermission();
  const [onboardingDone, setOnboardingDone] = useState(hasCompletedOnboarding);
  const [tour, setTour] = useState(false);
  const [timers, setTimers] = useState<Timer[]>([]);
  const eventId = useRef(0);
  const recognitionTime = useRef<number | undefined>(undefined);
  const log = useCallback(
    (
      text: string,
      category: EventCategory = "system",
      severity: ActivityEvent["severity"] = "info",
    ) => {
      const event: ActivityEvent = {
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        text,
        category,
        severity,
      };
      setEvents((old) => [...old.slice(-99), event]);
    },
    [],
  );
  function finishOnboarding() {
    rememberOnboarding();
    setOnboardingDone(true);
    setTour(false);
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel(false);
        setTour(false);
        setPalette((value) => !value);
      }
    };
    const visibility = () => {
      document.documentElement.dataset.paused = String(document.hidden);
    };
    visibility();
    document.addEventListener("keydown", handler);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (checked)
      log(
        online ? "Backend connected" : "Backend disconnected",
        "connection",
        online ? "success" : "warning",
      );
  }, [online, checked, log]);
  const busy = useRef(false),
    recording = useRef<Capture | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    end = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    request = useRef<AbortController | null>(null),
    speakTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    activeSpeech = useRef<SpeechSynthesisUtterance | null>(null),
    liveSettings = useRef(settings);
  const add = (role: Message["role"], text: string, error = false) =>
    setMessages((old) => [
      ...old,
      {
        id: Date.now() + Math.random(),
        role,
        text,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        error,
      },
    ]);
  function fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setNotice(message);
    log(message, "system", "error");
    setState("Error");
    add("assistant", message, true);
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    const health = () =>
      api<{ capabilities?: { transcription: boolean } }>("health")
        .then((health) => {
          if (active) {
            setOnline(true);
            setVoiceAvailable(health.capabilities?.transcription !== false);
            setChecked(true);
          }
        })
        .catch(() => {
          if (active) {
            setOnline(false);
            setChecked(true);
          }
        });
    void health();
    const interval = setInterval(health, 10000);
    api<Settings>("settings")
      .then((s) => {
        if (active) setSettings(s);
      })
      .catch(() => {
        if (active)
          setNotice(
            "Settings could not be loaded. Start the backend and retry.",
          );
      });
    const update = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    update();
    window.speechSynthesis?.addEventListener("voiceschanged", update);
    return () => {
      active = false;
      alive.current = false;
      clearInterval(interval);
      clearTimeout(timer.current);
      clearTimeout(speakTimer.current);
      request.current?.abort();
      void recording.current?.cancel();
      activeSpeech.current = null;
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.removeEventListener("voiceschanged", update);
    };
  }, []);
  useEffect(() => {
    if (state !== "Completed") return;
    const timeout = setTimeout(() => setState("Ready"), 1500);
    return () => clearTimeout(timeout);
  }, [state]);
  useEffect(() => {
    liveSettings.current = settings;
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  useEffect(() => {
    const container = end.current?.parentElement;
    container?.scrollTo?.({
      top: container.scrollHeight,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [messages, pending]);
  function stopSpeaking() {
    const wasSpeaking = activeSpeech.current !== null;
    activeSpeech.current = null;
    clearTimeout(speakTimer.current);
    window.speechSynthesis?.cancel();
    // Muting a response must not release the capture/request lock.
    if (wasSpeaking) {
      log("Speech playback stopped", "voice");
      busy.current = false;
      setState("Ready");
    }
  }
  function speak(text: string) {
    const currentSettings = liveSettings.current;
    if (!currentSettings.voice_response) {
      setState("Completed");
      busy.current = false;
      return;
    }
    if (!window.speechSynthesis) {
      setNotice(
        "Speech playback is unavailable in this browser. Responses remain in the conversation.",
      );
      setState("Completed");
      busy.current = false;
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    activeSpeech.current = utterance;
    utterance.rate = currentSettings.rate;
    // Read the current browser list; voices may load while the request is in flight.
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.voiceURI === currentSettings.voice);
    if (voice) utterance.voice = voice;
    if (currentSettings.voice && !voice)
      setNotice(
        "Selected voice is unavailable; using the browser default voice.",
      );
    const isCurrent = () => alive.current && activeSpeech.current === utterance;
    utterance.onstart = () => {
      if (isCurrent()) {
        log("Speech playback started", "voice");
        setState("Speaking");
      }
    };
    utterance.onend = () => {
      if (!isCurrent()) return;
      activeSpeech.current = null;
      clearTimeout(speakTimer.current);
      log("Speech playback finished", "voice", "success");
      setState("Completed");
      busy.current = false;
    };
    utterance.onerror = (event) => {
      if (!isCurrent()) return;
      activeSpeech.current = null;
      clearTimeout(speakTimer.current);
      busy.current = false;
      if (event.error === "canceled" || event.error === "interrupted")
        setState("Ready");
      else {
        log("Voice playback failed: " + event.error, "voice", "error");
        setNotice("Voice playback failed: " + event.error);
        setState("Error");
      }
    };
    speakTimer.current = setTimeout(() => {
      if (!isCurrent()) return;
      activeSpeech.current = null;
      window.speechSynthesis.cancel();
      log("Speech playback timed out", "voice", "error");
      setNotice("Speech playback timed out. Check audio output.");
      setState("Error");
      busy.current = false;
    }, 60000);
    try {
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      activeSpeech.current = null;
      clearTimeout(speakTimer.current);
      busy.current = false;
      fail(error);
    }
  }
  async function submit(text: string, confirmed = false, alreadyBusy = false) {
    if (
      !text.trim() ||
      (!alreadyBusy && busy.current) ||
      (pending && !confirmed)
    )
      return;
    busy.current = true;
    const started = performance.now();
    const source = confirmed
      ? (execution?.source ?? "text")
      : alreadyBusy
        ? "voice"
        : "text";
    const recognitionMs =
      source === "voice" ? recognitionTime.current : undefined;
    setExecution({
      text,
      status: "request",
      latency: null,
      action: null,
      source,
      recognitionMs,
    });
    log(
      confirmed ? "Confirmed action submitted" : "Command submitted: " + text,
      "command",
    );
    setRecent((old) =>
      [text, ...old.filter((item) => item !== text)].slice(0, 6),
    );
    setNotice("");
    setState("Processing");
    setPending(null);
    if (!confirmed) add("user", text);
    try {
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      let result: Result;
      try {
        result = await api<Result>("command", {
          method: "POST",
          body: JSON.stringify({ text, confirmed }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!alive.current) return;
      setExecution({
        text,
        status: result.status,
        latency: Math.round(performance.now() - started),
        action: result.action,
        source,
        recognitionMs,
        response: result.message,
      });
      log(
        result.status === "confirmation_required"
          ? "Action awaiting approval"
          : "Command " + result.status + ": " + result.message,
        "command",
        result.status === "confirmation_required"
          ? "warning"
          : result.status === "error"
            ? "error"
            : "success",
      );
      add("assistant", result.message, result.status === "error");
      if (result.action?.type === "timer") {
        const total = Number(result.action.target);
        if (total > 0)
          setTimers((old) => [
            ...old,
            { id: Date.now() + Math.random(), total, endsAt: Date.now() + total * 1000 },
          ]);
        log("Timer started: " + describe(total), "command", "success");
      }
      if (result.status === "confirmation_required") {
        setPending(text);
        setState("Ready");
        busy.current = false;
      } else if (result.status === "error") {
        setState("Error");
        busy.current = false;
      } else if (result.ended) {
        window.speechSynthesis?.cancel();
        setState("Completed");
        busy.current = false;
        setNotice(
          "Interaction ended. Start a new command whenever you are ready.",
        );
      } else speak(result.message);
    } catch (error) {
      if (alive.current) {
        setExecution((old) =>
          old
            ? {
                ...old,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              }
            : old,
        );
        fail(error);
        busy.current = false;
      }
    }
  }
  async function listDevices() {
    const list = await navigator.mediaDevices.enumerateDevices();
    if (alive.current) setDevices(list.filter((d) => d.kind === "audioinput"));
  }
  async function finishListening(cancel = false) {
    clearTimeout(timer.current);
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    setLevel(0);
    setSamples([]);
    if (cancel) {
      try {
        await current.cancel();
        log("Audio capture canceled", "voice");
        setExecution((old) => (old ? { ...old, status: "canceled" } : old));
        setState("Ready");
      } catch (error) {
        fail(error);
      } finally {
        busy.current = false;
      }
      return;
    }
    setState("Processing");
    log("Audio capture finished · recognition requested", "voice");
    setExecution((old) => (old ? { ...old, status: "recognizing" } : old));
    try {
      const wav = await current.finish();
      const recognitionStarted = performance.now();
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      let data: { text: string };
      try {
        data = await api<{ text: string }>("transcribe", {
          method: "POST",
          body: wav,
          headers: { "Content-Type": "audio/wav" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (alive.current) {
        recognitionTime.current = Math.round(
          performance.now() - recognitionStarted,
        );
        log("Speech recognized: " + data.text, "voice", "success");
        await submit(data.text, false, true);
      }
    } catch (error) {
      if (alive.current) {
        setExecution((old) =>
          old
            ? {
                ...old,
                status: "error",
                recognitionError:
                  error instanceof Error ? error.message : String(error),
              }
            : old,
        );
        fail(error);
        busy.current = false;
      }
    }
  }
  async function listen() {
    if (busy.current || !online || !voiceAvailable) return;
    busy.current = true;
    setNotice("");
    window.speechSynthesis?.cancel();
    try {
      setState("Processing");
      recording.current = await capture(
        settings.microphone,
        value => { if (alive.current) setLevel(value); },
        value => { if (alive.current) setSamples(value); },
      );
      if (!alive.current) {
        await recording.current.cancel();
        recording.current = null;
        return;
      }
      setPermission("granted");
      recognitionTime.current = undefined;
      setExecution({
        text: "",
        source: "voice",
        status: "capture",
        latency: null,
        action: null,
      });
      log(
        "Microphone permission granted · audio capture started",
        "voice",
        "success",
      );
      setState("Listening");
      timer.current = setTimeout(() => void finishListening(), 15000);
      await listDevices().catch(() =>
        setNotice(
          "Microphone names could not be refreshed. Recording is still active.",
        ),
      );
    } catch (error) {
      busy.current = false;
      if (!alive.current) return;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError") setPermission("denied");
      fail(
        name === "NotAllowedError"
          ? new Error(
              "Microphone permission denied. Allow microphone access in your browser and macOS Privacy & Security.",
            )
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? new Error(
                "Selected microphone is unavailable. Choose Default or connect a microphone.",
              )
            : error,
      );
    }
  }
  async function copyMessage(message: Message) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(message.text);
      setCopied(message.id);
    } catch {
      setNotice("Clipboard unavailable. Select the message text to copy it.");
    }
  }
  async function discoverMicrophones() {
    if (busy.current) return;
    busy.current = true;
    setState("Processing");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone capture requires localhost and a supported browser.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (alive.current) {
        setPermission("granted");
        log(
          "Microphone permission granted · devices refreshed",
          "voice",
          "success",
        );
      }
      stream.getTracks().forEach((track) => track.stop());
      if (!alive.current) return;
      await listDevices();
      if (alive.current) setState("Ready");
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof DOMException && error.name === "NotAllowedError")
        setPermission("denied");
      fail(error);
    } finally {
      busy.current = false;
    }
  }
  function preference(patch: Partial<Settings>) {
    const updated = { ...settings, ...patch };
    liveSettings.current = updated;
    setSettings(updated);
    void api<Settings>("settings", {
      method: "PUT",
      body: JSON.stringify(updated),
    }).catch(() =>
      setNotice(
        "Preference could not be saved. Check the backend and use Save preferences to retry.",
      ),
    );
  }
  async function save() {
    try {
      const saved = await api<Settings>("settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(saved);
      setNotice("Settings saved locally.");
      setPanel(false);
    } catch (error) {
      // A preferences error must not hide an active microphone's stop controls.
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }
  const locked =
    state === "Listening" || state === "Processing" || state === "Speaking";
  function runQuick(text: string) {
    const quick = commands.find((c) => c.title === text);
    if (quick?.fill) {
      setInput(quick.fill);
      document
        .querySelector<HTMLInputElement>('input[aria-label="Command"]')
        ?.focus();
    } else void submit(quick?.run ?? text);
  }
  function timerDone(timer: Timer) {
    const label = describe(timer.total) + " timer";
    chime();
    log("Timer finished: " + label, "command", "success");
    add("assistant", `Your ${label} is done.`);
    setNotice(`⏰ Your ${label} is done.`);
    if (liveSettings.current.voice_response && window.speechSynthesis && !busy.current) {
      const utterance = new SpeechSynthesisUtterance(`Your ${label} is done.`);
      utterance.rate = liveSettings.current.rate;
      window.speechSynthesis.speak(utterance);
    }
    // Leave the "time's up" chip visible briefly, then clear it.
    setTimeout(() => setTimers((old) => old.filter((t) => t.id !== timer.id)), 8000);
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="aurora" aria-hidden data-state={state.toLowerCase()}>
        <i />
        <i />
        <i />
      </div>
      <TimerDock
        timers={timers}
        onCancel={(id) => setTimers((old) => old.filter((t) => t.id !== id))}
        onFinish={timerDone}
      />
      <div
        className={"app-shell view-" + view.toLowerCase().replaceAll(" ", "-")}
      >
        <aside className="sidebar" inert={panel || palette || tour}>
          <a className="brand" href="#">
            <div className="brand-icon">
              <span className="nova-mark">
                N<span>•</span>
              </span>
            </div>
            <span>
              NOVA<small>NEURAL OPERATIONS</small>
            </span>
          </a>
          <div className="nav-caption">WORKSPACE / V3</div>
          {[
            ["Dashboard", LayoutDashboard],
            ["Voice Studio", Mic],
            ["Command Center", Search],
            ["Activity Timeline", Activity],
            ["Settings", Settings2],
          ].map(([label, Icon]) => {
            const name = label as string;
            const NavIcon = Icon as typeof Mic;
            return (
              <button
                key={name}
                aria-label={name}
                aria-current={view === name ? "page" : undefined}
                className={"nav-item " + (view === name ? "active" : "")}
                onClick={() => {
                  setView(name);
                  if (name === "Settings" || name === "Voice Studio")
                    setPanel(true);
                  else {
                    setPanel(false);
                    if (name === "Command Center") setPalette(true);
                    if (name === "Activity Timeline")
                      document
                        .querySelector(".telemetry-grid")
                        ?.scrollIntoView({
                          behavior: window.matchMedia?.(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "instant"
                            : "smooth",
                          block: "start",
                        });
                  }
                }}
              >
                <NavIcon size={18} />
                {name}
                {view === name && (
                  <motion.span
                    layoutId="nav-indicator"
                    className="nav-dot"
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
          <div className="sidebar-bottom">
            <div className="private-card">
              <div>
                <Activity size={17} />
                <span>LOCAL EXECUTION</span>
              </div>
              <p>
                Your commands. Your computer.
                <br />
                No LLM account required.
              </p>
              <span className="version">NOVA / V3</span>
            </div>
            <button
              className="nav-item"
              disabled={!online || locked}
              onClick={() => void submit("help")}
            >
              <HelpCircle size={18} />
              Command guide
              <ArrowUpRight size={14} />
            </button>
            <div className="profile">
              <div className="avatar">Y</div>
              <div>
                Your workspace<small>Neural operations interface</small>
              </div>
            </div>
          </div>
        </aside>
        <main inert={panel || palette || tour}>
          <header>
            <div className="breadcrumb">
              Workspace
              <ChevronRight size={13} />
              <span>{view}</span>
            </div>
            <div className="header-actions">
              <button
                className="palette-trigger"
                onClick={() => setPalette(true)}
              >
                <Search size={14} /> Command palette <kbd>⌘ K</kbd>
              </button>
              <span
                className={
                  "connection " +
                  (online ? "connected" : !checked ? "connecting" : "")
                }
              >
                <i />
                {online
                  ? "Backend connected"
                  : checked
                    ? "Backend offline"
                    : "Connecting…"}
              </span>
              <button
                className="icon-button"
                aria-label="Toggle theme"
                onClick={() =>
                  preference({
                    theme: settings.theme === "dark" ? "light" : "dark",
                  })
                }
              >
                {settings.theme === "dark" ? (
                  <Sun size={18} />
                ) : (
                  <Moon size={18} />
                )}
              </button>
              <button
                className="icon-button"
                aria-label="Open settings"
                onClick={() => setPanel(true)}
              >
                <Settings2 size={18} />
              </button>
            </div>
          </header>
          <div className="page-content" data-view={view}>
            <motion.div
              key={view}
              className="page-heading"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div>
                <div className="eyebrow">
                  NOVA / NEURAL OPERATIONS INTERFACE
                </div>
                <h1>
                  A thought away.
                  <br />
                  <span>A world in motion.</span>
                </h1>
                <p>
                  Your voice becomes action. An interface between thought and
                  execution.
                </p>
              </div>
              <div className="date-chip">
                <CalendarDays size={16} />
                {new Date().toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </motion.div>
            {!onboardingDone && (
              <div className="first-contact">
                <span>
                  <Sparkles size={15} /> New here? Make your first connection.
                </span>
                <div>
                  <button
                    onClick={() => {
                      setPanel(false);
                      setPalette(false);
                      setTour(true);
                    }}
                  >
                    Meet NOVA <ArrowUpRight size={13} />
                  </button>
                  <button
                    aria-label="Dismiss introduction"
                    onClick={finishOnboarding}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
            {!online && checked && (
              <div role="alert" className="notice">
                Backend unavailable. Start Python on 127.0.0.1:8000.
                Reconnecting automatically.
              </div>
            )}
            {online && !voiceAvailable && (
              <div role="status" className="notice">
                Voice input unavailable: install the backend SpeechRecognition
                dependency and restart Python. Typed commands are available.
              </div>
            )}
            {notice && (
              <div role="status" className="notice">
                {notice}
                <button
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="dashboard-grid">
              <section className="panel assistant-panel">
                <div className="panel-heading">
                  <div>
                    <span className="mini-dot" />
                    NEURAL CORE / LIVE
                  </div>
                  <span className="tag">LOCAL AGENT</span>
                </div>
                <NeuralCore state={state} level={level} samples={samples} />
                <div className="assistant-copy">
                  <span className={"state state-" + state.toLowerCase()}>
                    <i />
                    {online ? state : "Offline"}
                  </span>
                  <h2>
                    {state === "Listening"
                      ? "I'm listening."
                      : state === "Processing"
                        ? "Processing your intent…"
                        : state === "Speaking"
                          ? "Response in transmission."
                          : "Ready for your signal."}
                  </h2>
                  <p>
                    {state === "Listening"
                      ? "Speak naturally. Finish when you’re done."
                      : "Ask a question, open an app, or find your next idea."}
                  </p>
                </div>
                <Signal
                  className="workspace-signal"
                  samples={samples}
                  active={state === "Listening"}
                />
                <div className="mic-controls">
                  {state === "Listening" ? (
                    <>
                      <button
                        className="mic-button"
                        aria-label="Finish recording"
                        onClick={() => void finishListening()}
                      >
                        <Square fill="currentColor" size={23} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() => void finishListening(true)}
                      >
                        Cancel recording
                      </button>
                    </>
                  ) : state === "Speaking" ? (
                    <button
                      className="mic-button"
                      aria-label="Stop speaking"
                      onClick={stopSpeaking}
                    >
                      <VolumeX size={26} />
                    </button>
                  ) : (
                    <button
                      className="mic-button"
                      aria-label="Start listening"
                      disabled={
                        !online || !voiceAvailable || locked || !!pending
                      }
                      onClick={() => void listen()}
                    >
                      <Mic size={27} />
                    </button>
                  )}
                  <span>
                    {state === "Listening"
                      ? "Click to finish · 15 second limit"
                      : state === "Speaking"
                        ? "Click to stop speaking"
                        : "Click to speak with NOVA"}
                  </span>
                </div>
                <div className="assistant-footer">
                  <span>
                    <span className="tiny-dot" /> Rule-based intelligence
                  </span>
                  <button
                    onClick={() => {
                      const next = !settings.voice_response;
                      preference({ voice_response: next });
                      if (!next) stopSpeaking();
                    }}
                  >
                    {settings.voice_response ? (
                      <Volume2 size={14} />
                    ) : (
                      <VolumeX size={14} />
                    )}
                    Voice {settings.voice_response ? "on" : "off"}
                  </button>
                </div>
              </section>
              <section className="panel conversation">
                <div className="conversation-heading">
                  <div>
                    <h3>
                      Conversation{" "}
                      <span>{messages.length.toString().padStart(2, "0")}</span>
                    </h3>
                    <p>The dialogue between intent and action.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Clear conversation"
                    disabled={locked}
                    onClick={() => {
                      setMessages([]);
                      setPending(null);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="messages" role="log" aria-live="polite">
                  {messages.length === 0 ? (
                    <div className="empty-conversation">
                      <div className="empty-icon">
                        <Sparkles size={24} />
                      </div>
                      <h3>A clear channel. A new possibility.</h3>
                      <p>
                        Your conversation will appear here.
                        <br />
                        Try “Hello NOVA” to get acquainted.
                      </p>
                      <button
                        disabled={!online || locked}
                        onClick={() => void submit("Hello NOVA")}
                      >
                        Say hello
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={
                          "message " +
                          m.role +
                          (m.error ? " message-error" : "")
                        }
                      >
                        <div className="message-meta">
                          <span>{m.role === "user" ? "You" : "NOVA"}</span>
                          <time>{m.time}</time>
                          <button
                            aria-label={"Copy " + m.role + " message"}
                            onClick={() => void copyMessage(m)}
                          >
                            {copied === m.id ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        <p>{m.text}</p>
                      </div>
                    ))
                  )}
                  {pending && (
                    <div className="confirm-card">
                      <p>This action runs on this computer.</p>
                      <button onClick={() => void submit(pending, true)}>
                        Confirm action
                      </button>
                      <button
                        onClick={() => {
                          setPending(null);
                          log(
                            "Action canceled before execution",
                            "command",
                            "warning",
                          );
                          setExecution((old) =>
                            old ? { ...old, status: "canceled" } : old,
                          );
                          add("assistant", "Action canceled.");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {state === "Processing" && (
                    <div className="response-loading" role="status">
                      <span>Awaiting response</span>
                      <i />
                      <i />
                    </div>
                  )}
                  <div ref={end} />
                </div>
                <div className="compose-area">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = input;
                      setInput("");
                      void submit(text);
                    }}
                  >
                    <input
                      aria-label="Command"
                      placeholder="Type a command or ask NOVA…"
                      value={input}
                      disabled={!online || locked || !!pending}
                      onChange={(e) => setInput(e.target.value)}
                    />
                    <button
                      aria-label="Send command"
                      disabled={!online || locked || !input.trim() || !!pending}
                    >
                      <Send size={17} />
                    </button>
                  </form>
                  <div className="compose-hint">
                    <span>
                      <span className="key">↵</span> to send
                    </span>
                    <span>Simple commands. Real actions.</span>
                  </div>
                </div>
              </section>
            </div>
            <ExecutionPanel
              execution={execution}
              events={events}
              expanded={view === "Activity Timeline"}
              onClear={() => setEvents([])}
              onError={setNotice}
            />
            <section className="quick-section">
              <div className="section-heading">
                <div>
                  <h3>Intent. Action. Done.</h3>
                  <p>Twelve direct routes to your next move.</p>
                </div>
                <span>
                  QUICK COMMANDS
                  <ArrowUpRight size={14} />
                </span>
              </div>
              <div className="quick-grid">
                {gridCommands.map(
                  ({ title, description, icon: Icon, tone }, index) => (
                    <motion.button
                      key={title}
                      className="quick-card"
                      disabled={!online || locked || !!pending}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.15 + index * 0.04,
                        duration: 0.45,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onPointerMove={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
                        event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
                      }}
                      onClick={() => runQuick(title)}
                    >
                      <span className={"quick-icon " + (tone ?? "")}>
                        <Icon size={20} />
                      </span>
                      <ArrowUpRight className="quick-arrow" size={15} />
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </motion.button>
                  ),
                )}
              </div>
            </section>
            <footer>
              <span>
                <Sparkles size={13} /> LOCAL FIRST / HUMAN IN COMMAND
              </span>
              <span>
                NOVA V3 / NEURAL OPERATIONS{" "}
                <span className="footer-dot">·</span> V3.0
              </span>
            </footer>
          </div>
        </main>
        <AnimatePresence>
          {panel && (
            <VoiceStudio
              key="studio"
              view={view}
              settings={settings}
              voices={voices}
              devices={devices}
              state={state}
              level={level}
              samples={samples}
              permission={permission}
              locked={locked}
              canRecord={online && voiceAvailable}
              pending={!!pending}
              onClose={() => setPanel(false)}
              onChange={(patch) => {
                const updated = { ...settings, ...patch };
                liveSettings.current = updated;
                setSettings(updated);
                if (patch.voice_response === false) stopSpeaking();
              }}
              onSave={() => void save()}
              onListen={() => void listen()}
              onFinish={() => void finishListening()}
              onCancel={() => void finishListening(true)}
              onDiscover={() => void discoverMicrophones()}
              onStop={stopSpeaking}
              onPreview={() => {
                if (busy.current) return;
                busy.current = true;
                setState("Processing");
                liveSettings.current = { ...settings, voice_response: true };
                speak("NOVA. A thought away. A world in motion.");
                liveSettings.current = settings;
              }}
            />
          )}
          {tour && (
            <Onboarding
              key="onboarding"
              onClose={finishOnboarding}
              onPalette={() => {
                finishOnboarding();
                setPalette(true);
              }}
            />
          )}
          {palette && (
            <CommandPalette
              key="palette"
              commands={commands.map(({ title }) => title)}
              recent={recent}
              disabled={!online || locked || !!pending}
              onClose={() => setPalette(false)}
              onExecute={(text) => {
                setPalette(false);
                runQuick(text);
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
