"""Report actual local dependencies, allowlisted apps, and live service status."""

import argparse
import importlib
import importlib.metadata
import platform
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.launcher import ActionError, find_macos_app, launch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependencies-only", action="store_true")
    parser.add_argument(
        "--microphones",
        action="store_true",
        help="Enumerate actual native PyAudio input devices; browser devices are checked in the dashboard.",
    )
    parser.add_argument(
        "--launch-apps",
        action="store_true",
        help="Actually request Calculator, Notes, and Safari launches on this Mac.",
    )
    args = parser.parse_args()
    failed = False
    print(f"Python: {platform.python_version()} ({sys.executable})")
    for module, distribution, required in (
        ("fastapi", "fastapi", True),
        ("uvicorn", "uvicorn", True),
        ("speech_recognition", "SpeechRecognition", True),
        ("httpx", "httpx", False),
        ("pytest", "pytest", False),
        ("pyaudio", "PyAudio", False),
        ("pyttsx3", "pyttsx3", False),
    ):
        try:
            importlib.import_module(module)
            print(f"OK {distribution}: {importlib.metadata.version(distribution)}")
        except Exception as error:
            print(
                f"{'MISSING REQUIRED' if required else 'UNAVAILABLE OPTIONAL'} {distribution}: {error}"
            )
            failed |= required
    if not args.dependencies_only:
        if platform.system() == "Darwin":
            for name in ("calculator", "notes", "safari"):
                try:
                    print(f"INSTALLED {name}: {find_macos_app(name)}")
                    if args.launch_apps:
                        print(f"LAUNCH {name}: {launch(name)}")
                except ActionError as error:
                    failed = True
                    print(f"APP ERROR {name}: {error}")
        opener = build_opener(ProxyHandler({}))
        for url in (
            "http://127.0.0.1:8000/api/health",
            "http://127.0.0.1:5173/api/health",
        ):
            try:
                with opener.open(url, timeout=3) as response:
                    data = json.load(response)
                if data.get("name") != "NOVA" or data.get("status") != "ready":
                    raise ValueError("Endpoint did not return NOVA readiness")
                print(f"HTTP OK {url}: {data}")
            except (OSError, URLError, ValueError) as error:
                failed = True
                print(f"HTTP UNVERIFIED {url}: {error}")
    if args.microphones:
        try:
            import pyaudio

            audio = pyaudio.PyAudio()
            try:
                inputs = [
                    audio.get_device_info_by_index(i)
                    for i in range(audio.get_device_count())
                    if audio.get_device_info_by_index(i)["maxInputChannels"] > 0
                ]
                if not inputs:
                    raise RuntimeError("No native audio input devices were reported")
                for device in inputs:
                    print(f"NATIVE INPUT {device['index']}: {device['name']}")
            finally:
                audio.terminate()
        except Exception as error:
            failed = True
            print(f"NATIVE MICROPHONE UNVERIFIED: {error}")
        print(
            "Device enumeration does not verify recording, OS permission, browser capture, transcription, or playback."
        )
    print(
        "Voice end-to-end verification requires the manual browser session in docs/VERIFICATION.md."
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
