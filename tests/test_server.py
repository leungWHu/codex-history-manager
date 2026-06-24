import json
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path

from server import CodexPurger, PurgeError, SessionStore, is_temporary_workspace, parse_session, repair_legacy_text


class SessionParserTests(unittest.TestCase):
    def test_recognizes_codex_managed_temporary_workspaces(self):
        home = Path("C:/Users/demo")
        self.assertTrue(is_temporary_workspace("C:/Users/demo/Documents/Codex/2026-06-21/new-chat", home))
        self.assertTrue(is_temporary_workspace("", home))
        self.assertFalse(is_temporary_workspace("C:/Users/demo/Desktop/my-project", home))
        self.assertFalse(is_temporary_workspace("C:/Users/demo/Documents/New project temp", home))

    def test_recognizes_linux_codex_managed_temporary_workspaces(self):
        home = Path("/home/demo")
        self.assertTrue(is_temporary_workspace("/home/demo/Documents/Codex/2026-06-21/new-chat", home))
        self.assertTrue(is_temporary_workspace("/home/demo/Documents/Codex", home))
        self.assertFalse(is_temporary_workspace("/home/demo/projects/my-project", home))

    def test_repairs_legacy_gbk_paths(self):
        broken = "D:\\01 " + "科研目录".encode("gbk").decode("latin-1")
        self.assertEqual(repair_legacy_text(broken), "D:\\01 科研目录")
        self.assertEqual(repair_legacy_text("C:\\Users\\demo"), "C:\\Users\\demo")

    def test_reads_only_visible_messages_and_skips_bad_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout-00000000-0000-0000-0000-000000000001.jsonl"
            events = [
                {"timestamp": "2026-01-01T00:00:00Z", "type": "session_meta", "payload": {"id": "00000000-0000-0000-0000-000000000001", "cwd": "C:/demo"}},
                {"timestamp": "2026-01-01T00:00:00Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "<environment_context>\n<cwd>C:/demo</cwd>\n</environment_context>"}]}},
                {"timestamp": "2026-01-01T00:00:01Z", "type": "response_item", "payload": {"type": "message", "role": "developer", "content": [{"type": "input_text", "text": "secret"}]}},
                {"timestamp": "2026-01-01T00:00:02Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [
                    {"type": "input_text", "text": "# AGENTS.md instructions for C:/demo\n<INSTRUCTIONS>hidden</INSTRUCTIONS>"},
                    {"type": "input_text", "text": "<environment_context>hidden</environment_context>"},
                    {"type": "input_text", "text": "你好"},
                ]}},
                {"timestamp": "2026-01-01T00:00:03Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "你好！"}]}},
                {"timestamp": "2026-01-01T00:00:04Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "phase": "final_answer", "content": [{"type": "output_text", "text": "正式完成"}]}},
                {"timestamp": "2026-01-01T00:00:05Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "旧版回复"}]}},
            ]
            path.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in events) + "\n{broken", encoding="utf-8")
            result = parse_session(path)
            self.assertEqual([m["text"] for m in result["messages"]], ["你好", "你好！", "正式完成", "旧版回复"])
            self.assertEqual(result["messages"][1]["kind"], "progress")
            self.assertEqual(result["messages"][2]["kind"], "final")
            self.assertEqual(result["messages"][3]["kind"], "legacy")
            self.assertEqual(result["cwd"], "C:/demo")

    def test_store_uses_index_title(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            folder = home / "sessions" / "2026" / "01" / "01"
            folder.mkdir(parents=True)
            session_id = "00000000-0000-0000-0000-000000000001"
            events = [
                {"timestamp": "2026-01-01T00:00:00Z", "type": "session_meta", "payload": {"id": session_id}},
                {"timestamp": "2026-01-01T00:00:01Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "真实问题"}]}},
            ]
            (folder / f"rollout-{session_id}.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in events), encoding="utf-8")
            (home / "session_index.jsonl").write_text(json.dumps({"id": session_id, "thread_name": "测试标题", "updated_at": "2026-01-02T00:00:00Z"}), encoding="utf-8")
            self.assertEqual(SessionStore(home).list()[0]["title"], "测试标题")

    def test_store_deletes_only_matching_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            folder = home / "sessions" / "2026" / "01" / "01"
            folder.mkdir(parents=True)
            session_id = "00000000-0000-0000-0000-000000000001"
            session_file = folder / f"rollout-{session_id}.jsonl"
            session_file.write_text("{}", encoding="utf-8")
            session_file.chmod(stat.S_IREAD)
            self.assertTrue(SessionStore(home).delete(session_id))
            self.assertFalse(session_file.exists())
            self.assertFalse(SessionStore(home).delete("../../other"))

    def test_store_hides_internal_assessment_thread(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            folder = home / "sessions"
            folder.mkdir()
            session_id = "00000000-0000-0000-0000-000000000001"
            events = [
                {"timestamp": "2026-01-01T00:00:00Z", "type": "session_meta", "payload": {"id": session_id, "thread_source": "subagent", "source": {"subagent": {"other": "guardian"}}}},
                {"timestamp": "2026-01-01T00:00:01Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "<environment_context>test</environment_context>"}]}},
                {"timestamp": "2026-01-01T00:00:02Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "The following is Codex agent history added since your last approval assessment."}]}},
                {"timestamp": "2026-01-01T00:00:03Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "{\"outcome\":\"allow\"}"}]}},
            ]
            (folder / f"rollout-{session_id}.jsonl").write_text("\n".join(json.dumps(x) for x in events), encoding="utf-8")
            self.assertEqual(SessionStore(home).list(), [])

    def test_complete_purge_removes_supported_codex_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            session_id = "00000000-0000-0000-0000-000000000001"
            keep_id = "00000000-0000-0000-0000-000000000002"
            folder = home / "sessions" / "2026" / "01" / "01"
            folder.mkdir(parents=True)
            rollout = folder / f"rollout-{session_id}.jsonl"
            rollout.write_text("{}\n", encoding="utf-8")

            state = sqlite3.connect(home / "state_5.sqlite")
            state.executescript("""
                create table threads (
                    id text primary key, title text, rollout_path text, created_at integer,
                    updated_at integer, cwd text, archived integer
                );
                create table thread_dynamic_tools (thread_id text, name text);
                create table stage1_outputs (thread_id text, value text);
                create table thread_spawn_edges (parent_thread_id text, child_thread_id text);
                create table agent_job_items (assigned_thread_id text);
            """)
            state.execute("insert into threads values (?,?,?,?,?,?,?)", (session_id, "Delete", str(rollout), 1, 2, "C:/demo", 0))
            state.execute("insert into thread_dynamic_tools values (?,?)", (session_id, "tool"))
            state.execute("insert into stage1_outputs values (?,?)", (session_id, "value"))
            state.execute("insert into thread_spawn_edges values (?,?)", (session_id, keep_id))
            state.execute("insert into agent_job_items values (?)", (session_id,))
            state.commit()
            state.close()

            logs = sqlite3.connect(home / "logs_2.sqlite")
            logs.execute("create table logs (id integer primary key, thread_id text)")
            logs.execute("insert into logs(thread_id) values (?)", (session_id,))
            logs.commit()
            logs.close()
            goals = sqlite3.connect(home / "goals_1.sqlite")
            goals.execute("create table thread_goals (thread_id text, goal text)")
            goals.execute("insert into thread_goals values (?,?)", (session_id, "goal"))
            goals.commit()
            goals.close()

            (home / "session_index.jsonl").write_text(
                json.dumps({"id": session_id}) + "\n" + json.dumps({"id": keep_id}) + "\n", encoding="utf-8"
            )
            global_value = {"drafts": {f"local:{session_id}": "text", "keep": "yes"}, "threads": [session_id, keep_id]}
            for name in (".codex-global-state.json", ".codex-global-state.json.bak"):
                (home / name).write_text(json.dumps(global_value), encoding="utf-8")
            snapshots = home / "shell_snapshots"
            snapshots.mkdir()
            snapshot = snapshots / f"{session_id}.abc.sh"
            snapshot.write_text("echo test", encoding="utf-8")

            purger = CodexPurger(home)
            plan = purger.plan(session_id)
            self.assertEqual(plan["short_id"], session_id[:8])
            self.assertGreaterEqual(plan["sqlite_rows_total"], 6)
            with self.assertRaises(PurgeError):
                purger.purge(session_id, "wrong")
            self.assertTrue(rollout.exists())

            batch_plan = purger.batch_plan([session_id, session_id])
            self.assertEqual(batch_plan["sessions"], 1)
            with self.assertRaises(PurgeError):
                purger.purge_batch([session_id], "wrong")
            self.assertTrue(rollout.exists())

            report = purger.purge_batch([session_id], "purge-selected")
            self.assertTrue(report["deleted"])
            self.assertEqual(report["sessions_deleted"], 1)
            self.assertFalse(rollout.exists())
            self.assertFalse(snapshot.exists())
            self.assertNotIn(session_id, (home / "session_index.jsonl").read_text(encoding="utf-8"))
            self.assertNotIn(session_id, (home / ".codex-global-state.json").read_text(encoding="utf-8"))
            check = sqlite3.connect(home / "state_5.sqlite")
            self.assertEqual(check.execute("select count(*) from threads where id=?", (session_id,)).fetchone()[0], 0)
            self.assertIsNone(check.execute("select assigned_thread_id from agent_job_items").fetchone()[0])
            check.close()


if __name__ == "__main__":
    unittest.main()
