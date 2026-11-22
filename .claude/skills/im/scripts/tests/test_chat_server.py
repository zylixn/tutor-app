#!/usr/bin/env python3
"""Tests for IM chat server. Requires server running at 192.168.5.116:9999."""

import json
import subprocess
import sys
import unittest

SERVER = "http://192.168.5.116:9999"


def curl(*args, method="GET", data=None):
    cmd = ["curl", "-s"]
    if method == "POST":
        cmd += ["-X", "POST", "-H", "Content-Type: application/json"]
        if data:
            cmd += ["-d", json.dumps(data, ensure_ascii=False)]
    cmd.append(args[0] if args else f"{SERVER}/online")
    for a in args[1:]:
        cmd.append(a)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    try:
        return r.returncode, json.loads(r.stdout)
    except json.JSONDecodeError:
        return r.returncode, r.stdout


def login(name):
    code, resp = curl(f"{SERVER}/login", method="POST", data={"from": name})
    return resp.get("token"), resp.get("user")


def logout(token):
    return curl(f"{SERVER}/logout", method="POST", data={"token": token})


def send(token, text, to=None):
    data = {"token": token, "text": text}
    if to:
        data["to"] = to
    return curl(f"{SERVER}/send", method="POST", data=data)


class TestLogin(unittest.TestCase):
    def test_login_returns_token(self):
        token, user = login(f"test-user-{id(self)}")
        self.assertIsNotNone(token)
        self.assertEqual(len(token), 32)
        self.assertIsNotNone(user)

    def test_login_replaces_old_token(self):
        name = f"test-replace-{id(self)}"
        t1, _ = login(name)
        t2, _ = login(name)
        self.assertNotEqual(t1, t2)
        # Old token should be invalid
        code, resp = send(t1, "should fail")
        self.assertIn("error", resp)


class TestSend(unittest.TestCase):
    def setUp(self):
        self.token, self.user = login(f"sender-{id(self)}")

    def test_send_broadcast(self):
        code, resp = send(self.token, "hello广播")
        self.assertTrue(resp.get("ok"))
        self.assertIn("id", resp)

    def test_send_dm(self):
        code, resp = send(self.token, "私聊消息", to="someone")
        self.assertTrue(resp.get("ok"))

    def test_send_no_text_rejected(self):
        code, resp = curl(f"{SERVER}/send", method="POST",
                          data={"token": self.token, "text": ""})
        self.assertIn("error", resp)

    def test_send_no_token_rejected(self):
        code, resp = curl(f"{SERVER}/send", method="POST",
                          data={"text": "no token"})
        self.assertIn("error", resp)


class TestLogout(unittest.TestCase):
    def test_logout_invalidates_token(self):
        token, _ = login(f"logout-test-{id(self)}")
        code, resp = logout(token)
        self.assertTrue(resp.get("ok"))

        # Token should be dead
        code, resp = send(token, "should block")
        self.assertIn("error", resp)

    def test_double_logout_no_error(self):
        token, _ = login(f"double-logout-{id(self)}")
        logout(token)
        code, resp = logout(token)
        self.assertTrue(resp.get("ok"))


class TestPrivacy(unittest.TestCase):
    def test_broadcast_visible_to_all(self):
        t_a, u_a = login(f"priv-a-{id(self)}")
        t_b, u_b = login(f"priv-b-{id(self)}")
        t_c, u_c = login(f"priv-c-{id(self)}")

        send(t_a, "broadcast-visible")

        # All three should see it
        for t in [t_a, t_b, t_c]:
            code, resp = curl(f"{SERVER}/history?limit=5&token={t}")
            texts = [m["text"] for m in resp.get("messages", [])]
            self.assertIn("broadcast-visible", texts, f"user with token {t[:8]} can't see broadcast")

    def test_dm_only_visible_to_sender_receiver(self):
        t_a, u_a = login(f"dm-a-{id(self)}")
        t_b, u_b = login(f"dm-b-{id(self)}")
        t_c, u_c = login(f"dm-c-{id(self)}")

        send(t_a, "secret-dm", to=u_b)

        # A (sender) sees it
        code, resp = curl(f"{SERVER}/history?limit=5&token={t_a}")
        texts_a = [m["text"] for m in resp.get("messages", [])]
        self.assertIn("secret-dm", texts_a)

        # B (receiver) sees it
        code, resp = curl(f"{SERVER}/history?limit=5&token={t_b}")
        texts_b = [m["text"] for m in resp.get("messages", [])]
        self.assertIn("secret-dm", texts_b)

        # C (outsider) does NOT
        code, resp = curl(f"{SERVER}/history?limit=5&token={t_c}")
        texts_c = [m["text"] for m in resp.get("messages", [])]
        self.assertNotIn("secret-dm", texts_c)

    def test_no_user_param_hides_dm(self):
        t_a, u_a = login(f"nouser-a-{id(self)}")
        send(t_a, "hidden-dm", to="ghost")

        code, resp = curl(f"{SERVER}/history?limit=5")
        texts = [m["text"] for m in resp.get("messages", [])]
        self.assertNotIn("hidden-dm", texts)


class TestPoll(unittest.TestCase):
    def test_poll_returns_new_messages(self):
        t, u = login(f"poll-{id(self)}")

        # Poll from 1s ago to avoid clock skew
        import time
        since = time.time() - 1
        send(t, "poll-test-msg")

        code, resp = curl(f"{SERVER}/poll?since={since}&token={t}")
        msgs = resp.get("messages", [])
        texts = [m["text"] for m in msgs]
        self.assertIn("poll-test-msg", texts)

    def test_poll_respects_privacy(self):
        t_a, u_a = login(f"poll-priv-a-{id(self)}")
        t_b, u_b = login(f"poll-priv-b-{id(self)}")

        import time
        since = time.time() - 1
        send(t_a, "poll-secret", to=u_b)

        # Outsider poll should not see DM
        t_c, u_c = login(f"poll-priv-c-{id(self)}")
        code, resp = curl(f"{SERVER}/poll?since={since}&token={t_c}")
        texts = [m["text"] for m in resp.get("messages", [])]
        self.assertNotIn("poll-secret", texts)


class TestOnline(unittest.TestCase):
    def test_online_shows_active_users(self):
        token, user = login(f"online-{id(self)}")
        code, resp = curl(f"{SERVER}/online")
        self.assertIn(user, resp.get("users", []))
        self.assertGreater(resp.get("count", 0), 0)


class TestHistory(unittest.TestCase):
    def test_history_with_limit(self):
        t, u = login(f"hist-{id(self)}")
        send(t, "msg1")
        send(t, "msg2")
        send(t, "msg3")

        code, resp = curl(f"{SERVER}/history?limit=2&token={t}")
        msgs = resp.get("messages", [])
        self.assertLessEqual(len(msgs), 2)

    def test_history_respects_privacy(self):
        t_a, u_a = login(f"hist-priv-a-{id(self)}")
        send(t_a, "hist-secret", to="nobody")

        t_b, u_b = login(f"hist-priv-b-{id(self)}")
        code, resp = curl(f"{SERVER}/history?limit=10&token={t_b}")
        texts = [m["text"] for m in resp.get("messages", [])]
        self.assertNotIn("hist-secret", texts)


class TestBackwardCompat(unittest.TestCase):
    def test_send_with_from_field_still_works(self):
        # Use requests via curl subprocess
        import time
        name = f"compat-{int(time.time())}-{id(self)}"
        code, resp = curl(f"{SERVER}/send", method="POST",
                          data={"from": name, "text": "old style", "to": ""})
        if isinstance(resp, dict):
            self.assertTrue(resp.get("ok") or "error" not in str(resp))
        else:
            # May be string if server returned non-JSON
            self.skipTest(f"unexpected response: {resp[:100]}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
