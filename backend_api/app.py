from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nutrition_demo.db"

app = Flask(__name__)
app.config["SECRET_KEY"] = "nutrition-form-demo-secret"
app.config["JSON_SORT_KEYS"] = False


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def row_to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def payload() -> dict:
    return request.get_json(silent=True) or {}


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_handler(_path: str):
    return ("", 204)


def init_db() -> None:
    connection = get_db()
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            note TEXT DEFAULT '',
            theme TEXT DEFAULT 'citrus'
        );

        CREATE TABLE IF NOT EXISTS surveys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            favorite_dish TEXT NOT NULL,
            meals_per_day TEXT NOT NULL,
            snacks_per_week TEXT NOT NULL,
            water_per_day TEXT NOT NULL,
            diet_style TEXT NOT NULL,
            allergies TEXT DEFAULT '',
            comments TEXT DEFAULT '',
            visibility TEXT DEFAULT 'public'
        );
        """
    )

    admin = connection.execute(
        "SELECT id FROM users WHERE username = 'admin'"
    ).fetchone()
    if not admin:
        connection.execute(
            "INSERT INTO users (username, password, role, note, theme) VALUES (?, ?, ?, ?, ?)",
            (
                "admin",
                "Admin123!",
                "admin",
                "<strong>Responsable</strong> de l'enquete nutrition.",
                "midnight",
            ),
        )

    sample = connection.execute("SELECT id FROM surveys LIMIT 1").fetchone()
    if not sample:
        connection.execute(
            """
            INSERT INTO surveys
            (username, favorite_dish, meals_per_day, snacks_per_week, water_per_day, diet_style, allergies, comments, visibility)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "admin",
                "Couscous royal",
                "3",
                "5",
                "2L",
                "omnivore",
                "Aucune",
                "Je prefere les plats riches et je mange souvent tard le soir.",
                "public",
            ),
        )

    connection.commit()
    connection.close()


@app.route("/")
def root():
    return jsonify(
        {
            "message": "NutriForm backend API",
            "frontend": "Lancer le frontend React sur http://localhost:5173",
            "health": "http://127.0.0.1:5002/api/health",
            "note": "Cette racine expose seulement l'API.",
        }
    )


@app.route("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "NutriForm API",
            "mode": "insecure-demo",
            "defaultAdmin": {"username": "admin", "password": "Admin123!"},
        }
    )


@app.route("/api/register", methods=["POST"])
def register():
    data = payload()
    username = data.get("username", "")
    password = data.get("password", "")
    role = data.get("role", "student")
    note = data.get("note", "")
    theme = data.get("theme", "citrus")

    connection = get_db()
    try:
        connection.execute(
            "INSERT INTO users (username, password, role, note, theme) VALUES (?, ?, ?, ?, ?)",
            (username, password, role, note, theme),
        )
        connection.commit()
        return jsonify(
            {
                "message": "Compte cree.",
                "user": {
                    "username": username,
                    "role": role,
                    "note": note,
                    "theme": theme,
                },
            }
        ), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Nom d'utilisateur deja present."}), 409
    finally:
        connection.close()


@app.route("/api/login", methods=["POST"])
def login():
    data = payload()
    username = data.get("username", "")
    password = data.get("password", "")

    query = (
        "SELECT id, username, password, role, note, theme FROM users "
        f"WHERE username = '{username}' AND password = '{password}'"
    )
    connection = get_db()
    user = connection.execute(query).fetchone()
    connection.close()

    if not user:
        return jsonify({"error": "Connexion refusee."}), 401

    response = row_to_dict(user)
    response["token"] = f"debug-{response['username']}-token"
    response["notice"] = "Session stockee cote navigateur."
    return jsonify(response)


@app.route("/api/surveys")
def list_surveys():
    search = request.args.get("search", "")
    connection = get_db()
    if search:
        query = (
            "SELECT * FROM surveys "
            f"WHERE username LIKE '%{search}%' OR favorite_dish LIKE '%{search}%' "
            f"OR comments LIKE '%{search}%' ORDER BY id DESC"
        )
        surveys = connection.execute(query).fetchall()
    else:
        surveys = connection.execute("SELECT * FROM surveys ORDER BY id DESC").fetchall()
    connection.close()
    return jsonify([row_to_dict(survey) for survey in surveys])


@app.route("/api/surveys", methods=["POST"])
def create_survey():
    data = payload()
    connection = get_db()
    connection.execute(
        """
        INSERT INTO surveys
        (username, favorite_dish, meals_per_day, snacks_per_week, water_per_day, diet_style, allergies, comments, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data.get("username", ""),
            data.get("favorite_dish", ""),
            data.get("meals_per_day", ""),
            data.get("snacks_per_week", ""),
            data.get("water_per_day", ""),
            data.get("diet_style", ""),
            data.get("allergies", ""),
            data.get("comments", ""),
            data.get("visibility", "public"),
        ),
    )
    connection.commit()
    connection.close()
    return jsonify({"message": "Reponse enregistree."})


@app.route("/api/profile/<username>", methods=["GET"])
def get_profile(username: str):
    connection = get_db()
    user = connection.execute(
        f"SELECT id, username, role, note, theme FROM users WHERE username = '{username}'"
    ).fetchone()
    surveys = connection.execute(
        f"SELECT * FROM surveys WHERE username = '{username}' ORDER BY id DESC"
    ).fetchall()
    connection.close()
    if not user:
        return jsonify({"error": "Utilisateur introuvable."}), 404
    return jsonify(
        {
            "user": row_to_dict(user),
            "surveys": [row_to_dict(survey) for survey in surveys],
        }
    )


@app.route("/api/profile/<username>", methods=["POST"])
def update_profile(username: str):
    data = payload()
    note = data.get("note", "")
    theme = data.get("theme", "citrus")

    connection = get_db()
    connection.execute(
        f"UPDATE users SET note = '{note}', theme = '{theme}' WHERE username = '{username}'"
    )
    connection.commit()
    connection.close()
    return jsonify({"message": "Profil mis a jour.", "username": username})


@app.route("/api/admin/surveys")
def admin_surveys():
    is_admin = request.args.get("admin") == "1" or request.headers.get("X-Role") == "admin"
    if not is_admin:
        return jsonify({"error": "Acces admin refuse."}), 403

    connection = get_db()
    users = connection.execute(
        "SELECT id, username, password, role, note, theme FROM users ORDER BY id DESC"
    ).fetchall()
    surveys = connection.execute("SELECT * FROM surveys ORDER BY id DESC").fetchall()
    connection.close()
    return jsonify(
        {
            "users": [row_to_dict(user) for user in users],
            "surveys": [row_to_dict(survey) for survey in surveys],
        }
    )


@app.route("/api/debug/users")
def debug_users():
    connection = get_db()
    users = connection.execute(
        "SELECT id, username, password, role FROM users ORDER BY id DESC"
    ).fetchall()
    connection.close()
    return jsonify([row_to_dict(user) for user in users])


@app.route("/api/reset", methods=["POST"])
def reset():
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()
    return jsonify({"message": "Base reinitialisee."})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5002)
