"""Dashboard playback runs on the client, not on the server's audio output."""


def capabilities():
    return {
        "provider": "browser-speech-synthesis",
        "voices": [],
        "message": "Enumerate actual voices using speechSynthesis.getVoices() on the client. CLI retains pyttsx3.",
    }
