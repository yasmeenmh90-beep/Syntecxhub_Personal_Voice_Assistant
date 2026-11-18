# NOVA redesign verification

Date: 2026-11-15. The frontend redesign preserves the existing FastAPI routes and command engine. No backend rewrite, new dependency, commit, or push was needed.

## Automated checks

| Check | Result | Evidence and limits |
| --- | --- | --- |
| TypeScript | Passed | `npm run build` runs `tsc -b` |
| ESLint | Passed | `npm run lint` |
| Frontend interaction tests | 28 passed | Submission, confirmation, history, voice lifecycle, settings, quick commands, copy, palette shortcut/filter/Enter/Escape/focus restoration, measured trace. jsdom with mocked browser audio/network. |
| Production build | Passed | Vite emitted `frontend/dist/`; about 128 KB gzipped JS and 8 KB gzipped CSS |
| Python tests | 32 passed | `.venv/bin/python -m unittest discover -s tests -v`; real in-process API, persistence, command mapping, validation and security; OS/recognition boundaries mocked |
| Live HTTP integration | Passed | `.venv/bin/python scripts/check_integration.py` with elevated local socket access. Real health/commands, safe time/date/greeting, invalid/unsupported commands, confirmation, settings change/read/restore, Vite proxy and frontend HTML. |

The sandbox initially rejected local sockets. Elevated startup attempts found ports 8000 and 5173 occupied; the already-running NOVA services were verified and used. No existing service was killed or restarted. No new service was left running by verification.

Python emitted existing Starlette/httpx and Python audio-module deprecation warnings. These did not fail tests. Dependencies were already available in the project environment.

## Rendered browser checks

Headless Google Chrome with the real development server, using Chrome DevTools Protocol:

- Desktop 1440 × 1100, tablet 850 × 1100, mobile 390 × 1000 CSS pixels: document width exactly matched viewport width at every size; initial scroll position remained zero; navigation remained accessible.
- Full-page screenshots reviewed and saved to `docs/screenshots/`. Mobile execution steps use two columns so labels remain readable.
- The command palette opened and focused its search field.
- Typed `what time is it?` through the React input and submitted the real form. The local backend returned the actual system time into the conversation.
- Open Calculator paused at the confirmation card. Cancel was exercised; no OS launch was requested.
- Voice Studio opened with a real input meter and 200 voice options (including Browser default) reported by the headless browser.
- Switching to daylight rendered `data-theme="light"` with no horizontal overflow; midnight was restored afterward.
- Emulated `prefers-reduced-motion: reduce` produced `animation-name: none` on the orbital rings.
- Final browser run captured zero runtime exceptions or browser log errors.
- Earlier review found and fixed page-level auto-scroll caused by conversation scrolling, conflicting legacy responsive CSS, and a missing favicon.

Headless Chrome prints native display-link diagnostics on this Mac; those are separate from page JavaScript exceptions. The final page console check captures runtime exceptions and browser log entries.

## What the telemetry means

The current API returns one command result rather than streaming stages. Input/request start, recognized text, approval, returned action type, completion/error and response are observed events. Intent/execution appear together on response; utilities without an action object are labeled “see response.” The UI does not infer invented stage timings. Latency is measured browser HTTP round-trip time, excluding recording, recognition and speech playback.

Microphone bars and sphere scale use measured RMS amplitude from Web Audio. Idle motion is decorative breathing/orbiting. Browser speech synthesis supplies playback start/end/error events but does not expose PCM samples; speaking illumination follows those real events and is not represented as a measured frequency spectrum. No random audio activity is generated.

Activity and conversation history are session-only. Recent palette commands are also session-only; preferences continue to persist through the existing backend settings endpoint. Activity is capped at 100 events. Voice recognition remains a bounded recording request, not streaming transcription.

## Hardware and manual acceptance still required

- Grant real browser/macOS microphone permission, speak, verify measured levels, finish and cancel, verify the 15-second limit and microphone indicator cleanup.
- Confirm actual Google recognition succeeds with a physical microphone and network access. Unit tests cover success/error routing but do not establish speech quality.
- Hear the selected voice, preview and speaking rate through physical speakers; verify mute/stop. Headless browser voice enumeration and playback events do not prove audible output.
- Select and disconnect physical input devices; verify fallback/errors and persisted device identifiers.
- Confirm and visually verify Calculator, Notes, Safari and website launches. No real app launch or external navigation was performed in this redesign check.
- Check VoiceOver announcements, keyboard-only interaction and subjective animation smoothness on the target Mac. Reduced-motion CSS is checked; no 60 FPS benchmark is claimed.

Run both local services with `bash scripts/start-local.sh`, then open http://127.0.0.1:5173. Use Cmd/Ctrl + K for the palette and the navigation rail for Voice Studio and Activity Timeline.
