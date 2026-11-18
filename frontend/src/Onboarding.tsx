import { useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import {
  ArrowRight,
  Command,
  Mic,
  ShieldCheck,
  Sparkles,
  Settings2,
  X,
} from "lucide-react";
import { useDialog } from "./dialog";
const key = "nova.onboarding.v3";
export function hasCompletedOnboarding() {
  try {
    return window.localStorage.getItem(key) === "done";
  } catch {
    return false;
  }
}
export function rememberOnboarding() {
  try {
    window.localStorage.setItem(key, "done");
  } catch {
    /* The tour can still be dismissed for this session. */
  }
}
const steps = [
  {
    icon: Sparkles,
    kicker: "MEET YOUR LOCAL CO-PILOT",
    title: "A little intent. A real action.",
    description:
      "NOVA turns simple commands into everyday actions. Check the time, open Notes, launch an app, or search the web. Your commands run through a local, rule-based assistant.",
    example: "Try typing ‘what time is it?’",
  },
  {
    icon: Mic,
    kicker: "01 / SEND A SIGNAL",
    title: "Speak. Finish. Connect.",
    description:
      "Tap the microphone, speak naturally, then finish recording. NOVA sends your audio to Google’s speech recognizer and displays the recognized words before executing the command. Recording is limited to 15 seconds.",
    example: "Cancel recording to discard the audio.",
  },
  {
    icon: ShieldCheck,
    kicker: "02 / STAY IN COMMAND",
    title: "Your computer. Your decision.",
    description:
      "Opening applications and web pages requires an explicit confirmation. Review the request in the conversation, then confirm or cancel. Nothing launches while approval is pending.",
    example: "Time, date, and greetings do not need approval.",
  },
  {
    icon: Command,
    kicker: "03 / TAKE THE SHORTCUT",
    title: "Your next move, a keystroke away.",
    description:
      "Press Cmd + K on Mac or Ctrl + K elsewhere. Search commands, filter categories, use the arrow keys to navigate, and press Enter to execute. Escape closes the palette.",
    example: "Recent commands stay available for this session.",
  },
  {
    icon: Settings2,
    kicker: "04 / MAKE IT YOURS",
    title: "Find your voice.",
    description:
      "Open Voice Studio to grant microphone access, select an input device, and preview the voices reported by your browser. If access is denied, allow the microphone in browser and macOS privacy settings.",
    example: "Typed commands work without microphone permission.",
  },
] as const;
export function Onboarding({
  onClose,
  onPalette,
}: {
  onClose: () => void;
  onPalette: () => void;
}) {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const present = useIsPresent();
  useDialog(ref, onClose, present);
  const current = steps[step];
  const Icon = current.icon;
  return (
    <motion.div
      className="modal-backdrop onboarding-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.section
        ref={ref}
        className="onboarding-dialog"
        role={present ? "dialog" : undefined}
        aria-modal="true"
        aria-label="Welcome to NOVA"
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
        inert={!present}
      >
        <div className="onboarding-top">
          <span>NOVA / FIRST CONTACT</span>
          <button
            className="icon-button"
            aria-label="Close introduction"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="onboarding-art">
          <span className="onboarding-orbit" />
          <Icon size={42} strokeWidth={1} />
        </div>
        <motion.div
          key={step}
          className="onboarding-copy"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="eyebrow">{current.kicker}</div>
          <h2>{current.title}</h2>
          <p>{current.description}</p>
          <div className="onboarding-tip">{current.example}</div>
        </motion.div>
        <div
          className="tour-progress"
          aria-label={`Step ${step + 1} of ${steps.length}`}
        >
          {steps.map((item, index) => (
            <span
              key={item.kicker}
              className={index === step ? "active" : ""}
            />
          ))}
        </div>
        <div className="onboarding-actions">
          <button className="text-button" onClick={onClose}>
            Skip introduction
          </button>
          <div>
            {step > 0 && (
              <button
                className="studio-secondary"
                onClick={() => setStep((value) => value - 1)}
              >
                Back
              </button>
            )}
            {step === steps.length - 1 ? (
              <button className="studio-primary" onClick={onPalette}>
                Open command palette <Command size={15} />
              </button>
            ) : (
              <button
                className="studio-primary"
                onClick={() => setStep((value) => value + 1)}
              >
                Continue <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
