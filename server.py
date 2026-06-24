from __future__ import annotations

import argparse
import errno
import json
import os
import re
import sqlite3
import stat
import tempfile
import time
from contextlib import closing
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
DEFAULT_CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
API_VERSION = 2
SESSION_ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f-]{27,}", re.I)
LEGACY_MOJIBAKE_MARKERS = frozenset("¿ÆÑÄÂ¼´×¤µ±¨²ÁÏÔÐÐ")
INTERNAL_USER_PREFIXES = (
    "<environment_context>",
    "# AGENTS.md instructions for ",
    "<permissions instructions>",
    "<app-context>",
    "<collaboration_mode>",
    "<apps_instructions>",
    "<skills_instructions>",
    "<plugins_instructions>",
    "<personality_spec>",
    "The following is the Codex agent history",
    "The following is Codex agent history",
)
ASSESSMENT_PREFIXES = (
    "The following is the Codex agent history",
    "The following is Codex agent history",
)


def repair_legacy_text(value: str) -> str:
    """Repair old GBK text that was accidentally decoded as Latin-1."""
    if not value or not any(char in LEGACY_MOJIBAKE_MARKERS for char in value):
        return value
    try:
        repaired = value.encode("latin-1").decode("gbk")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    return repaired if repaired else value


def read_json_lines(path: Path) -> Iterable[dict[str, Any]]:
    """Yield valid JSON objects, tolerating partially-written/corrupt lines."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as stream:
            for line in stream:
                try:
                    value = json.loads(line)
                    if isinstance(value, dict):
                        yield value
                except (json.JSONDecodeError, UnicodeError):
                    continue
    except OSError:
        return


def load_titles(codex_home: Path) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for item in read_json_lines(codex_home / "session_index.jsonl"):
        session_id = str(item.get("id", ""))
        if session_id:
            result[session_id] = {
                "title": str(item.get("thread_name") or item.get("title") or ""),
                "updated_at": str(item.get("updated_at") or ""),
            }
    return result


def extract_text(content: Any, exclude_internal: bool = False) -> str:
    if isinstance(content, str):
        if exclude_internal and is_internal_user_message(content):
            return ""
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") in {"input_text", "output_text", "text"}:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                if exclude_internal and is_internal_user_message(text):
                    continue
                parts.append(text.strip())
    return "\n\n".join(parts)


def is_internal_user_message(text: str) -> bool:
    """Identify Codex-injected user-role records that are not user messages."""
    stripped = text.lstrip()
    return any(stripped.startswith(prefix) for prefix in INTERNAL_USER_PREFIXES)


def is_assessment_payload(content: Any) -> bool:
    if not isinstance(content, list):
        return False
    for part in content:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and any(text.lstrip().startswith(prefix) for prefix in ASSESSMENT_PREFIXES):
            return True
    return False


def is_temporary_workspace(cwd: str, home: Path | None = None) -> bool:
    """Recognize workspaces Codex creates when the user did not choose a project."""
    if not cwd:
        return True

    def normalize(value: Path | str) -> str:
        text = str(value).strip().replace("\\", "/").rstrip("/")
        return text.casefold()

    user_home = normalize(home or Path.home())
    normalized = normalize(cwd)
    managed_root = f"{user_home}/documents/codex"
    return normalized == user_home or normalized == managed_root or normalized.startswith(managed_root + "/")


def parse_session(path: Path, include_messages: bool = True) -> dict[str, Any]:
    session_id = ""
    cwd = ""
    thread_source = ""
    session_source: Any = ""
    created_at = ""
    updated_at = ""
    messages: list[dict[str, str]] = []

    for event in read_json_lines(path):
        timestamp = str(event.get("timestamp") or "")
        created_at = created_at or timestamp
        updated_at = timestamp or updated_at
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if event.get("type") == "session_meta":
            session_id = str(payload.get("id") or session_id)
            cwd = repair_legacy_text(str(payload.get("cwd") or cwd))
            thread_source = str(payload.get("thread_source") or thread_source)
            session_source = payload.get("source") or session_source
        if not include_messages or event.get("type") != "response_item":
            continue
        if payload.get("type") != "message" or payload.get("role") not in {"user", "assistant"}:
            continue
        role = str(payload["role"])
        content = payload.get("content")
        if role == "user" and is_assessment_payload(content):
            continue
        text = extract_text(content, exclude_internal=role == "user")
        if not text:
            continue
        phase = str(payload.get("phase") or "")
        if role == "assistant" and phase == "commentary":
            kind = "progress"
        elif role == "assistant" and phase == "final_answer":
            kind = "final"
        elif role == "assistant":
            kind = "legacy"
        else:
            kind = "user"
        message = {
            "role": role,
            "text": text,
            "timestamp": timestamp,
            "kind": kind,
            "phase": phase,
        }
        # Some Codex versions record the same message twice in adjacent events.
        if not messages or (messages[-1]["role"], messages[-1]["text"]) != (message["role"], message["text"]):
            messages.append(message)

    if not session_id:
        match = SESSION_ID_RE.search(path.stem)
        session_id = match.group(0) if match else path.stem
    return {
        "id": session_id,
        "cwd": cwd,
        "thread_source": thread_source,
        "session_source": session_source,
        "is_internal_thread": thread_source == "subagent",
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": len(messages),
        "messages": messages if include_messages else [],
        "file": str(path),
    }


class SessionStore:
    def __init__(self, codex_home: Path):
        self.codex_home = codex_home.expanduser().resolve()

    def files(self) -> list[Path]:
        sessions = self.codex_home / "sessions"
        return list(sessions.rglob("*.jsonl")) if sessions.is_dir() else []

    def find_path(self, session_id: str) -> Path | None:
        if not SESSION_ID_RE.fullmatch(session_id):
            return None
        sessions_root = (self.codex_home / "sessions").resolve()
        for path in self.files():
            if session_id not in path.name:
                continue
            resolved = path.resolve()
            try:
                resolved.relative_to(sessions_root)
            except ValueError:
                return None
            return resolved
        return None

    def list(self, query: str = "", limit: int = 200) -> list[dict[str, Any]]:
        titles = load_titles(self.codex_home)
        rows: list[dict[str, Any]] = []
        needle = query.casefold().strip()
        for path in self.files():
            row = parse_session(path, include_messages=True)
            if row["is_internal_thread"]:
                continue
            indexed = titles.get(row["id"], {})
            first_user = next((m["text"] for m in row["messages"] if m["role"] == "user"), "")
            # Background approval/audit threads have no genuine user message
            # after injected context records are removed.
            if not first_user:
                continue
            row["title"] = repair_legacy_text(indexed.get("title") or first_user.splitlines()[0][:100]) or "未命名会话"
            row["updated_at"] = indexed.get("updated_at") or row["updated_at"]
            row["is_temporary"] = is_temporary_workspace(row["cwd"])
            if needle and needle not in (row["title"] + " " + row["cwd"] + " " + first_user).casefold():
                continue
            row.pop("messages", None)
            row["local_path"] = row.pop("file", "")
            row.pop("session_source", None)
            row["local_path_exists"] = bool(row["local_path"] and Path(row["local_path"]).is_file())
            rows.append(row)
        rows.sort(key=lambda x: x["updated_at"], reverse=True)
        return rows[: max(1, min(limit, 1000))]

    def get(self, session_id: str) -> dict[str, Any] | None:
        titles = load_titles(self.codex_home)
        path = self.find_path(session_id)
        if path is None:
            return None
        result = parse_session(path)
        indexed = titles.get(session_id, {})
        result["title"] = repair_legacy_text(indexed.get("title") or "") or "未命名会话"
        result["updated_at"] = indexed.get("updated_at") or result["updated_at"]
        result["is_temporary"] = is_temporary_workspace(result["cwd"])
        result["local_path"] = result.pop("file", str(path))
        result["local_path_exists"] = path.is_file()
        return result

    def delete(self, session_id: str) -> bool:
        """Delete exactly one matching session file below the sessions root."""
        path = self.find_path(session_id)
        if path is None:
            return False
        try:
            path.unlink()
        except PermissionError:
            # Windows rejects unlinking files carrying the read-only bit.
            path.chmod(path.stat().st_mode | stat.S_IWRITE)
            path.unlink()
        return not path.exists()


class PurgeError(RuntimeError):
    pass


class CodexPurger:
    """Permanent local purge modeled after liuyoumi/codex-history."""

    REQUIRED_THREAD_COLUMNS = {"id", "title", "rollout_path", "created_at", "updated_at", "cwd", "archived"}

    def __init__(self, codex_home: Path):
        self.home = codex_home.expanduser().resolve()
        self.state_db = self.home / "state_5.sqlite"
        self.logs_db = self.home / "logs_2.sqlite"
        self.goals_db = self.home / "goals_1.sqlite"
        self.session_index = self.home / "session_index.jsonl"
        self.global_states = [self.home / ".codex-global-state.json", self.home / ".codex-global-state.json.bak"]
        self.shell_snapshots = self.home / "shell_snapshots"

    @staticmethod
    def _table_exists(db: sqlite3.Connection, table: str) -> bool:
        return db.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone() is not None

    @staticmethod
    def _columns(db: sqlite3.Connection, table: str) -> set[str]:
        return {str(row[1]) for row in db.execute(f'pragma table_info("{table}")')}

    @classmethod
    def _count(cls, db: sqlite3.Connection, table: str, column: str, session_id: str) -> int:
        if not cls._table_exists(db, table) or column not in cls._columns(db, table):
            return 0
        return int(db.execute(f'select count(*) from "{table}" where "{column}"=?', (session_id,)).fetchone()[0])

    def _open(self, path: Path, readonly: bool = False) -> sqlite3.Connection:
        if readonly:
            return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=5)
        return sqlite3.connect(path, timeout=5)

    def _validate_json_stores(self) -> None:
        if self.session_index.is_file():
            for number, line in enumerate(self.session_index.read_text(encoding="utf-8", errors="strict").splitlines(), 1):
                if line.strip():
                    try:
                        json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise PurgeError(f"session_index.jsonl 第 {number} 行损坏，已拒绝删除") from exc
        for path in self.global_states:
            if path.is_file():
                try:
                    value = json.loads(path.read_text(encoding="utf-8", errors="strict"))
                except (json.JSONDecodeError, UnicodeError) as exc:
                    raise PurgeError(f"{path.name} 无法解析，已拒绝删除") from exc
                if not isinstance(value, dict):
                    raise PurgeError(f"{path.name} 根节点结构未知，已拒绝删除")

    def _thread(self, session_id: str) -> dict[str, Any]:
        if not SESSION_ID_RE.fullmatch(session_id):
            raise PurgeError("会话 ID 格式无效")
        if not self.state_db.is_file():
            raise PurgeError("缺少 state_5.sqlite，无法安全删除")
        with closing(self._open(self.state_db, readonly=True)) as db:
            if not self._table_exists(db, "threads"):
                raise PurgeError("state_5.sqlite 缺少 threads 表")
            missing = self.REQUIRED_THREAD_COLUMNS - self._columns(db, "threads")
            if missing:
                raise PurgeError(f"Codex 数据结构不受支持，threads 缺少字段：{', '.join(sorted(missing))}")
            row = db.execute(
                "select id,title,rollout_path,cwd,updated_at,archived from threads where id=?", (session_id,)
            ).fetchone()
        if row is None:
            raise PurgeError("state_5.sqlite 中不存在该会话，无法执行完整删除")
        rollout = Path(str(row[2])).expanduser().resolve()
        allowed_roots = [(self.home / name).resolve() for name in ("sessions", "archived_sessions")]
        if not any(self._is_below(rollout, root) for root in allowed_roots):
            raise PurgeError("rollout_path 超出 Codex 会话目录，已拒绝删除")
        return {"id": str(row[0]), "title": str(row[1] or "未命名会话"), "rollout_path": rollout,
                "cwd": str(row[3] or ""), "updated_at": row[4], "archived": bool(row[5])}

    @staticmethod
    def _is_below(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            return False

    def _assert_inactive(self, target: dict[str, Any]) -> None:
        session_id = target["id"]
        if os.environ.get("CODEX_THREAD_ID") == session_id:
            raise PurgeError("拒绝删除当前正在运行的 Codex 会话")
        path: Path = target["rollout_path"]
        if path.is_file():
            before = (path.stat().st_size, path.stat().st_mtime_ns)
            time.sleep(0.18)
            after = (path.stat().st_size, path.stat().st_mtime_ns)
            if before != after:
                raise PurgeError("会话记录仍在增长，可能处于活跃状态，已拒绝删除")

    def plan(self, session_id: str) -> dict[str, Any]:
        self._validate_json_stores()
        target = self._thread(session_id)
        self._assert_inactive(target)
        rows: dict[str, int] = {}
        with closing(self._open(self.state_db, readonly=True)) as db:
            rows["threads"] = self._count(db, "threads", "id", session_id)
            rows["thread_dynamic_tools"] = self._count(db, "thread_dynamic_tools", "thread_id", session_id)
            rows["stage1_outputs"] = self._count(db, "stage1_outputs", "thread_id", session_id)
            if self._table_exists(db, "thread_spawn_edges"):
                rows["thread_spawn_edges"] = int(db.execute(
                    "select count(*) from thread_spawn_edges where parent_thread_id=? or child_thread_id=?",
                    (session_id, session_id),
                ).fetchone()[0])
            rows["agent_job_items"] = self._count(db, "agent_job_items", "assigned_thread_id", session_id)
        for path, table, column, label in (
            (self.logs_db, "logs", "thread_id", "logs"),
            (self.goals_db, "thread_goals", "thread_id", "thread_goals"),
        ):
            if path.is_file():
                with closing(self._open(path, readonly=True)) as db:
                    rows[label] = self._count(db, table, column, session_id)
        snapshots = self._snapshot_paths(session_id)
        return {
            "id": session_id,
            "short_id": session_id[:8],
            "title": target["title"],
            "cwd": target["cwd"],
            "rollout_path": str(target["rollout_path"]),
            "rollout_exists": target["rollout_path"].is_file(),
            "sqlite_rows": rows,
            "sqlite_rows_total": sum(rows.values()),
            "shell_snapshots": len(snapshots),
            "files_total": int(target["rollout_path"].is_file()) + len(snapshots),
        }

    def _snapshot_paths(self, session_id: str) -> list[Path]:
        if not self.shell_snapshots.is_dir():
            return []
        return [path for path in self.shell_snapshots.glob(f"{session_id}.*.sh") if path.is_file()]

    @staticmethod
    def _delete_where(db: sqlite3.Connection, table: str, column: str, session_id: str) -> int:
        if not CodexPurger._table_exists(db, table) or column not in CodexPurger._columns(db, table):
            return 0
        cursor = db.execute(f'delete from "{table}" where "{column}"=?', (session_id,))
        return max(0, cursor.rowcount)

    def _purge_sqlite(self, session_id: str) -> dict[str, int]:
        changed: dict[str, int] = {}
        with closing(self._open(self.state_db)) as db:
            with db:
                for table, column in (("thread_dynamic_tools", "thread_id"), ("stage1_outputs", "thread_id")):
                    changed[table] = self._delete_where(db, table, column, session_id)
                if self._table_exists(db, "thread_spawn_edges"):
                    cursor = db.execute(
                        "delete from thread_spawn_edges where parent_thread_id=? or child_thread_id=?",
                        (session_id, session_id),
                    )
                    changed["thread_spawn_edges"] = max(0, cursor.rowcount)
                if self._table_exists(db, "agent_job_items") and "assigned_thread_id" in self._columns(db, "agent_job_items"):
                    cursor = db.execute(
                        "update agent_job_items set assigned_thread_id=null where assigned_thread_id=?", (session_id,)
                    )
                    changed["agent_job_items"] = max(0, cursor.rowcount)
                changed["threads"] = self._delete_where(db, "threads", "id", session_id)
        for path, table, column, label in (
            (self.logs_db, "logs", "thread_id", "logs"),
            (self.goals_db, "thread_goals", "thread_id", "thread_goals"),
        ):
            if path.is_file():
                with closing(self._open(path)) as db:
                    with db:
                        changed[label] = self._delete_where(db, table, column, session_id)
        return changed

    @staticmethod
    def _atomic_write(path: Path, text_value: str) -> None:
        temp_name = ""
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=path.parent,
                                             prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
                temp_name = stream.name
                stream.write(text_value)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, path)
        finally:
            if temp_name and Path(temp_name).exists():
                Path(temp_name).unlink()

    def _purge_json(self, session_id: str) -> list[str]:
        changed: list[str] = []
        if self.session_index.is_file():
            original = self.session_index.read_text(encoding="utf-8")
            kept = []
            for line in original.splitlines():
                if line.strip() and json.loads(line).get("id") != session_id:
                    kept.append(line)
            updated = "\n".join(kept) + ("\n" if kept else "")
            if updated != original:
                self._atomic_write(self.session_index, updated)
                changed.append(self.session_index.name)
        for path in self.global_states:
            if not path.is_file():
                continue
            value = json.loads(path.read_text(encoding="utf-8"))
            updated_value, was_changed = self._remove_references(value, session_id)
            if was_changed:
                self._atomic_write(path, json.dumps(updated_value, ensure_ascii=False, indent=2) + "\n")
                changed.append(path.name)
        return changed

    @classmethod
    def _remove_references(cls, value: Any, session_id: str) -> tuple[Any, bool]:
        if isinstance(value, list):
            changed = False
            result = []
            for item in value:
                if item == session_id:
                    changed = True
                    continue
                next_item, item_changed = cls._remove_references(item, session_id)
                changed = changed or item_changed
                result.append(next_item)
            return result, changed
        if isinstance(value, dict):
            changed = False
            result = {}
            for key, child in value.items():
                if session_id in str(key):
                    changed = True
                    continue
                next_child, child_changed = cls._remove_references(child, session_id)
                changed = changed or child_changed
                result[key] = next_child
            return result, changed
        return value, False

    def _checkpoint(self) -> list[str]:
        warnings = []
        for path in (self.state_db, self.logs_db, self.goals_db):
            if not path.is_file():
                continue
            with closing(self._open(path)) as db:
                result = db.execute("pragma wal_checkpoint(truncate)").fetchone()
                if result and int(result[0]) != 0:
                    warnings.append(f"{path.name} WAL 仍忙碌")
        return warnings

    def _verify(self, session_id: str, rollout_path: Path, snapshots: list[Path]) -> list[str]:
        remaining: list[str] = []
        for path in (self.state_db, self.logs_db, self.goals_db):
            if not path.is_file():
                continue
            with closing(self._open(path, readonly=True)) as db:
                tables = [row[0] for row in db.execute("select name from sqlite_master where type='table'")]
                for table in tables:
                    for column in self._columns(db, str(table)):
                        if column == "id" or column.endswith("thread_id"):
                            count = self._count(db, str(table), column, session_id)
                            if count:
                                remaining.append(f"{path.name}:{table}.{column} ({count})")
        for path in (self.session_index, *self.global_states):
            if path.is_file() and session_id in path.read_text(encoding="utf-8", errors="replace"):
                remaining.append(path.name)
        if rollout_path.exists():
            remaining.append(str(rollout_path))
        remaining.extend(str(path) for path in snapshots if path.exists())
        return remaining

    def purge(self, session_id: str, confirmation: str) -> dict[str, Any]:
        plan = self.plan(session_id)
        if confirmation.strip().casefold() != plan["short_id"].casefold():
            raise PurgeError(f"确认码不匹配，应输入 {plan['short_id']}")
        return self._execute(session_id)

    def _execute(self, session_id: str) -> dict[str, Any]:
        target = self._thread(session_id)
        self._assert_inactive(target)
        snapshots = self._snapshot_paths(session_id)
        changed_rows = self._purge_sqlite(session_id)
        changed_json = self._purge_json(session_id)
        deleted_files = []
        for path in [target["rollout_path"], *snapshots]:
            if path.exists():
                path.chmod(path.stat().st_mode | stat.S_IWRITE)
                path.unlink()
                deleted_files.append(str(path))
        warnings = self._checkpoint()
        remaining = self._verify(session_id, target["rollout_path"], snapshots)
        return {"deleted": not remaining, "sqlite_rows": changed_rows, "json_files": changed_json,
                "deleted_files": deleted_files, "warnings": warnings, "remaining_references": remaining}

    def batch_plan(self, session_ids: list[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(session_ids))
        if not unique_ids:
            raise PurgeError("分组中没有可删除的会话")
        if len(unique_ids) > 1000:
            raise PurgeError("单次批量删除最多支持 1000 个会话")
        plans = [self.plan(session_id) for session_id in unique_ids]
        return {
            "confirmation": "purge-selected",
            "sessions": len(plans),
            "sqlite_rows_total": sum(plan["sqlite_rows_total"] for plan in plans),
            "files_total": sum(plan["files_total"] for plan in plans),
            "targets": [{"id": plan["id"], "title": plan["title"]} for plan in plans],
        }

    def purge_batch(self, session_ids: list[str], confirmation: str) -> dict[str, Any]:
        plan = self.batch_plan(session_ids)
        if confirmation.strip() != plan["confirmation"]:
            raise PurgeError("确认文本不匹配，应输入 purge-selected")
        reports = [self._execute(target["id"]) for target in plan["targets"]]
        remaining = [item for report in reports for item in report["remaining_references"]]
        return {
            "deleted": all(report["deleted"] for report in reports) and not remaining,
            "sessions_deleted": sum(1 for report in reports if report["deleted"]),
            "sqlite_rows_total": sum(sum(report["sqlite_rows"].values()) for report in reports),
            "files_total": sum(len(report["deleted_files"]) for report in reports),
            "warnings": [warning for report in reports for warning in report["warnings"]],
            "remaining_references": remaining,
        }


class Handler(SimpleHTTPRequestHandler):
    store: SessionStore
    purger: CodexPurger

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/sessions":
            params = parse_qs(parsed.query)
            try:
                limit = int(params.get("limit", ["200"])[0])
            except ValueError:
                limit = 200
            self.send_json({"sessions": self.store.list(params.get("q", [""])[0], limit)})
            return
        plan_match = re.fullmatch(r"/api/sessions/([^/]+)/delete-plan", parsed.path)
        if plan_match:
            try:
                self.send_json(self.purger.plan(plan_match.group(1)))
            except PurgeError as exc:
                self.send_json({"error": str(exc)}, 409)
            except (OSError, sqlite3.Error) as exc:
                self.send_json({"error": f"无法生成安全删除计划：{exc}"}, 500)
            return
        if parsed.path.startswith("/api/sessions/"):
            session_id = parsed.path.rsplit("/", 1)[-1]
            session = self.store.get(session_id)
            self.send_json(session or {"error": "会话不存在"}, 200 if session else 404)
            return
        if parsed.path == "/api/status":
            self.send_json({"api_version": API_VERSION, "codex_home": str(self.store.codex_home), "available": (self.store.codex_home / "sessions").is_dir()})
            return
        super().do_GET()

    def do_DELETE(self) -> None:  # noqa: N802
        self.send_json({"error": "直接 DELETE 已禁用，请先获取删除计划并提交短 ID 确认"}, 405)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/api/session-groups/delete-plan", "/api/session-groups/delete"}:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 256_000:
                    raise PurgeError("缺少有效的批量删除请求")
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                session_ids = body.get("session_ids") if isinstance(body, dict) else None
                if not isinstance(session_ids, list) or not all(isinstance(item, str) for item in session_ids):
                    raise PurgeError("批量删除的会话 ID 列表无效")
                if parsed.path.endswith("delete-plan"):
                    self.send_json(self.purger.batch_plan(session_ids))
                else:
                    report = self.purger.purge_batch(session_ids, str(body.get("confirmation") or ""))
                    self.send_json(report, 200 if report["deleted"] else 409)
            except PurgeError as exc:
                self.send_json({"error": str(exc)}, 409)
            except (json.JSONDecodeError, UnicodeError):
                self.send_json({"error": "批量删除请求格式无效"}, 400)
            except (PermissionError, sqlite3.OperationalError) as exc:
                self.send_json({"error": f"Codex 数据文件正被占用或无写入权限：{exc}"}, 423)
            except OSError as exc:
                self.send_json({"error": f"批量删除失败：{exc}"}, 500)
            return
        match = re.fullmatch(r"/api/sessions/([^/]+)/delete", parsed.path)
        if not match:
            self.send_json({"error": "接口不存在"}, 404)
            return
        session_id = match.group(1)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096:
                raise PurgeError("缺少有效的删除确认信息")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            confirmation = str(body.get("confirmation") or "") if isinstance(body, dict) else ""
            report = self.purger.purge(session_id, confirmation)
        except PurgeError as exc:
            self.send_json({"error": str(exc)}, 409)
            return
        except (json.JSONDecodeError, UnicodeError):
            self.send_json({"error": "删除确认请求格式无效"}, 400)
            return
        except (PermissionError, sqlite3.OperationalError) as exc:
            self.send_json({"error": f"Codex 数据文件正被占用或无写入权限：{exc}"}, 423)
            return
        except OSError as exc:
            self.send_json({"error": f"删除失败（{getattr(exc, 'winerror', exc.errno)}）：{exc.strerror or exc}"}, 500)
            return
        self.send_json(report, 200 if report["deleted"] else 409)


def main() -> None:
    parser = argparse.ArgumentParser(description="在浏览器中查看 Codex 本地历史会话")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--codex-home", type=Path, default=DEFAULT_CODEX_HOME)
    args = parser.parse_args()
    Handler.store = SessionStore(args.codex_home)
    Handler.purger = CodexPurger(args.codex_home)
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        # Windows may reserve seemingly unused ports (WinError 10013), while
        # WinError 10048 means another process already owns the port. Let the
        # OS select a free ephemeral port in either case.
        if args.port == 0 or getattr(exc, "winerror", None) not in {10013, 10048} and exc.errno not in {errno.EACCES, errno.EADDRINUSE}:
            raise
        print(f"端口 {args.port} 不可用，正在自动选择可用端口……")
        server = ThreadingHTTPServer((args.host, 0), Handler)
    actual_host, actual_port = server.server_address[:2]
    display_host = "127.0.0.1" if actual_host in {"0.0.0.0", "::"} else actual_host
    print(f"Codex History Manager: http://{display_host}:{actual_port}")
    print(f"Reading: {Handler.store.codex_home}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
