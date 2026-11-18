import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { motion, useIsPresent } from "motion/react";
import {
  ArrowUpRight,
  Command,
  Search,
  X,
  Terminal,
  Globe,
  Mic,
  Keyboard,
  ScanLine,
  Zap,
  MessageSquare,
  Check,
  Clock3,
  Copy,
  Trash2,
  ChevronDown,
  Activity,
} from "lucide-react";
import { useDialog } from "./dialog";

export type Execution = {
  text: string;
  source: string;
  status: string;
  latency: number | null;
  action: { type: string; target: string } | null;
  response?: string;
  recognitionMs?: number;
  recognitionError?: string;
  error?: string;
};
export type EventCategory = "connection" | "voice" | "command" | "system";
export type ActivityEvent = {
  id: number;
  time: string;
  text: string;
  category: EventCategory;
  severity: "info" | "success" | "warning" | "error";
};
export const NeuralCore = memo(function NeuralCore({
  state,
  level,
  samples,
}: {
  state: string;
  level: number;
  samples: number[];
}) {
  const gradient = useId();
  const root = useRef<HTMLDivElement>(null);
  const values =
    samples.length && state === "Listening"
      ? samples
      : Array<number>(64).fill(0);
  const geometry = values
    .map((sample, index) => {
      const angle = (index / values.length) * Math.PI * 2;
      const radius = 92 + sample * 32;
      return `${200 + Math.cos(angle) * radius},${150 + Math.sin(angle) * radius}`;
    })
    .join(" ");
  return (
    <div
      ref={root}
      className={"neural-space " + state.toLowerCase()}
      aria-label={"Neural core: " + state}
      style={{ "--amplitude": Math.min(level * 3, 0.5) } as CSSProperties}
      onPointerMove={(event) => {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        root.current?.style.setProperty(
          "--parallax-x",
          `${((event.clientX - bounds.left) / bounds.width - 0.5) * 12}px`,
        );
        root.current?.style.setProperty(
          "--parallax-y",
          `${((event.clientY - bounds.top) / bounds.height - 0.5) * 8}px`,
        );
      }}
      onPointerLeave={() => {
        root.current?.style.setProperty("--parallax-x", "0px");
        root.current?.style.setProperty("--parallax-y", "0px");
      }}
    >
      <div className="core-aura" />
      <div className="core-grid" />
      <div className="core-axis horizontal" />
      <div className="core-axis vertical" />
      <div className="core-depth">
        <svg viewBox="0 0 400 300" className="neural-orbits" aria-hidden="true">
          <defs>
            <linearGradient id={gradient}>
              <stop stopColor="#67e8f9" />
              <stop offset=".45" stopColor="#c6b4ff" />
              <stop offset="1" stopColor="#8b5cf6" stopOpacity=".1" />
            </linearGradient>
          </defs>
          <g className="outer-orbit" style={{ stroke: `url(#${gradient})` }}>
            <ellipse cx="200" cy="150" rx="176" ry="116" />
            {[0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={200 + 176 * Math.cos((i * Math.PI) / 2)}
                cy={150 + 116 * Math.sin((i * Math.PI) / 2)}
                r={i === 0 ? 2.5 : 1.5}
              />
            ))}
          </g>
          <g className="slant-orbit" style={{ stroke: `url(#${gradient})` }}>
            <ellipse cx="200" cy="150" rx="150" ry="58" />
            <circle cx="350" cy="150" r="3" />
          </g>
          <g className="inner-orbit" style={{ stroke: `url(#${gradient})` }}>
            <ellipse cx="200" cy="150" rx="118" ry="105" />
            <circle cx="82" cy="150" r="2" />
          </g>
          <g className="connection-web">
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const x = 200 + 158 * Math.cos((i * Math.PI) / 3),
                y = 150 + 104 * Math.sin((i * Math.PI) / 3);
              return (
                <g key={i} style={{ animationDelay: `${i * 0.7}s` }}>
                  <path d={`M${x} ${y}L200 150`} />
                  <circle cx={x} cy={y} r="1.8" />
                </g>
              );
            })}
          </g>
          <polygon className="reactive-geometry" points={geometry} />
          <circle className="reticle" cx="200" cy="150" r="130" />
          <path
            className="core-crosshair"
            d="M12 150h14m348 0h14M200 12v10m0 256v10"
          />
        </svg>
        <div className="energy-sphere">
          <div className="energy-flow" />
          <div className="sphere-meridian" />
          <span className="core-monogram">
            N<span>•</span>
          </span>
        </div>
      </div>
      <span className="core-coordinate">
        NEURAL ENGINE <b>01</b>
      </span>
      <span className="core-coordinate right">{state.toUpperCase()}</span>
    </div>
  );
});
const commandCategory = (text: string) =>
  /google|youtube|github|search|browser/i.test(text)
    ? "Web"
    : /^open /i.test(text)
      ? "Applications"
      : "Utilities";
const fuzzy = (text: string, query: string) => {
  let index = 0;
  for (const char of text.toLowerCase()) if (char === query[index]) index++;
  return index === query.length;
};
export function CommandPalette({
  commands,
  recent,
  disabled,
  onClose,
  onExecute,
}: {
  commands: string[];
  recent: string[];
  disabled: boolean;
  onClose: () => void;
  onExecute: (command: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const [category, setCategory] = useState("All");
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useDialog(dialog, onClose, present);
  const results = Array.from(new Set([...recent, ...commands])).filter(
    (text) =>
      (category === "All" ||
        (category === "Recent"
          ? recent.includes(text)
          : commandCategory(text) === category)) &&
      fuzzy(text, query.toLowerCase().replaceAll(" ", "")),
  );
  useEffect(() => {
    resultRefs.current[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <motion.div
      className="modal-backdrop palette-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.16 }}
        data-surface="palette"
        className={present ? "command-palette" : "modal-exit-surface"}
        inert={!present}
        role={present ? "dialog" : undefined}
        aria-modal="true"
        aria-label="Command palette"
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected(
              (value) =>
                (value +
                  (e.key === "ArrowDown" ? 1 : -1) +
                  Math.max(results.length, 1)) %
                Math.max(results.length, 1),
            );
          }
          if (
            e.key === "Enter" &&
            e.target instanceof HTMLInputElement &&
            results[selected] &&
            !disabled
          ) {
            e.preventDefault();
            onExecute(results[selected]);
          }
        }}
      >
        <div className="palette-search">
          <Search size={20} />
          <input
            data-autofocus
            aria-label="Search commands"
            aria-describedby="palette-selection"
            placeholder="Find your next action…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
          <button aria-label="Close command palette" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="palette-categories" aria-label="Command categories">
          {["All", "Applications", "Web", "Utilities", "Recent"].map((item) => (
            <button
              key={item}
              aria-pressed={category === item}
              onClick={() => {
                setCategory(item);
                setSelected(0);
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="palette-label">
          {query
            ? "MATCHING COMMANDS"
            : recent.length
              ? "RECENT / ALL COMMANDS"
              : "ALL COMMANDS"}
        </div>
        <div className="palette-results">
          {results.map((text, index) => (
            <button
              key={text}
              ref={(el) => {
                resultRefs.current[index] = el;
              }}
              data-selected={index === selected}
              className={index === selected ? "selected" : ""}
              disabled={disabled}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onExecute(text)}
            >
              <span className="palette-command-icon">
                {commandCategory(text) === "Applications" ? (
                  <Terminal size={17} />
                ) : commandCategory(text) === "Web" ? (
                  <Globe size={17} />
                ) : (
                  <Command size={17} />
                )}
              </span>
              <span>
                {text}
                <small>
                  {recent.includes(text) ? "RECENT · " : ""}
                  {commandCategory(text)}
                  {text.toLowerCase().startsWith("open")
                    ? " · APPROVAL REQUIRED"
                    : ""}
                </small>
              </span>
              {index === selected ? <kbd>↵</kbd> : <ArrowUpRight size={15} />}
            </button>
          ))}
          {!results.length && <p>No matching commands.</p>}
        </div>
        <span id="palette-selection" className="sr-only" aria-live="polite">
          {results.length} results. {results[selected] ?? "No selected command"}
        </span>
        <div className="palette-footer">
          ↑ ↓ navigate · ↵ execute · esc close
          {disabled && <span>Waiting for backend or active interaction</span>}
        </div>
      </motion.div>
    </motion.div>
  );
}

type StageTone = "idle" | "active" | "done" | "warning" | "error" | "skip";
function stageInfo(
  execution: Execution | null,
  index: number,
): { label: string; tone: StageTone; detail: string } {
  if (!execution)
    return {
      label: "Awaiting input",
      tone: "idle",
      detail: "No command has been submitted in this session.",
    };
  const received = execution.latency !== null;
  const capture = execution.status === "capture";
  const recognizing = execution.status === "recognizing";
  if (index === 0)
    return {
      label: capture
        ? "Capturing"
        : execution.status === "canceled" && !execution.text
          ? "Canceled"
          : execution.source,
      tone: capture ? "active" : "done",
      detail:
        execution.text ||
        "Recording microphone input. Finish to request recognition.",
    };
  if (index === 1) {
    if (execution.source !== "voice")
      return {
        label: "typed / skip",
        tone: "skip",
        detail: "Typed and quick commands do not need speech recognition.",
      };
    if (
      execution.status === "canceled" &&
      execution.recognitionMs === undefined
    )
      return {
        label: "Canceled",
        tone: "skip",
        detail:
          "The recording was discarded before recognition. No transcription request was made.",
      };
    if (execution.recognitionError)
      return {
        label: "Failed",
        tone: "error",
        detail: execution.recognitionError,
      };
    return {
      label: capture ? "Waiting" : recognizing ? "Recognizing" : "Recognized",
      tone: capture ? "idle" : recognizing ? "active" : "done",
      detail:
        execution.recognitionMs !== undefined
          ? `Transcription request completed in ${execution.recognitionMs} ms. Recognized: ${execution.text}`
          : "Recognition begins when recording finishes. No partial transcript is supplied.",
    };
  }
  if (index === 2)
    return {
      label: received
        ? (execution.action?.type ?? "See response")
        : "Awaiting result",
      tone: received
        ? execution.status === "error"
          ? "error"
          : "done"
        : "idle",
      detail: execution.action
        ? `Returned action: ${execution.action.type}. Target: ${execution.action.target}`
        : received
          ? "This API does not return an intent label for this command. Refer to its response."
          : "The API reports intent and execution together; no intermediate intent event is available.",
    };
  if (index === 3) {
    if (execution.status === "confirmation_required")
      return {
        label: "Approval needed",
        tone: "warning",
        detail:
          "The backend requested confirmation. No application or page has been launched.",
      };
    if (execution.status === "canceled")
      return {
        label: "Canceled",
        tone: "skip",
        detail: "You canceled the action before execution.",
      };
    if (execution.status === "error")
      return {
        label: "Failed",
        tone: "error",
        detail:
          execution.error ??
          execution.response ??
          execution.recognitionError ??
          "The request failed before an execution result could be returned.",
      };
    return {
      label: received
        ? "Completed"
        : execution.status === "request"
          ? "Request in flight"
          : "Waiting",
      tone: received
        ? "done"
        : execution.status === "request"
          ? "active"
          : "idle",
      detail: received
        ? "The backend returned completion. Application completion means the operating system accepted the launch."
        : "Only request activity is observable until the backend responds.",
    };
  }
  return {
    label: received
      ? "Received"
      : execution.status === "error"
        ? "No response"
        : "Pending",
    tone: received
      ? execution.status === "error"
        ? "error"
        : "done"
      : execution.status === "error"
        ? "error"
        : "idle",
    detail:
      execution.response ??
      execution.error ??
      "The response will appear here when the command request completes.",
  };
}
export function ExecutionPanel({
  execution,
  events,
  expanded,
  onClear,
  onError,
}: {
  execution: Execution | null;
  events: ActivityEvent[];
  expanded: boolean;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const stages = [
    ["INPUT", execution?.source === "voice" ? Mic : Keyboard],
    ["RECOGNITION", ScanLine],
    ["INTENT", Zap],
    ["EXECUTION", Terminal],
    ["RESPONSE", MessageSquare],
  ] as const;
  return (
    <section className="telemetry-grid" aria-label="Execution and activity">
      <div className="panel execution-panel">
        <div className="panel-heading">
          <div>
            <span className="mini-dot" />
            EXECUTION TRACE
          </div>
          <span className="tag">
            {execution?.latency != null
              ? `${execution.latency} MS / ROUND TRIP`
              : execution
                ? "OBSERVING REQUEST"
                : "AWAITING INPUT"}
          </span>
        </div>
        <div className="trace-caption">
          <h3>From signal to action.</h3>
          <span>
            {execution ? execution.status.replaceAll("_", " ") : "Standing by"}
          </span>
        </div>
        <div className="execution-path">
          {stages.map(([label, Icon], index) => {
            const info = stageInfo(execution, index);
            return (
              <button
                key={label}
                className={"trace-stage " + info.tone}
                aria-expanded={open === index}
                aria-controls="trace-stage-detail"
                onClick={() => setOpen((old) => (old === index ? null : index))}
              >
                <span className="stage-number">0{index + 1}</span>
                <span className="stage-node">
                  <Icon size={18} />
                  {info.tone === "done" && (
                    <Check size={9} className="stage-check" />
                  )}
                </span>
                <strong>{label}</strong>
                <small>{info.label}</small>
                <ChevronDown size={11} className="stage-chevron" />
              </button>
            );
          })}
        </div>
        <div className="trace-payload">
          <span>PAYLOAD</span>
          <p className="trace-detail">
            {execution?.text ||
              (execution?.status === "capture"
                ? "Microphone capture in progress…"
                : "Submit a command to inspect its execution.")}
          </p>
        </div>
        {open !== null && (
          <motion.div
            id="trace-stage-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="stage-detail"
          >
            <strong>
              {stages[open][0]} <span>{stageInfo(execution, open).label}</span>
            </strong>
            <p>{stageInfo(execution, open).detail}</p>
          </motion.div>
        )}
        <small className="trace-note">
          <Clock3 size={12} /> Timings are measured at the client. Intent and
          execution arrive together.
        </small>
      </div>
      <ActivityConsole
        events={events}
        expanded={expanded}
        onClear={onClear}
        onError={onError}
      />
    </section>
  );
}
export function ActivityConsole({
  events,
  expanded,
  onClear,
  onError,
}: {
  events: ActivityEvent[];
  expanded: boolean;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [copied, setCopied] = useState<number | null>(null);
  const filtered = events
    .filter(
      (event) =>
        (category === "all" || event.category === category) &&
        `${event.text} ${event.time} ${event.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice()
    .reverse();
  async function copy(event: ActivityEvent) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error(
          "Clipboard unavailable. Expand the event and select its text to copy.",
        );
      await navigator.clipboard.writeText(
        `[${event.time}] [${event.category}] ${event.text}`,
      );
      setCopied(event.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <div className="panel activity-console">
      <div className="panel-heading">
        <div>
          <Activity size={14} />
          ACTIVITY CONSOLE
        </div>
        <div className="console-heading-actions">
          <span className="tag">{events.length} EVENTS</span>
          <button
            aria-label="Clear activity"
            title="Clear session activity"
            disabled={!events.length}
            onClick={onClear}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="console-toolbar">
        <label className="console-search">
          <Search size={13} />
          <input
            aria-label="Search activity"
            placeholder="Search events…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="Activity category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All events</option>
          {["connection", "voice", "command", "system"].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div
        className={"console-lines " + (expanded ? "expanded" : "")}
        role="log"
        aria-label="Activity console"
        aria-live="polite"
      >
        {!filtered.length && (
          <div className="console-empty">
            <Terminal size={22} />
            <p>
              {events.length
                ? "No events match your filters."
                : "A clear console."}
            </p>
            <small>
              {events.length
                ? "Try another category or search."
                : "Real application events appear here as they happen."}
            </small>
          </div>
        )}
        {filtered.map((event) => (
          <div
            className={"console-event event-" + event.severity}
            key={event.id}
          >
            <details>
              <summary>
                <span className="event-indicator" />
                <time>{event.time}</time>
                <span className="event-summary">{event.text}</span>
                <ChevronDown size={12} />
              </summary>
              <div className="event-details">
                <span>
                  {event.category.toUpperCase()} /{" "}
                  {event.severity.toUpperCase()}
                </span>
                <p>{event.text}</p>
                <button
                  onClick={() => void copy(event)}
                  aria-label={`Copy event ${event.id}`}
                >
                  {copied === event.id ? (
                    <Check size={12} />
                  ) : (
                    <Copy size={12} />
                  )}{" "}
                  {copied === event.id ? "Copied" : "Copy event"}
                </button>
              </div>
            </details>
          </div>
        ))}
      </div>
      <div className="console-footer">
        <span>
          <i /> SESSION LOG
        </span>
        <span>
          {filtered.length} / {events.length} visible
        </span>
      </div>
    </div>
  );
}
