from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from sqlcipher3 import dbapi2 as sqlcipher3
except ImportError as exc:
    raise SystemExit(
        "sqlcipher3 is required for migration. Install dependencies from requirements.txt first."
    ) from exc

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nutriplan.db"
BACKUP_PATH = BASE_DIR / "nutriplan.plaintext.bak"
TEMP_PATH = BASE_DIR / "nutriplan.encrypted.tmp"
DB_PASSPHRASE_ENV = "NUTRIPLAN_DB_PASSPHRASE"


def load_env_files() -> None:
    candidates = [BASE_DIR.parent / ".env", BASE_DIR / ".env"]
    for path in candidates:
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sqlite_file_header(path: Path) -> bytes:
    with path.open("rb") as file_obj:
        return file_obj.read(16)


def is_plaintext_sqlite_database(path: Path) -> bool:
    return path.exists() and sqlite_file_header(path).startswith(b"SQLite format 3\x00")


def verify_encrypted_database(path: Path, passphrase: str) -> None:
    connection = sqlcipher3.connect(path)
    try:
        connection.execute(f"PRAGMA key = {sql_quote(passphrase)}")
        connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
    finally:
        connection.close()


def main() -> int:
    load_env_files()

    passphrase = os.environ.get(DB_PASSPHRASE_ENV, "").strip()
    if not passphrase:
        print(f"Set {DB_PASSPHRASE_ENV} in your environment or .env file before running migration.")
        return 1

    if not DB_PATH.exists():
        print(f"No database found at {DB_PATH}. Start the backend once to create it, then rerun migration.")
        return 1

    if not is_plaintext_sqlite_database(DB_PATH):
        print(
            f"{DB_PATH.name} does not look like a plaintext SQLite file. "
            "It may already be encrypted, or the file format is unexpected."
        )
        return 1

    if BACKUP_PATH.exists():
        print(f"Backup path already exists: {BACKUP_PATH}. Move or remove it before rerunning migration.")
        return 1

    if TEMP_PATH.exists():
        TEMP_PATH.unlink()

    connection = sqlcipher3.connect(DB_PATH)
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            f"ATTACH DATABASE {sql_quote(str(TEMP_PATH))} AS encrypted KEY {sql_quote(passphrase)}"
        )
        connection.execute("SELECT sqlcipher_export('encrypted')")
        connection.execute("DETACH DATABASE encrypted")
    finally:
        connection.close()

    try:
        verify_encrypted_database(TEMP_PATH, passphrase)
    except Exception as exc:
        if TEMP_PATH.exists():
            TEMP_PATH.unlink()
        print(f"Encrypted database verification failed: {exc}")
        return 1

    DB_PATH.replace(BACKUP_PATH)
    try:
        TEMP_PATH.replace(DB_PATH)
    except Exception:
        BACKUP_PATH.replace(DB_PATH)
        raise

    print(f"Migration complete. Encrypted database: {DB_PATH}")
    print(f"Plaintext backup saved as: {BACKUP_PATH}")
    print(f"Keep {DB_PASSPHRASE_ENV} set before starting the backend.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
