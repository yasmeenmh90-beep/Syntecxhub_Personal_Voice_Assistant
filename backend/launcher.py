"""Resolve only allowlisted applications; never interpolate speech into a shell."""

import platform
import plistlib
import subprocess
from pathlib import Path
from assistant import APPS


class ActionError(Exception):
    pass


# LaunchServices name lookup can fail even when a system app is installed.
# Paths and bundle identifiers are fixed, never supplied by a command request.
MAC_APPS = {
    "calculator": (
        "com.apple.calculator",
        ("/System/Applications/Calculator.app", "/Applications/Calculator.app"),
    ),
    "notes": (
        "com.apple.Notes",
        ("/System/Applications/Notes.app", "/Applications/Notes.app"),
    ),
    "safari": (
        "com.apple.Safari",
        (
            "/Applications/Safari.app",
            "/System/Cryptexes/App/System/Applications/Safari.app",
            "/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app",
        ),
    ),
    "terminal": (
        "com.apple.Terminal",
        (
            "/System/Applications/Utilities/Terminal.app",
            "/Applications/Utilities/Terminal.app",
        ),
    ),
}


def find_macos_app(name):
    if name not in MAC_APPS:
        raise ActionError("Application is not allowlisted.")
    identifier, candidates = MAC_APPS[name]
    for candidate in candidates:
        path = Path(candidate)
        try:
            with (path / "Contents/Info.plist").open("rb") as file:
                info = plistlib.load(file)
            if not isinstance(info, dict):
                continue
            executable = info.get("CFBundleExecutable", "")
            if (
                info.get("CFBundleIdentifier") == identifier
                and isinstance(executable, str)
                and executable
                and Path(executable).name == executable
                and (path / "Contents/MacOS" / executable).is_file()
            ):
                return path.resolve()
        except (OSError, ValueError, plistlib.InvalidFileException):
            continue
    raise ActionError(
        f"{name.title()} is unavailable: no valid installed app bundle was found in its allowlisted locations."
    )


def launch(name):
    if name not in APPS:
        raise ActionError("Application is not allowlisted.")
    system = platform.system()
    app = APPS[name].get(system)
    if not app:
        raise ActionError(f"{name.title()} is not supported on {system}.")
    try:
        if system == "Darwin":
            path = find_macos_app(name)
            result = subprocess.run(
                ["/usr/bin/open", "-a", str(path)],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if result.returncode:
                detail = result.stderr.strip() or f"exit status {result.returncode}"
                raise ActionError(
                    f"{app} is installed at {path}, but macOS rejected the launch: {detail}. "
                    "Check that the app opens in Finder, then retry NOVA from your own Mac Terminal."
                )
        else:
            subprocess.Popen([app])
    except (OSError, subprocess.SubprocessError) as exc:
        raise ActionError(f"Could not launch {app}: {exc}") from exc
    return f"The operating system accepted the request to launch {app}."
