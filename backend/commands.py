import re
from assistant import handle_command, describe_duration, SAMPLES
from .launcher import launch
from .web_actions import open_web


class ConfirmationRequired(Exception):
    pass


def execute(text, confirmed=False):
    normalized = re.sub(r"\s+", " ", text.lower().strip()).rstrip("?.!")
    normalized = re.sub(r"^(?:(?:hey|hi) )?nova[, ]*", "", normalized)
    normalized = re.sub(r"^hello nova$", "hello", normalized)
    aliases = {
        "what's today's date": "date",
        "what is today's date": "date",
        "tell current time": "time",
        "tell today's date": "date",
    }
    normalized = aliases.get(normalized, normalized)
    action = None

    def app(name):
        nonlocal action
        if not confirmed:
            raise ConfirmationRequired(
                "Confirm to launch this application on the backend computer."
            )
        action = {"type": "application", "target": name}
        return launch(name)

    def web(url, label):
        nonlocal action
        if not confirmed:
            raise ConfirmationRequired(
                "Confirm to open this page in the backend computer’s browser."
            )
        action = {"type": "url", "target": url}
        return open_web(url, label)

    def timer(seconds):
        # Timers run in the dashboard (client side), so no OS action is needed.
        nonlocal action
        action = {"type": "timer", "target": str(seconds)}
        return f"Timer set for {describe_duration(seconds)}. I'll chime when it's done."

    if normalized == "open safari":
        reply, ended = app("safari"), False
    else:
        reply, ended = handle_command(
            normalized, app_launcher=app, url_opener=web, timer_starter=timer
        )
    unsupported = reply.startswith(("Sorry,", "I cannot", "I did not", "Please tell"))
    return {
        "status": "error" if unsupported else "completed",
        "message": reply,
        "ended": ended,
        "action": action,
    }
