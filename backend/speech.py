import io
import wave
from .launcher import ActionError

MAX_AUDIO = 4 * 1024 * 1024


def transcribe(data):
    if not data or len(data) > MAX_AUDIO:
        raise ActionError("Audio must be a nonempty WAV recording under 4 MB.")
    try:
        with wave.open(io.BytesIO(data)) as wav:
            if (
                wav.getnchannels() != 1
                or wav.getsampwidth() != 2
                or wav.getnframes() / wav.getframerate() > 20
            ):
                raise ActionError("Use mono 16-bit WAV audio, at most 20 seconds.")
    except (wave.Error, EOFError, ValueError) as exc:
        raise ActionError("Invalid WAV recording.") from exc
    try:
        import speech_recognition as sr
    except ImportError as exc:
        raise ActionError(
            "SpeechRecognition is not installed. Install requirements.txt and retry."
        ) from exc
    try:
        recognizer = sr.Recognizer()
        recognizer.operation_timeout = 12
        with sr.AudioFile(io.BytesIO(data)) as source:
            audio = recognizer.record(source)
        return recognizer.recognize_google(audio, language="en-US")
    except sr.UnknownValueError as exc:
        raise ActionError(
            "Speech was unclear or no speech was detected. Please retry."
        ) from exc
    except (TimeoutError, ConnectionError) as exc:
        raise ActionError("Recognition timed out. Check internet and retry.") from exc
    except sr.RequestError as exc:
        raise ActionError(
            "Recognition service unavailable. Check internet and retry."
        ) from exc
    except (wave.Error, EOFError, ValueError) as exc:
        raise ActionError("Invalid WAV recording.") from exc
