import array
import io
import logging
import sys
import wave
from .launcher import ActionError

MAX_AUDIO = 4 * 1024 * 1024
# Peak below ~-46 dBFS means the microphone delivered (near) silence.
SILENCE_PEAK = 160
log = logging.getLogger("nova")


def peak_level(data):
    """Return the absolute peak of a mono 16-bit WAV recording."""
    with wave.open(io.BytesIO(data)) as wav:
        samples = array.array("h", wav.readframes(wav.getnframes()))
    if sys.byteorder == "big":
        samples.byteswap()
    return max((abs(x) for x in samples), default=0)


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
    peak = peak_level(data)
    log.info("Recording received: %d bytes, peak level %d / 32767", len(data), peak)
    if peak < SILENCE_PEAK:
        raise ActionError(
            "The recording was silent: your microphone sent no sound. Check the "
            "input device in Voice Studio (or macOS Sound settings) and watch "
            "the level bars move while you speak."
        )
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
    except OSError as exc:
        # SpeechRecognition shells out to a FLAC encoder; its bundled macOS
        # binary is Intel-only and fails on Apple Silicon without Rosetta.
        raise ActionError(
            "Audio encoder failed (FLAC). On macOS run: brew install flac, "
            f"then restart the backend. Detail: {exc.strerror or exc}"
        ) from exc
