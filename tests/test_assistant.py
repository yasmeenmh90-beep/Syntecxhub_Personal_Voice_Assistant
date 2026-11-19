import unittest
from datetime import datetime
from assistant import handle_command


class AssistantTests(unittest.TestCase):
    def setUp(self):
        self.urls = []
        self.apps = []
        self.kw = dict(
            now=datetime(2026, 11, 12, 14, 30),
            app_launcher=lambda name: self.apps.append(name) or f"Opening {name}.",
            url_opener=lambda url, label: self.urls.append(url) or f"Opening {label}.",
        )

    def ask(self, text):
        return handle_command(text, **self.kw)

    def test_greeting(self):
        self.assertIn("Hello", self.ask("hello")[0])

    def test_time(self):
        self.assertIn("2:30 PM", self.ask("what time is it")[0])

    def test_date(self):
        self.assertIn("November 12, 2026", self.ask("what is the date")[0])

    def test_open_app(self):
        self.ask("open calculator")
        self.assertEqual(self.apps, ["calculator"])

    def test_open_site(self):
        self.ask("open github")
        self.assertEqual(self.urls, ["https://github.com"])

    def test_web_search_encodes_query(self):
        self.ask("search for Python & AI")
        self.assertIn("python+%26+ai", self.urls[0])

    def test_youtube_search(self):
        self.ask("search youtube for deep learning")
        self.assertIn("youtube.com/results", self.urls[0])

    def test_unknown(self):
        self.assertIn("don't recognize", self.ask("dance for me")[0])

    def test_exit(self):
        self.assertTrue(self.ask("exit")[1])

    def test_help(self):
        self.assertIn("open calculator", self.ask("help")[0])

    def test_wake_word(self):
        self.assertIn("2:30 PM", self.ask("hey nova what time is it")[0])

    def test_calculate_spoken(self):
        self.assertIn("equals 96", self.ask("calculate 12 times 8")[0])

    def test_calculate_symbols_and_precedence(self):
        self.assertIn("equals 14", self.ask("what is 2 + 3 * 4")[0])

    def test_percent_of(self):
        self.assertIn("equals 36", self.ask("what is 15 percent of 240")[0])

    def test_divide_by_zero(self):
        self.assertIn("divide by zero", self.ask("calculate 5 divided by 0")[0])

    def test_what_is_reports_math_errors(self):
        self.assertIn("divide by zero", self.ask("what is 5/0")[0])
        self.assertIn("don't recognize", self.ask("what is python 3")[0])

    def test_calculator_rejects_code(self):
        reply = self.ask("calculate __import__('os')")[0]
        self.assertTrue(reply.startswith("Sorry"))

    def test_huge_power_rejected(self):
        self.assertIn("too large", self.ask("calculate 9 to the power of 99999")[0])

    def test_joke_is_deterministic_with_rng(self):
        import random
        reply = handle_command("tell me a joke", rng=random.Random(1), **self.kw)[0]
        self.assertIn(reply, __import__("assistant").JOKES)

    def test_coin_and_dice(self):
        self.assertRegex(self.ask("flip a coin")[0], "heads|tails")
        self.assertRegex(self.ask("roll a dice")[0], r"rolled a [1-6]")

    def test_timer(self):
        started = []
        reply = handle_command(
            "set a timer for 5 minutes",
            timer_starter=lambda s: started.append(s) or "ok",
            **self.kw,
        )[0]
        self.assertEqual((started, reply), ([300], "ok"))

    def test_timer_word_number_and_limits(self):
        started = []
        handle_command("set a timer for ten seconds", timer_starter=started.append, **self.kw)
        self.assertEqual(started, [10])
        self.assertIn("between", self.ask("set a timer for 30 hours")[0])

    def test_wikipedia(self):
        self.ask("search wikipedia for black holes")
        self.assertIn("en.wikipedia.org", self.urls[0])
        self.assertIn("black+holes", self.urls[0])

    def test_play_on_youtube(self):
        self.ask("play lofi music on youtube")
        self.assertTrue(self.urls[0].endswith("search_query=lofi+music"))

    def test_weather(self):
        self.ask("weather in london")
        self.assertTrue(self.urls[0].endswith("weather+in+london"))

    def test_small_talk(self):
        self.assertIn("NOVA", self.ask("who are you")[0])
        self.assertIn("Thursday", self.ask("what day is it")[0])

    def test_forgiving_help_and_open(self):
        self.assertIn("open calculator", self.ask("help list everything")[0])
        self.ask("open calculator asks you to confirm first")
        self.ask("open the notes app")
        self.ask("open youtube please")
        self.assertEqual(self.apps, ["calculator", "notes"])
        self.assertEqual(self.urls, ["https://www.youtube.com"])
        self.assertFalse(self.ask("helpful tips")[0].startswith("Try these"))

    def test_no_arbitrary_app(self):
        self.ask("open arbitrary application")
        self.assertEqual(self.apps, [])


if __name__ == "__main__":
    unittest.main()
