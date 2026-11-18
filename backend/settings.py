import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    voice: str = Field(default="", max_length=300)
    rate: float = Field(default=1, ge=0.5, le=2)
    microphone: str = Field(default="", max_length=300)
    voice_response: bool = True
    theme: Literal["dark", "light"] = "dark"


class SettingsStore:
    def __init__(self, path=None):
        self.path = Path(
            path or os.environ.get("NOVA_SETTINGS_PATH", "data/settings.json")
        )
        self.lock = Lock()

    def get(self):
        with self.lock:
            return (
                Settings.model_validate_json(self.path.read_text())
                if self.path.exists()
                else Settings()
            )

    def save(self, settings):
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(dir=self.path.parent, prefix=".settings-")
            try:
                with os.fdopen(fd, "w") as file:
                    file.write(settings.model_dump_json(indent=2))
                os.replace(name, self.path)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
        return settings
