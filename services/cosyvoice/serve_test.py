#!/usr/bin/env python3
"""Unit tests for the text prosody helpers in serve.py (no model needed)."""
import unittest

from serve import with_breaths


class WithBreathsTest(unittest.TestCase):
    def test_short_clauses_are_left_alone(self):
        text = "这款相机很轻，画质也不错。"
        self.assertEqual(with_breaths(text), text)

    def test_inserts_breath_after_a_long_clause(self):
        text = "这款相机非常轻便，适合旅行携带，它的画质表现出色。"
        out = with_breaths(text)
        self.assertIn("适合旅行携带，[breath]它的画质", out)
        self.assertEqual(out.count("[breath]"), 1)

    def test_never_inserts_at_sentence_end(self):
        text = "这是一款非常轻便而且画质表现出色的旅行相机。"
        self.assertNotIn("[breath]", with_breaths(text))

    def test_caps_at_two_breaths(self):
        text = "第一段内容足够长需要换气，第二段内容足够长需要换气，第三段内容足够长需要换气，第四段收尾。"
        self.assertEqual(with_breaths(text).count("[breath]"), 2)

    def test_idempotent_when_token_already_present(self):
        text = "这是一款非常轻便的相机，[breath]画质也很出色。"
        self.assertEqual(with_breaths(text), text)

    def test_empty_text(self):
        self.assertEqual(with_breaths(""), "")


if __name__ == "__main__":
    unittest.main()
