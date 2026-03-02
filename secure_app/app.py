from __future__ import annotations

import os
import re
import secrets
import sqlite3
from functools import wraps
from pathlib import Path

from flask import Flask, abort, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "secure.db"

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECURE_APP_SECRET", "change-me-in-production")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SECURE"] = False
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = 1800

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


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
            password_hash TEXT NOT NULL,
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
        "SELECT id FROM users WHERE username = ?",
        ("admin",),
    ).fetchone()
    if not admin:
        connection.execute(
            "INSERT INTO users (username, password_hash, role, bio) VALUES (?, ?, ?, ?)",
            (
                "admin",
                generate_password_hash("Admin123!"),
                "admin",
                "Compte admin initialise.",
            ),
        )
    connection.commit()
    connection.close()


def validate_csrf() -> None:
    sent_token = request.form.get("csrf_token", "")
    session_token = session.get("csrf_token", "")
    if not sent_token or not session_token or not secrets.compare_digest(sent_token, session_token):
        abort(400, description="Jeton CSRF invalide.")


def ensure_csrf_token() -> str:
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(16)
    return session["csrf_token"]


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("role") != "admin":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def validate_registration(username: str, password: str) -> list[str]:
    errors: list[str] = []
    if not USERNAME_RE.fullmatch(username):
        errors.append("Le nom d'utilisateur doit contenir 3 a 20 caracteres alphanumeriques ou _.")
    if len(password) < 8:
        errors.append("Le mot de passe doit contenir au moins 8 caracteres.")
    if password.lower() == password or password.upper() == password:
        errors.append("Le mot de passe doit melanger majuscules et minuscules.")
    if not any(character.isdigit() for character in password):
        errors.append("Le mot de passe doit contenir au moins un chiffre.")
    return errors


def validate_profile(bio: str, post: str) -> list[str]:
    errors: list[str] = []
    if len(bio) > 300:
        errors.append("La bio ne doit pas depasser 300 caracteres.")
    if post and len(post) > 280:
        errors.append("Le message ne doit pas depasser 280 caracteres.")
    return errors


@app.context_processor
def inject_csrf_token():
    return {"csrf_token": ensure_csrf_token()}


@app.route("/")
def index():
    connection = get_db()
    posts = connection.execute(
        "SELECT username, content FROM posts ORDER BY id DESC"
    ).fetchall()
    connection.close()
    return render_template("index.html", posts=posts)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        validate_csrf()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        errors = validate_registration(username, password)
        if errors:
            for error in errors:
                flash(error)
            return render_template("register.html")

        connection = get_db()
        try:
            connection.execute(
                "INSERT INTO users (username, password_hash, role, bio) VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password), "user", ""),
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
        validate_csrf()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        connection = get_db()
        user = connection.execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        connection.close()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            session["role"] = user["role"]
            session["csrf_token"] = secrets.token_hex(16)
            flash("Connexion reussie.")
            return redirect(url_for("profile"))
        flash("Identifiants invalides.")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Session fermee.")
    return redirect(url_for("index"))


@app.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    connection = get_db()
    if request.method == "POST":
        validate_csrf()
        bio = request.form.get("bio", "").strip()
        post = request.form.get("post", "").strip()
        errors = validate_profile(bio, post)
        if errors:
            for error in errors:
                flash(error)
        else:
            connection.execute(
                "UPDATE users SET bio = ? WHERE id = ?",
                (bio, session["user_id"]),
            )
            if post:
                connection.execute(
                    "INSERT INTO posts (username, content) VALUES (?, ?)",
                    (session["username"], post),
                )
            connection.commit()
            flash("Profil mis a jour.")

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
@login_required
@admin_required
def admin():
    connection = get_db()
    users = connection.execute(
        "SELECT id, username, role, bio FROM users ORDER BY id"
    ).fetchall()
    connection.close()
    return render_template("admin.html", users=users)


if __name__ == "__main__":
    init_db()
    app.run(debug=False, port=5001)
