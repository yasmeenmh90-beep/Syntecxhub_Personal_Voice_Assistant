import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Timer as TimerIcon, X } from "lucide-react";

export type Timer = { id: number; total: number; endsAt: number };

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function describe(seconds: number) {
  const parts: string[] = [];
  for (const [name, size] of [
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ] as const) {
    const count = Math.floor(seconds / size);
    seconds %= size;
    if (count) parts.push(`${count} ${name}${count === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

/** A short two-note chime from Web Audio; silently skipped if unavailable. */
export function chime() {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [880, 1318.5, 880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain(),
        start = ctx.currentTime + i * 0.28;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.27);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* Audio output is a nicety; the visual and spoken alerts still fire. */
  }
}

const R = 19,
  C = 2 * Math.PI * R;

export function TimerDock({
  timers,
  onCancel,
  onFinish,
}: {
  timers: Timer[];
  onCancel: (id: number) => void;
  onFinish: (timer: Timer) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const finished = useRef(new Set<number>());
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (!timers.length) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      for (const timer of timers)
        if (t >= timer.endsAt && !finished.current.has(timer.id)) {
          finished.current.add(timer.id);
          finish.current(timer);
        }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timers]);
  return (
    <div className="timer-dock" aria-live="polite" aria-label="Active timers">
      <AnimatePresence>
        {timers.map((timer) => {
          const left = timer.endsAt - now,
            done = left <= 0,
            progress = Math.min(1, Math.max(0, left / (timer.total * 1000)));
          return (
            <motion.div
              layout
              key={timer.id}
              className={"timer-chip" + (done ? " done" : "")}
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              <svg viewBox="0 0 46 46" className="timer-ring" aria-hidden>
                <circle cx="23" cy="23" r={R} className="track" />
                <circle
                  cx="23"
                  cy="23"
                  r={R}
                  className="progress"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - progress)}
                />
              </svg>
              <span className="timer-glyph">
                {done ? <BellRing size={15} /> : <TimerIcon size={15} />}
              </span>
              <div>
                <strong>{done ? "Time's up" : formatClock(left)}</strong>
                <small>Timer · {describe(timer.total)}</small>
              </div>
              <button
                className="icon-button"
                aria-label={done ? "Dismiss timer" : "Cancel timer"}
                onClick={() => onCancel(timer.id)}
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
