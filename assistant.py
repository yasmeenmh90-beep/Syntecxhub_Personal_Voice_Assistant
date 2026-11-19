"""NOVA: rule-based personal voice assistant for macOS, Windows and Linux."""

import argparse
import ast
from datetime import datetime
import operator
import random
import re
import threading
import webbrowser
from urllib.parse import quote_plus

SAMPLES = [
    "hello",
    "what time is it",
    "what is the date",
    "open calculator",
    "open notes",
    "open browser",
    "open youtube",
    "open github",
    "search for Python tutorials",
    "search youtube for machine learning",
    "play lofi music on youtube",
    "search wikipedia for black holes",
    "weather in London",
    "calculate 12 times 8",
    "what is 15 percent of 240",
    "set a timer for 5 minutes",
    "tell me a joke",
    "flip a coin",
    "roll a dice",
    "who are you",
    "help",
    "exit",
]

APPS = {
    "safari": {"Darwin": "Safari"},
    "calculator": {
        "Darwin": "Calculator",
        "Windows": "calc.exe",
        "Linux": "gnome-calculator",
    },
    "notes": {"Darwin": "Notes", "Windows": "notepad.exe", "Linux": "gedit"},
    "terminal": {
        "Darwin": "Terminal",
        "Windows": "cmd.exe",
        "Linux": "x-terminal-emulator",
    },
}


def launch_app(name):
    # Keep the CLI and dashboard on the same secure, bundle-aware launcher.
    from backend.launcher import ActionError, launch

    try:
        return launch(name)
    except ActionError as exc:
        return str(exc)


def open_url(url, label):
    try:
        if not webbrowser.open(url):
            return f"Could not open {label}. Please check your browser."
        return f"Opening {label}."
    except Exception as exc:
        return f"Could not open {label}: {exc}"


JOKES = [
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "I told my computer I needed a break, and it said: no problem, I'll go to sleep.",
    "Why did the developer go broke? Because they used up all their cache.",
    "There are 10 kinds of people: those who understand binary and those who don't.",
    "Why was the JavaScript developer sad? Because they didn't know how to null their feelings.",
    "A SQL query walks into a bar, walks up to two tables and asks: can I join you?",
    "Why do Python programmers wear glasses? Because they can't C.",
    "I would tell you a UDP joke, but you might not get it.",
]

SPOKEN_OPERATORS = [
    (r"\bmultiplied by\b", "*"),
    (r"\btimes\b", "*"),
    (r"\bx\b", "*"),
    (r"\bdivided by\b", "/"),
    (r"\bover\b", "/"),
    (r"\bplus\b", "+"),
    (r"\bminus\b", "-"),
    (r"\bto the power of\b", "**"),
    (r"\bsquared\b", "**2"),
    (r"\bcubed\b", "**3"),
    (r"\bmod(?:ulo)?\b", "%"),
]
_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


class CalculationError(ValueError):
    pass


NOT_ARITHMETIC = "Not an arithmetic expression."


def _eval_node(node):
    """Evaluate a whitelisted arithmetic AST; never calls eval()."""
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _eval_node(node.left), _eval_node(node.right)
        if isinstance(node.op, ast.Pow) and (abs(right) > 100 or abs(left) > 1e6):
            raise CalculationError("That power is too large.")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_eval_node(node.operand))
    raise CalculationError("Unsupported expression.")


def calculate(expression):
    """Turn spoken or typed arithmetic into a number. Raises CalculationError."""
    text = expression.lower().replace(",", "").strip()
    percent = re.fullmatch(r"([\d.]+)\s*(?:percent|%)\s*of\s*([\d.]+)", text)
    if percent:
        text = f"{percent[1]}/100*{percent[2]}"
    text = re.sub(r"(?<=\d)\s*%", "/100", text)
    for pattern, symbol in SPOKEN_OPERATORS:
        text = re.sub(pattern, symbol, text)
    text = text.replace("×", "*").replace("÷", "/").replace("^", "**")
    if not text or len(text) > 120 or not re.fullmatch(r"[\d\s.+\-*/%()]+", text):
        raise CalculationError(NOT_ARITHMETIC)
    try:
        value = _eval_node(ast.parse(text, mode="eval"))
    except ZeroDivisionError as exc:
        raise CalculationError("I cannot divide by zero.") from exc
    except (SyntaxError, OverflowError, RecursionError) as exc:
        raise CalculationError(NOT_ARITHMETIC) from exc
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise CalculationError("The result is not a finite number.")
        value = round(value, 6)
        if value.is_integer():
            value = int(value)
    return value


def format_number(value):
    return f"{value:,}" if isinstance(value, int) else f"{value:,.6g}"


TIMER_UNITS = {"second": 1, "sec": 1, "minute": 60, "min": 60, "hour": 3600}
WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fifteen": 15,
    "twenty": 20, "thirty": 30, "forty five": 45, "sixty": 60,
}  # fmt: skip


def parse_timer(text):
    """Return timer seconds for 'set a timer for 5 minutes', else None."""
    match = re.fullmatch(
        r"(?:set (?:a |an )?timer for|timer for|start (?:a |an )?timer for|"
        r"remind me in) (.+?) (second|sec|minute|min|hour)s?",
        text,
    )
    if not match:
        return None
    amount = match[1].strip()
    number = WORD_NUMBERS.get(amount)
    if number is None:
        try:
            number = float(amount)
        except ValueError:
            return None
    seconds = int(number * TIMER_UNITS[match[2]])
    return seconds if 0 < seconds <= 24 * 3600 else -1


def describe_duration(seconds):
    parts = []
    for name, size in (("hour", 3600), ("minute", 60), ("second", 1)):
        count, seconds = divmod(seconds, size)
        if count:
            parts.append(f"{count} {name}{'s' if count != 1 else ''}")
    return " and ".join(parts)


def start_timer(seconds):
    """CLI timer: announce in the terminal when time is up."""
    timer = threading.Timer(
        seconds, lambda: print(f"\n⏰ NOVA: Your timer for {describe_duration(seconds)} is done!")
    )
    timer.daemon = True
    timer.start()
    return f"Timer set for {describe_duration(seconds)}. I'll let you know when it's done."


def handle_command(
    command,
    now=None,
    app_launcher=launch_app,
    url_opener=open_url,
    timer_starter=start_timer,
    rng=random,
):
    """Map a recognized command to a safe, predefined action and reply."""
    text = re.sub(r"\s+", " ", command.lower().strip())
    text = re.sub(r"^(hey |hi )?nova[, ]*", "", text).strip()
    text = text.rstrip("?.!")
    if text == "hello nova":
        text = "hello"
    if text in ("what's today's date", "what is today's date"):
        text = "date"
    current = now or datetime.now()
    if not text:
        return "I did not hear a command. Please try again.", False
    if text in ("exit", "quit", "goodbye", "stop", "stop assistant"):
        return "Goodbye! Have a great day.", True
    if (
        text in ("commands", "what can you do", "show commands", "list commands")
        or re.match(r"(?:help|list everything|show (?:me )?everything)\b", text)
    ):
        return "Try these commands: " + "; ".join(SAMPLES), False
    if text in ("hello", "hi", "hey", "good morning", "good evening"):
        return "Hello! I am NOVA, your personal voice assistant. How can I help?", False
    if (
        text in ("time", "tell me the time", "what time is it", "current time")
        or "what is the time" in text
    ):
        return "The time is " + current.strftime("%I:%M %p").lstrip("0") + ".", False
    if text in (
        "date",
        "today",
        "what is the date",
        "what's the date",
        "today's date",
        "tell me the date",
    ):
        return "Today is " + current.strftime("%A, %B %d, %Y") + ".", False
    if text in ("who are you", "what is your name", "what's your name", "introduce yourself"):
        return (
            "I am NOVA, a rule-based personal voice assistant. I run locally, "
            "open apps, search the web, do quick maths, set timers and tell the time.",
            False,
        )
    if text in ("how are you", "how are you doing", "how's it going"):
        return "I'm running smoothly and ready to help. What can I do for you?", False
    if text in ("thank you", "thanks", "thanks nova", "thank you nova"):
        return "You're welcome! Anything else?", False
    if text in ("what day is it", "what day is today", "which day is it"):
        return "It's " + current.strftime("%A") + ".", False
    if text in ("tell me a joke", "joke", "tell a joke", "make me laugh", "say something funny"):
        return rng.choice(JOKES), False
    if text in ("flip a coin", "toss a coin", "coin flip", "heads or tails"):
        return "It's " + rng.choice(["heads", "tails"]) + "!", False
    if text in ("roll a dice", "roll a die", "roll dice", "roll the dice"):
        return f"You rolled a {rng.randint(1, 6)}.", False
    seconds = parse_timer(text)
    if seconds == -1:
        return "Sorry, timers must be between 1 second and 24 hours.", False
    if seconds:
        return timer_starter(seconds), False
    if text.startswith(("timer", "set a timer", "set timer")):
        return "Please tell me how long, for example: set a timer for 5 minutes.", False
    math = re.fullmatch(r"(?:calculate|compute|what is|what's|how much is) (.+)", text)
    if math and re.search(r"\d", math[1]):
        try:
            return f"{math[1]} equals {format_number(calculate(math[1]))}.", False
        except CalculationError as exc:
            # Report genuine maths errors (divide by zero, huge powers) for any
            # phrasing; non-arithmetic "what is ..." questions fall through.
            if text.startswith(("calculate", "compute")) or str(exc) != NOT_ARITHMETIC:
                return f"Sorry, I could not calculate that. {exc}", False
    weather = re.fullmatch(r"(?:what's the |what is the |how's the )?weather(?: like)?(?: in (.+?))?(?: today)?", text)
    if weather:
        place = (weather[1] or "").strip()
        query = "weather in " + place if place else "weather today"
        return (
            url_opener(
                "https://www.google.com/search?q=" + quote_plus(query),
                "the forecast" + (" for " + place if place else ""),
            ),
            False,
        )
    for prefix in ("search wikipedia for ", "wikipedia ", "who is ", "what is a ", "tell me about "):
        if text.startswith(prefix):
            query = text[len(prefix) :].strip()
            if not query:
                return "Please tell me what to search for.", False
            return (
                url_opener(
                    "https://en.wikipedia.org/w/index.php?search=" + quote_plus(query),
                    "Wikipedia article on " + query,
                ),
                False,
            )
    play = re.fullmatch(r"play (.+?)(?: on youtube)?", text)
    if play:
        return (
            url_opener(
                "https://www.youtube.com/results?search_query=" + quote_plus(play[1]),
                "YouTube results for " + play[1],
            ),
            False,
        )
    if text.startswith("search youtube for "):
        query = text[len("search youtube for ") :].strip()
        if not query:
            return "Please tell me what to search for.", False
        return (
            url_opener(
                "https://www.youtube.com/results?search_query=" + quote_plus(query),
                "YouTube search for " + query,
            ),
            False,
        )
    for prefix in ("search for ", "search web for ", "google ", "search google for "):
        if text.startswith(prefix):
            query = text[len(prefix) :].strip()
            if not query:
                return "Please tell me what to search for.", False
            return (
                url_opener(
                    "https://www.google.com/search?q=" + quote_plus(query),
                    "Google search for " + query,
                ),
                False,
            )
    if text.startswith("open "):
        target = re.sub(r"^(?:the |my |up )", "", text[5:].strip())
        websites = {
            "youtube": "https://www.youtube.com",
            "github": "https://github.com",
            "google": "https://www.google.com",
            "browser": "https://www.google.com",
            "safari": "https://www.google.com",
            "wikipedia": "https://en.wikipedia.org",
            "maps": "https://www.google.com/maps",
            "google maps": "https://www.google.com/maps",
        }
        # Accept trailing words ("open calculator please", "open notes app"),
        # but only ever resolve to a name on the fixed allowlists.
        for name in sorted([*APPS, *websites], key=len, reverse=True):
            if target == name or target.startswith(name + " "):
                if name in APPS:
                    return app_launcher(name), False
                return url_opener(websites[name], name), False
        return f"I cannot open {target}. Say help for supported apps and sites.", False
    return "Sorry, I don't recognize that command. Say help to hear examples.", False


class Speaker:
    def __init__(self, enabled=True):
        self.engine = None
        if enabled:
            try:
                import pyttsx3

                self.engine = pyttsx3.init()
                self.engine.setProperty("rate", 165)
            except Exception as exc:
                print(f"[Voice unavailable: {exc}] Continuing in text mode.")

    def say(self, message):
        print("NOVA:", message)
        if self.engine:
            try:
                self.engine.say(message)
                self.engine.runAndWait()
            except Exception as exc:
                print(f"[Speech output failed: {exc}]")
                self.engine = None


def listen(recognizer, microphone):
    import speech_recognition as sr

    try:
        with microphone as source:
            print("Listening...")
            recognizer.adjust_for_ambient_noise(source, duration=0.5)
            audio = recognizer.listen(source, timeout=5, phrase_time_limit=8)
        return recognizer.recognize_google(audio, language="en-US")
    except sr.WaitTimeoutError:
        print("[No speech detected. Please try again.]")
    except sr.UnknownValueError:
        print("[Speech was unclear. Please repeat.]")
    except sr.RequestError as exc:
        print(f"[Speech service unavailable: {exc}. Check internet.]")
    except (OSError, AttributeError) as exc:
        print(f"[Microphone error: {exc}]")
    return None


def main():
    parser = argparse.ArgumentParser(description="NOVA Personal Voice Assistant")
    parser.add_argument(
        "--text", action="store_true", help="Use typed commands instead of microphone"
    )
    parser.add_argument("--mute", action="store_true", help="Disable spoken responses")
    args = parser.parse_args()
    speaker = Speaker(enabled=not args.mute)
    recognizer = microphone = None
    text_mode = args.text
    if not text_mode:
        try:
            import speech_recognition as sr

            recognizer = sr.Recognizer()
            microphone = sr.Microphone()
        except (ImportError, OSError, AttributeError) as exc:
            print(f"Microphone setup unavailable: {exc}. Switching to text mode.")
            text_mode = True
    speaker.say("Welcome to NOVA. Say help for commands or exit to quit.")
    print("Mode:", "TEXT" if text_mode else "VOICE", "| Ctrl+C to quit")
    try:
        while True:
            if text_mode:
                try:
                    command = input("You: ")
                except EOFError:
                    break
            else:
                command = listen(recognizer, microphone)
                if command is None:
                    continue
                print("You:", command)
            response, should_exit = handle_command(command)
            speaker.say(response)
            if should_exit:
                break
    except KeyboardInterrupt:
        print("\nNOVA: Goodbye!")


if __name__ == "__main__":
    main()
