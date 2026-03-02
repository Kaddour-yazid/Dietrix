from __future__ import annotations

import sqlite3
from pathlib import Path

from flask import Flask, flash, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "insecure.db"

app = Flask(__name__)
app.config["SECRET_KEY"] = "hardcoded-dev-secret"
app.config["SESSION_COOKIE_HTTPONLY"] = False
app.config["SESSION_COOKIE_SECURE"] = False
app.config["SESSION_COOKIE_SAMESITE"] = None


def get_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    connection = get_db()
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            bio TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL
        );
        """
    )
    admin = connection.execute(
        "SELECT id FROM users WHERE username = 'admin'"
    ).fetchone()
    if not admin:
        connection.execute(
            "INSERT INTO users (username, password, role, bio) VALUES (?, ?, ?, ?)",
            ("admin", "Admin123!", "admin", "Compte admin initialise."),
        )
    connection.commit()
    connection.close()


@app.route("/")
def index():
    connection = get_db()
    posts = connection.execute("SELECT username, content FROM posts ORDER BY id DESC").fetchall()
    connection.close()
    return render_template("index.html", posts=posts)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        role = request.form.get("role", "user")
        connection = get_db()
        try:
            connection.execute(
                "INSERT INTO users (username, password, role, bio) VALUES (?, ?, ?, ?)",
                (username, password, role, ""),
            )
            connection.commit()
            flash("Compte cree. Tu peux te connecter.")
            return redirect(url_for("login"))
        except sqlite3.IntegrityError:
            flash("Nom d'utilisateur deja utilise.")
        finally:
            connection.close()
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        query = (
            "SELECT id, username, role FROM users "
            f"WHERE username = '{username}' AND password = '{password}'"
        )
        connection = get_db()
        user = connection.execute(query).fetchone()
        connection.close()
        if user:
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            flash("Connexion reussie.")
            return redirect(url_for("profile"))
        flash("Connexion refusee.")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Session fermee.")
    return redirect(url_for("index"))


@app.route("/profile", methods=["GET", "POST"])
def profile():
    if "user_id" not in session:
        return redirect(url_for("login"))

    connection = get_db()
    if request.method == "POST":
        bio = request.form.get("bio", "")
        post = request.form.get("post", "")
        connection.execute(
            f"UPDATE users SET bio = '{bio}' WHERE id = {session['user_id']}"
        )
        if post:
            connection.execute(
                "INSERT INTO posts (username, content) VALUES (?, ?)",
                (session["username"], post),
            )
        connection.commit()

    user = connection.execute(
        "SELECT username, role, bio FROM users WHERE id = ?",
        (session["user_id"],),
    ).fetchone()
    posts = connection.execute(
        "SELECT username, content FROM posts WHERE username = ? ORDER BY id DESC",
        (session["username"],),
    ).fetchall()
    connection.close()
    return render_template("profile.html", user=user, posts=posts)


@app.route("/admin")
def admin():
    if session.get("role") != "admin" and request.args.get("admin") != "1":
        flash("Acces admin refuse.")
        return redirect(url_for("index"))

    connection = get_db()
    users = connection.execute(
        "SELECT id, username, password, role, bio FROM users ORDER BY id"
    ).fetchall()
    connection.close()
    return render_template("admin.html", users=users)


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
