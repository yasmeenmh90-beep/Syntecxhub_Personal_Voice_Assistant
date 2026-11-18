import { useEffect, useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import {
  Check,
  ChevronRight,
  Headphones,
  Mic,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Settings } from "./api";
import { Signal } from "./Signal";
import { useDialog } from "./dialog";
export type MicrophonePermission = PermissionState | "unknown";
export function useMicrophonePermission() {
  const [permission, setPermission] = useState<MicrophonePermission>("unknown");
  useEffect(() => {
    let active = true;
    let status: PermissionStatus | undefined;
    const update = () => {
      if (active && status) setPermission(status.state);
    };
    void navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((value) => {
        if (!active) return;
        status = value;
        update();
        status.addEventListener("change", update);
      })
      .catch(() => {
        /* Safari may not support querying microphone permission. */
      });
    return () => {
      active = false;
      status?.removeEventListener("change", update);
    };
  }, []);
  return [permission, setPermission] as const;
}
type Props = {
  view: string;
  settings: Settings;
  voices: SpeechSynthesisVoice[];
  devices: MediaDeviceInfo[];
  state: string;
  level: number;
  samples: number[];
  permission: MicrophonePermission;
  locked: boolean;
  canRecord: boolean;
  pending: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onSave: () => void;
  onListen: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onDiscover: () => void;
  onPreview: () => void;
  onStop: () => void;
};
export function VoiceStudio(props: Props) {
  const {
    view,
    settings,
    voices,
    devices,
    state,
    level,
    samples,
    permission,
    locked,
    canRecord,
    pending,
    onChange,
    onClose,
    onSave,
    onListen,
    onFinish,
    onCancel,
    onDiscover,
    onPreview,
    onStop,
  } = props;
  const ref = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useDialog(ref, onClose, present);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const languages = Array.from(
    new Set(voices.map((voice) => voice.lang)),
  ).sort();
  const available = voices.filter(
    (voice) =>
      (language === "all" || voice.lang === language) &&
      `${voice.name} ${voice.lang}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = voices.find((voice) => voice.voiceURI === settings.voice);
  return (
    <motion.div
      className="modal-backdrop studio-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.section
        ref={ref}
        role={present ? "dialog" : undefined}
        aria-modal="true"
        aria-label={view === "Voice Studio" ? "Voice Studio" : "Preferences"}
        className={present ? "settings-panel" : "modal-exit-surface"}
        data-surface="studio"
        inert={!present}
        initial={{ x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 48, opacity: 0 }}
        transition={{ type: "tween", duration: 0.22 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-header">
          <div>
            <div className="eyebrow">AUDIO / CONFIGURATION</div>
            <h2>
              {view === "Voice Studio" ? "Voice Studio" : "Preferences"}
              <span>03</span>
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <div className="studio-body">
          <p className="settings-intro">
            A voice that feels like yours.
            <br />
            <span>Fine-tune the way you connect with NOVA.</span>
          </p>
          <section className="studio-input">
            <div className="studio-section-title">
              <h3>
                <Mic size={15} /> Input signal
              </h3>
              <span
                className={
                  "audio-status " + (state === "Listening" ? "live" : "")
                }
              >
                <i />
                {state === "Listening"
                  ? "CAPTURING"
                  : state === "Processing"
                    ? "PROCESSING"
                    : "STANDBY"}
              </span>
            </div>
            <div className="studio-signal">
              <Signal samples={samples} active={state === "Listening"} />
              <div className="signal-scale">
                <span>PCM / TIME DOMAIN</span>
                <span>
                  {state === "Listening" ? "LIVE CAPTURE" : "NO ACTIVE CAPTURE"}
                </span>
              </div>
            </div>
            <div className="input-meter">
              <label htmlFor="microphone-level">
                Input level <span>{Math.round(level * 100)}%</span>
              </label>
              <meter
                id="microphone-level"
                min="0"
                max="1"
                value={level}
                aria-label="Microphone level"
              />
              <div className="meter-ticks">
                <span>0</span>
                <span>RMS AMPLITUDE</span>
                <span>100%</span>
              </div>
            </div>
            <div className="permission-status">
              <ShieldCheck size={14} />
              <span>Microphone permission</span>
              <strong
                className={permission === "denied" ? "permission-denied" : ""}
              >
                {permission === "unknown"
                  ? "Not reported"
                  : permission === "prompt"
                    ? "Not requested"
                    : permission === "granted"
                      ? "Granted"
                      : "Denied"}
              </strong>
            </div>
            <div className="studio-controls">
              {state === "Listening" ? (
                <>
                  <button className="studio-primary" onClick={onFinish}>
                    <Square size={13} /> Finish studio recording
                  </button>
                  <button className="studio-secondary" onClick={onCancel}>
                    Cancel studio recording
                  </button>
                </>
              ) : (
                <button
                  className="studio-primary"
                  disabled={!canRecord || locked || pending}
                  onClick={onListen}
                >
                  <Mic size={15} /> Record a voice command
                </button>
              )}
            </div>
            <label className="field-label">
              Input device
              <select
                aria-label="Microphone"
                value={settings.microphone}
                disabled={state === "Listening"}
                onChange={(event) =>
                  onChange({ microphone: event.target.value })
                }
              >
                <option value="">System default</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label ||
                      `Microphone ${device.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="studio-text-button"
              disabled={locked}
              onClick={onDiscover}
            >
              Find microphones / grant permission <ChevronRight size={13} />
            </button>
            <small className="studio-help">
              Recording ends after 15 seconds. Finish sends audio for
              recognition; Cancel discards it.
            </small>
          </section>
          <section className="studio-output">
            <div className="studio-section-title">
              <h3>
                <Headphones size={15} /> Output voice
              </h3>
              <span
                className={
                  "audio-status " + (state === "Speaking" ? "live" : "")
                }
              >
                <i />
                {state === "Speaking" ? "PLAYING" : "READY"}
              </span>
            </div>
            <div className="selected-voice">
              <span className="voice-avatar">
                <Volume2 size={21} />
              </span>
              <div>
                <strong>
                  {selected?.name ??
                    (settings.voice
                      ? "Saved voice unavailable"
                      : "Browser default")}
                </strong>
                <small>
                  {selected
                    ? `${selected.lang} · ${selected.localService ? "On-device voice" : "Network voice"}`
                    : "Uses the browser’s available default voice"}
                </small>
              </div>
              <Check size={16} />
            </div>
            <div className="voice-search">
              <label>
                <Search size={14} />
                <input
                  aria-label="Search voices"
                  placeholder="Find a voice…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <select
                aria-label="Voice language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="all">All languages</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="voice-options"
              role="group"
              aria-label="Available voices"
            >
              <button
                className={!settings.voice ? "selected" : ""}
                aria-pressed={!settings.voice}
                onClick={() => onChange({ voice: "" })}
              >
                <span>
                  Browser default<small>Automatic voice selection</small>
                </span>
                {!settings.voice && <Check size={14} />}
              </button>
              {available.map((voice) => (
                <button
                  key={voice.voiceURI}
                  aria-pressed={voice.voiceURI === settings.voice}
                  className={
                    voice.voiceURI === settings.voice ? "selected" : ""
                  }
                  onClick={() => onChange({ voice: voice.voiceURI })}
                >
                  <span>
                    {voice.name}
                    <small>
                      {voice.lang} ·{" "}
                      {voice.localService ? "On-device" : "Network"}
                    </small>
                  </span>
                  {voice.voiceURI === settings.voice && <Check size={14} />}
                </button>
              ))}
              {!available.length && (
                <p>
                  {voices.length
                    ? "No voices match your search."
                    : "No voices reported yet. Availability depends on your browser."}
                </p>
              )}
            </div>
            <small className="studio-help">
              {voices.length} voices provided by this browser.
            </small>
            <div className="studio-preview">
              {state === "Speaking" ? (
                <button className="studio-primary" onClick={onStop}>
                  <VolumeX size={15} /> Stop voice preview / playback
                </button>
              ) : (
                <button
                  className="studio-secondary"
                  disabled={locked || pending}
                  onClick={onPreview}
                >
                  <Volume2 size={15} /> Preview selected voice
                </button>
              )}
              <span>Uses selected voice & rate</span>
            </div>
            <label className="field-label rate-label">
              Speaking rate <output>{settings.rate.toFixed(1)}×</output>
              <input
                aria-label="Speaking rate"
                type="range"
                min=".5"
                max="2"
                step=".1"
                value={settings.rate}
                onChange={(event) =>
                  onChange({ rate: Number(event.target.value) })
                }
              />
              <span className="range-labels">
                <span>Considered / 0.5×</span>
                <span>Quick / 2.0×</span>
              </span>
            </label>
            <label className="check-label mute-control">
              <span>
                <Volume2 size={16} /> Speak assistant responses
              </span>
              <input
                type="checkbox"
                checked={settings.voice_response}
                onChange={(event) =>
                  onChange({ voice_response: event.target.checked })
                }
              />
            </label>
          </section>
          <section className="studio-appearance">
            <h3>
              <SlidersHorizontal size={15} /> Workspace appearance
            </h3>
            <div className="appearance-options">
              {(["dark", "light"] as const).map((theme) => (
                <button
                  aria-pressed={settings.theme === theme}
                  key={theme}
                  onClick={() => onChange({ theme })}
                >
                  <span className={"theme-swatch " + theme} />
                  {theme === "dark" ? "Midnight" : "Daylight"}
                  {settings.theme === theme && <Check size={14} />}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="studio-footer">
          <span>
            <ShieldCheck size={13} /> Saved on this computer
          </span>
          <button className="save-button" onClick={onSave}>
            Save preferences <Check size={15} />
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
