import io
import importlib.util
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.settings import Settings, SettingsStore
from backend.commands import execute, ConfirmationRequired
from backend.launcher import launch, ActionError
from backend.web_actions import open_web
from backend.speech import transcribe


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_and_commands(self):
        self.assertEqual(self.client.get("/api/health").json()["status"], "ready")
        self.assertIn(
            "open safari", self.client.get("/api/commands").json()["commands"]
        )

    def test_validation(self):
        for body in (
            {"text": ""},
            {"text": "   "},
            {"text": "x" * 1001},
            {"text": "hi", "extra": 1},
        ):
            self.assertEqual(
                self.client.post("/api/command", json=body).status_code, 422
            )

    def test_phrases(self):
        for text in (
            "Hello NOVA",
            "What's today's date?",
            "What time is it?",
            "hey nova time",
        ):
            self.assertEqual(execute(text)["status"], "completed")

    def test_timer_returns_client_action_without_confirmation(self):
        result = execute("Set a timer for 2 minutes")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["action"], {"type": "timer", "target": "120"})

    def test_calculation_and_errors(self):
        self.assertIn("96", execute("calculate 12 times 8")["message"])
        self.assertEqual(execute("calculate 1/0")["status"], "error")

    def test_wikipedia_is_allowlisted(self):
        with patch("webbrowser.open", return_value=True) as browser:
            open_web("https://en.wikipedia.org/w/index.php?search=x", "x")
            browser.assert_called_once()

    def test_confirmation_and_no_execution(self):
        with patch("backend.commands.launch") as launcher:
            response = self.client.post(
                "/api/command", json={"text": "open calculator"}
            ).json()
            self.assertEqual(response["status"], "confirmation_required")
            launcher.assert_not_called()

    def test_confirmed_execution(self):
        with patch(
            "backend.commands.launch", return_value="Launched Calculator."
        ) as launcher:
            self.assertEqual(execute("open calculator", True)["status"], "completed")
            launcher.assert_called_once_with("calculator")

    def test_search_url(self):
        with patch("backend.commands.open_web", return_value="Opened") as opener:
            execute("search for Python & AI", True)
            self.assertEqual(
                opener.call_args.args[0],
                "https://www.google.com/search?q=python+%26+ai",
            )

    def test_application_failure(self):
        with patch("backend.commands.launch", side_effect=ActionError("Not installed")):
            response = self.client.post(
                "/api/command", json={"text": "open calculator", "confirmed": True}
            )
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"], "Not installed")

    def test_security(self):
        with self.assertRaises(ActionError):
            launch("calculator; touch /tmp/no")
        with self.assertRaises(ActionError):
            open_web("https://evil.test", "evil")
        self.assertEqual(execute("open rm -rf /", True)["status"], "error")
        self.assertEqual(
            self.client.post(
                "/api/command",
                json={"text": "hi"},
                headers={"Origin": "https://evil.test"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get("/api/health", headers={"Host": "evil.test"}).status_code,
            403,
        )

    def test_settings_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            with patch("backend.main.store", SettingsStore(path)):
                values = Settings(rate=1.4, theme="light").model_dump()
                self.assertEqual(
                    self.client.put("/api/settings", json=values).status_code, 200
                )
                self.assertEqual(self.client.get("/api/settings").json(), values)
                self.assertEqual(SettingsStore(path).get().rate, 1.4)
                self.assertEqual(
                    self.client.put(
                        "/api/settings", json={**values, "rate": 9}
                    ).status_code,
                    422,
                )

    def test_invalid_audio(self):
        self.assertEqual(
            self.client.post("/api/transcribe", content=b"invalid").status_code, 422
        )
        self.assertEqual(
            self.client.post(
                "/api/transcribe", content=b"0" * (4 * 1024 * 1024 + 1)
            ).status_code,
            413,
        )

    @unittest.skipUnless(
        importlib.util.find_spec("speech_recognition"),
        "SpeechRecognition unavailable; install requirements.txt",
    )
    def test_recognition_errors(self):
        import speech_recognition as sr

        audio = io.BytesIO()
        with wave.open(audio, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\0" * 32000)
        for exception in (sr.UnknownValueError(), sr.RequestError("offline")):
            with patch(
                "speech_recognition.Recognizer.recognize_google", side_effect=exception
            ):
                with self.assertRaises(ActionError):
                    transcribe(audio.getvalue())

    def test_unsupported_and_exit(self):
        self.assertEqual(execute("dance")["status"], "error")
        self.assertTrue(execute("goodbye")["ended"])


if __name__ == "__main__":
    unittest.main()
