#!/bin/bash
# Run in your own Mac Terminal. All Python/Node packages stay in this checkout.
set -euo pipefail
NOVA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NOVA_ROOT"
NOVA_PYTHON="${NOVA_PYTHON:-python3.12}"
if ! command -v "$NOVA_PYTHON" >/dev/null; then
  echo "Install Python 3.12, or set NOVA_PYTHON to your Python executable."
  exit 1
fi
command -v node >/dev/null || { echo "Install Node 22 LTS or newer."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Use Node 22 or newer"); process.exit(1) }'
if [[ ! -x .venv/bin/python ]]; then "$NOVA_PYTHON" -m venv .venv; fi
.venv/bin/python --version
node --version
.venv/bin/python -m pip install -r requirements-dev.txt
if [[ "${1:-}" == "--native-audio" ]]; then
  echo "Installing optional CLI microphone/TTS dependencies. PyAudio may require: brew install portaudio"
  .venv/bin/python -m pip install -r requirements-cli.txt
elif [[ -n "${1:-}" ]]; then
  echo "Usage: bash scripts/setup-macos.sh [--native-audio]"
  exit 1
fi
# SpeechRecognition's bundled flac-mac is Intel-only; Apple Silicon needs a native encoder.
if ! command -v flac >/dev/null; then
  if command -v brew >/dev/null; then
    brew install flac
  else
    echo "Install the FLAC encoder (brew install flac); speech recognition needs it on Apple Silicon."
  fi
fi
npm --prefix frontend ci
.venv/bin/python scripts/doctor.py --dependencies-only
printf '\nInstallation complete. Start both services with: bash scripts/start-local.sh\n'
