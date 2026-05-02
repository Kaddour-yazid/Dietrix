from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from sqlcipher3 import dbapi2 as sqlcipher3
except ImportError:
    sqlcipher3 = None

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nutriplan.db"
DB_PASSPHRASE_ENV = "NUTRIPLAN_DB_PASSPHRASE"
AI_PLAN_CACHE: dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]] = {}


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


load_env_files()
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}
GOAL_ADJUSTMENTS = {"lose": -350, "maintain": 0, "gain": 250}
PROTEIN_FACTORS = {"lose": 1.8, "maintain": 1.6, "gain": 2.0}
DIETARY_STYLES = {
    "balanced",
    "vegetarian",
    "vegan",
    "pescatarian",
    "high_protein",
    "low_carb",
}
SEXES = {"male", "female", "other"}

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get(
    "NUTRIPLAN_SECRET_KEY", "nutriplan-dev-secret-change-me"
)
app.config["JSON_SORT_KEYS"] = False


def token_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="nutriplan-auth")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return datetime.now().date().isoformat()


def current_day_name() -> str:
    return DAY_NAMES[datetime.now().date().weekday()]


def database_passphrase() -> str | None:
    value = os.environ.get(DB_PASSPHRASE_ENV, "").strip()
    return value or None


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sqlite_file_header(path: Path) -> bytes:
    if not path.exists():
        return b""
    with path.open("rb") as file_obj:
        return file_obj.read(16)


def is_plaintext_sqlite_database(path: Path) -> bool:
    return sqlite_file_header(path).startswith(b"SQLite format 3\x00")


def configure_connection(connection: sqlite3.Connection, passphrase: str | None) -> sqlite3.Connection:
    if passphrase is not None:
        connection.execute(f"PRAGMA key = {sql_quote(passphrase)}")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def open_database_connection(path: Path = DB_PATH) -> sqlite3.Connection:
    passphrase = database_passphrase()

    if passphrase is None:
        if path.exists() and not is_plaintext_sqlite_database(path):
            raise RuntimeError(
                f"{path.name} does not look like a plaintext SQLite database. "
                f"If it was migrated to SQLCipher, set {DB_PASSPHRASE_ENV} before starting the backend."
            )
        return configure_connection(sqlite3.connect(path), None)

    if sqlcipher3 is None:
        raise RuntimeError(
            "SQLCipher support is enabled, but the sqlcipher3 package is not installed. "
            "Install dependencies from requirements.txt."
        )

    if path.exists() and is_plaintext_sqlite_database(path):
        raise RuntimeError(
            f"{path.name} is still plaintext SQLite. Run backend_api/migrate_to_sqlcipher.py after setting "
            f"{DB_PASSPHRASE_ENV} to migrate the database first."
        )

    connection = configure_connection(sqlcipher3.connect(path), passphrase)
    try:
        connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except Exception as exc:
        connection.close()
        raise RuntimeError(
            "Unable to open the SQLCipher database. Check the configured passphrase or migrate the database first."
        ) from exc
    return connection


def get_db() -> sqlite3.Connection:
    connection = g.get("db")
    if connection is None:
        connection = open_database_connection(DB_PATH)
        g.db = connection
    return connection


@app.teardown_appcontext
def close_db(_error: BaseException | None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db() -> None:
    connection = open_database_connection(DB_PATH)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            age INTEGER NOT NULL,
            sex TEXT NOT NULL,
            height_cm REAL NOT NULL,
            weight_kg REAL NOT NULL,
            goal TEXT NOT NULL,
            activity_level TEXT NOT NULL,
            workouts_per_week INTEGER NOT NULL,
            daily_calorie_target INTEGER,
            meals_per_day INTEGER NOT NULL,
            dietary_style TEXT NOT NULL,
            likes TEXT NOT NULL DEFAULT '[]',
            dislikes TEXT NOT NULL DEFAULT '[]',
            allergies TEXT NOT NULL DEFAULT '[]',
            notes TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS meal_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            log_date TEXT NOT NULL,
            meal_day TEXT NOT NULL,
            meal_name TEXT NOT NULL,
            meal_title TEXT NOT NULL,
            calories INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, log_date, meal_day, meal_name),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workout_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            log_date TEXT NOT NULL,
            workout_day TEXT NOT NULL,
            focus TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, log_date, workout_day, focus),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS water_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            log_date TEXT NOT NULL,
            amount_ml INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    connection.commit()
    connection.close()


def json_payload() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_email(value: Any) -> str:
    return normalize_text(value).lower()


def parse_list_field(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    elif isinstance(value, str):
        raw_items = value.split(",")
    else:
        return []

    items: list[str] = []
    seen: set[str] = set()
    for raw_item in raw_items:
        cleaned = normalize_text(raw_item)
        lowered = cleaned.lower()
        if cleaned and lowered not in seen:
            items.append(cleaned)
            seen.add(lowered)
    return items[:12]


def parse_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [normalize_text(item) for item in parsed if normalize_text(item)]


def fetch_user_by_email(email: str) -> sqlite3.Row | None:
    return get_db().execute(
        "SELECT id, full_name, email, password_hash, created_at FROM users WHERE email = ?",
        (email,),
    ).fetchone()


def fetch_user_by_id(user_id: int) -> sqlite3.Row | None:
    return get_db().execute(
        "SELECT id, full_name, email, password_hash, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()


def fetch_profile(user_id: int) -> sqlite3.Row | None:
    return get_db().execute("SELECT * FROM profiles WHERE user_id = ?", (user_id,)).fetchone()


def serialize_user(user: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": user["id"],
        "fullName": user["full_name"],
        "email": user["email"],
        "createdAt": user["created_at"],
    }


def serialize_profile(profile: sqlite3.Row) -> dict[str, Any]:
    return {
        "age": profile["age"],
        "sex": profile["sex"],
        "heightCm": profile["height_cm"],
        "weightKg": profile["weight_kg"],
        "goal": profile["goal"],
        "activityLevel": profile["activity_level"],
        "workoutsPerWeek": profile["workouts_per_week"],
        "dailyCalorieTarget": profile["daily_calorie_target"],
        "mealsPerDay": profile["meals_per_day"],
        "dietaryStyle": profile["dietary_style"],
        "likes": parse_json_list(profile["likes"]),
        "dislikes": parse_json_list(profile["dislikes"]),
        "allergies": parse_json_list(profile["allergies"]),
        "notes": profile["notes"],
        "updatedAt": profile["updated_at"],
    }


def issue_token(user_id: int) -> str:
    return token_serializer().dumps({"user_id": user_id})


def current_user() -> sqlite3.Row | None:
    cached_user = g.get("current_user")
    if cached_user is not None:
        return cached_user

    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None

    token = header.split(" ", 1)[1].strip()
    if not token:
        return None

    try:
        payload = token_serializer().loads(token, max_age=60 * 60 * 24 * 7)
    except (BadSignature, SignatureExpired):
        return None

    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        return None

    user = fetch_user_by_id(user_id)
    if user is not None:
        g.current_user = user
    return user


EXERCISE_LIBRARY: dict[str, dict[str, Any]] = {
    "upper_strength": {
        "kind": "training",
        "focus": "Upper body strength",
        "duration": 50,
        "intensity": "Medium",
        "exercises": [
            "Bench press 4 x 8",
            "Seated cable row 4 x 10",
            "Overhead press 3 x 10",
            "Lat pulldown 3 x 12",
        ],
        "note": "Keep 1 to 2 reps in reserve on the last set.",
    },
    "lower_strength": {
        "kind": "training",
        "focus": "Lower body strength",
        "duration": 55,
        "intensity": "Medium",
        "exercises": [
            "Back squat 4 x 6",
            "Romanian deadlift 4 x 8",
            "Walking lunges 3 x 10 each side",
            "Standing calf raises 3 x 15",
        ],
        "note": "Control the lowering phase and rest for 90 seconds between sets.",
    },
    "full_body": {
        "kind": "training",
        "focus": "Full body strength",
        "duration": 50,
        "intensity": "Medium",
        "exercises": [
            "Goblet squat 4 x 10",
            "Push-ups 4 x 12",
            "Single-arm dumbbell row 4 x 10",
            "Dead bug 3 x 12 each side",
        ],
        "note": "Use this as a high-value session when time is tight.",
    },
    "hypertrophy_push_pull": {
        "kind": "training",
        "focus": "Push and pull hypertrophy",
        "duration": 60,
        "intensity": "Medium-high",
        "exercises": [
            "Incline dumbbell press 4 x 10",
            "Chest-supported row 4 x 10",
            "Cable fly 3 x 12",
            "Face pulls 3 x 15",
        ],
        "note": "Add load only if every rep stays controlled.",
    },
    "legs_core": {
        "kind": "training",
        "focus": "Legs and core",
        "duration": 55,
        "intensity": "Medium-high",
        "exercises": [
            "Front squat 4 x 8",
            "Hip thrust 4 x 10",
            "Split squat 3 x 10 each side",
            "Plank 3 x 45 seconds",
        ],
        "note": "This is the main lower-body growth session for the week.",
    },
    "interval_cardio": {
        "kind": "training",
        "focus": "Cardio intervals",
        "duration": 35,
        "intensity": "High",
        "exercises": [
            "5-minute warm-up walk",
            "10 rounds of 45 seconds fast / 75 seconds easy",
            "8-minute cooldown",
        ],
        "note": "Use a bike, run, rower, or incline treadmill.",
    },
    "steady_cardio": {
        "kind": "training",
        "focus": "Steady-state cardio",
        "duration": 40,
        "intensity": "Low-medium",
        "exercises": [
            "5-minute warm-up",
            "30 minutes conversational pace cardio",
            "5-minute cooldown",
        ],
        "note": "Aim for a pace that feels sustainable, not maximal.",
    },
    "conditioning": {
        "kind": "training",
        "focus": "Conditioning circuit",
        "duration": 40,
        "intensity": "Medium-high",
        "exercises": [
            "Kettlebell deadlift 4 x 12",
            "Battle rope intervals 8 x 20 seconds",
            "Step-ups 3 x 12 each side",
            "Mountain climbers 3 x 30 seconds",
        ],
        "note": "Keep transitions short to build work capacity.",
    },
    "mobility": {
        "kind": "recovery",
        "focus": "Mobility and recovery",
        "duration": 25,
        "intensity": "Low",
        "exercises": [
            "Thoracic rotations 2 x 8 each side",
            "90-90 hip flow 2 x 8 each side",
            "Hamstring stretch 2 x 40 seconds",
            "Breathing reset 5 minutes",
        ],
        "note": "Treat this like quality movement practice, not cardio.",
    },
    "recovery_walk": {
        "kind": "recovery",
        "focus": "Active recovery walk",
        "duration": 30,
        "intensity": "Low",
        "exercises": [
            "Brisk outdoor walk for 30 minutes",
            "5 minutes of easy calf and hip stretching",
        ],
        "note": "This keeps you moving without adding much fatigue.",
    },
}
PROTEIN_OPTIONS: dict[str, list[str]] = {
    "balanced": [
        "chicken breast",
        "salmon",
        "eggs",
        "Greek yogurt",
        "turkey mince",
        "tofu",
        "lentils",
        "cottage cheese",
    ],
    "vegetarian": [
        "eggs",
        "Greek yogurt",
        "tofu",
        "tempeh",
        "lentils",
        "cottage cheese",
        "chickpeas",
        "edamame",
    ],
    "vegan": [
        "tofu",
        "tempeh",
        "lentils",
        "chickpeas",
        "edamame",
        "black beans",
        "seitan",
    ],
    "pescatarian": [
        "salmon",
        "tuna",
        "shrimp",
        "eggs",
        "Greek yogurt",
        "tofu",
        "lentils",
    ],
    "high_protein": [
        "chicken breast",
        "turkey mince",
        "salmon",
        "Greek yogurt",
        "eggs",
        "cottage cheese",
        "tofu",
    ],
    "low_carb": [
        "chicken breast",
        "salmon",
        "eggs",
        "Greek yogurt",
        "turkey mince",
        "tofu",
        "shrimp",
        "cottage cheese",
    ],
}
CARB_OPTIONS: dict[str, list[str]] = {
    "default": [
        "oats",
        "brown rice",
        "quinoa",
        "whole-grain toast",
        "sweet potato",
        "whole-grain pasta",
        "couscous",
        "basmati rice",
    ],
    "low_carb": [
        "roasted cauliflower",
        "quinoa",
        "lentil pasta",
        "zucchini noodles",
        "sweet potato",
    ],
}
VEGETABLE_OPTIONS: list[str] = [
    "spinach",
    "broccoli",
    "mixed greens",
    "roasted peppers",
    "zucchini",
    "green beans",
    "tomatoes",
    "cucumber",
]
FAT_OPTIONS: list[str] = [
    "avocado",
    "olive oil",
    "almonds",
    "walnuts",
    "chia seeds",
    "peanut butter",
]
SNACK_OPTIONS: dict[str, list[str]] = {
    "balanced": [
        "apple with almond butter",
        "Greek yogurt with berries",
        "protein smoothie",
        "hummus with carrots",
        "banana with peanut butter",
    ],
    "vegetarian": [
        "Greek yogurt with berries",
        "protein smoothie",
        "hummus with carrots",
        "apple with almond butter",
    ],
    "vegan": [
        "soy yogurt with berries",
        "protein smoothie",
        "hummus with carrots",
        "edamame snack box",
    ],
    "pescatarian": [
        "Greek yogurt with berries",
        "protein smoothie",
        "apple with almond butter",
        "hummus with carrots",
    ],
    "high_protein": [
        "protein smoothie",
        "cottage cheese with fruit",
        "Greek yogurt with berries",
        "turkey roll-ups",
    ],
    "low_carb": [
        "boiled eggs with cucumber",
        "Greek yogurt with cinnamon",
        "cottage cheese with walnuts",
        "protein smoothie",
    ],
}


def filtered_candidates(
    candidates: list[str], preferred: list[str], blocked: list[str], offset: int
) -> str:
    blocked_terms = [term.lower() for term in blocked]
    preferred_terms = [term.lower() for term in preferred]
    allowed = []

    for item in candidates:
        lowered = item.lower()
        if any(term in lowered for term in blocked_terms):
            continue
        score = sum(1 for term in preferred_terms if term in lowered)
        allowed.append((score, item))

    if not allowed:
        allowed = [(0, item) for item in candidates]

    allowed.sort(key=lambda entry: (-entry[0], entry[1]))
    return allowed[offset % len(allowed)][1]


def calorie_distribution(meals_per_day: int) -> list[tuple[str, float]]:
    if meals_per_day <= 3:
        return [("Breakfast", 0.3), ("Lunch", 0.4), ("Dinner", 0.3)]
    if meals_per_day == 4:
        return [
            ("Breakfast", 0.25),
            ("Lunch", 0.35),
            ("Snack", 0.1),
            ("Dinner", 0.3),
        ]
    return [
        ("Breakfast", 0.22),
        ("Snack", 0.1),
        ("Lunch", 0.28),
        ("Snack 2", 0.12),
        ("Dinner", 0.28),
    ]


def bmi_category(bmi: float) -> str:
    if bmi < 18.5:
        return "Underweight"
    if bmi < 25:
        return "Healthy range"
    if bmi < 30:
        return "Overweight"
    return "Obesity"


def day_index_from_name(day_name: str) -> int:
    try:
        return DAY_NAMES.index(day_name)
    except ValueError:
        return 0


def meal_image_url(title: str) -> str:
    lowered = title.lower()
    if "salmon" in lowered or "shrimp" in lowered:
        return "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1200&q=80"
    if "chicken" in lowered or "turkey" in lowered:
        return "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=1200&q=80"
    if "yogurt" in lowered or "berries" in lowered:
        return "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1200&q=80"
    if "smoothie" in lowered:
        return "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=1200&q=80"
    if "tofu" in lowered or "vegan" in lowered:
        return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80"
    if "oats" in lowered or "breakfast" in lowered:
        return "https://images.unsplash.com/photo-1517673400267-0251440c45dc?auto=format&fit=crop&w=1200&q=80"
    return "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=1200&q=80"


def meal_timing(meal_name: str, training_kind: str) -> tuple[str, str]:
    if meal_name == "Breakfast":
        return "07:30", "Breakfast"
    if meal_name == "Lunch":
        return "13:00", "Main meal"
    if meal_name == "Dinner":
        return ("20:00", "Post-workout dinner") if training_kind == "training" else ("19:30", "Dinner")
    if meal_name == "Snack":
        return ("16:30", "Pre-workout snack") if training_kind == "training" else ("16:00", "Snack")
    return ("21:30", "Evening snack") if training_kind == "training" else ("21:00", "Snack")


def workout_window(template_kind: str, index: int) -> str:
    if template_kind == "training":
        return "18:00" if index % 2 == 0 else "17:30"
    return "08:00"


def meal_macros(meal_name: str, calories: int) -> tuple[int, int, int]:
    if meal_name == "Breakfast":
        protein = max(24, round(calories * 0.28 / 4))
        carbs = max(28, round(calories * 0.42 / 4))
    elif meal_name.startswith("Snack"):
        protein = max(12, round(calories * 0.26 / 4))
        carbs = max(14, round(calories * 0.34 / 4))
    elif meal_name == "Lunch":
        protein = max(30, round(calories * 0.3 / 4))
        carbs = max(34, round(calories * 0.4 / 4))
    else:
        protein = max(28, round(calories * 0.31 / 4))
        carbs = max(20, round(calories * 0.3 / 4))
    fats = max(8, round((calories - (protein * 4 + carbs * 4)) / 9))
    return protein, carbs, fats


def meal_recipe(
    meal_name: str, protein: str, carb: str, vegetable: str, fat: str, snack: str
) -> tuple[list[str], list[str], int]:
    if meal_name == "Breakfast":
        ingredients = [f"160 g {protein}", f"80 g {carb}", f"12 g {fat}", "80 g berries", "2 g cinnamon"]
        steps = [
            f"Cook the {carb} until soft and warm.",
            f"Prepare the {protein} and layer it over the bowl.",
            f"Finish with {fat}, berries, and cinnamon before serving.",
        ]
        return ingredients, steps, 15
    if meal_name.startswith("Snack"):
        ingredients = [f"1 serving {snack}", "120 g fruit", "250 ml water or milk"]
        steps = [
            f"Prepare the {snack} portion.",
            "Pair it with fruit or a light drink.",
            "Use this as a quick recovery or pre-workout snack.",
        ]
        return ingredients, steps, 5
    if meal_name == "Lunch":
        ingredients = [f"180 g {protein}", f"110 g {carb}", f"140 g {vegetable}", f"10 g {fat}", "5 g herbs"]
        steps = [
            f"Cook the {protein} with herbs and light seasoning.",
            f"Prepare the {carb} and steam or roast the {vegetable}.",
            f"Plate everything together and finish with {fat}.",
        ]
        return ingredients, steps, 25
    ingredients = [f"190 g {protein}", f"90 g {carb}", f"140 g {vegetable}", f"10 g {fat}", "10 g lemon or herbs"]
    steps = [
        f"Cook the {protein} until tender and well seasoned.",
        f"Prepare the {carb} and soften the {vegetable}.",
        f"Serve together with {fat} for a calmer high-protein dinner.",
    ]
    return ingredients, steps, 30


def build_meal_entry(
    meal_name: str,
    profile: dict[str, Any],
    total_calories: int,
    ratio: float,
    day_index: int,
    training_kind: str,
) -> dict[str, Any]:
    style = profile["dietaryStyle"]
    likes = profile["likes"]
    blocked = profile["dislikes"] + profile["allergies"]
    proteins = PROTEIN_OPTIONS[style]
    carbs = CARB_OPTIONS["low_carb"] if style == "low_carb" else CARB_OPTIONS["default"]
    snack_choices = SNACK_OPTIONS[style]

    protein = filtered_candidates(proteins, likes, blocked, day_index)
    carb = filtered_candidates(carbs, likes, blocked, day_index + 1)
    vegetable = filtered_candidates(VEGETABLE_OPTIONS, likes, blocked, day_index + 2)
    fat = filtered_candidates(FAT_OPTIONS, likes, blocked, day_index + 3)
    snack = filtered_candidates(snack_choices, likes, blocked, day_index + 4)
    calories = int(round(total_calories * ratio / 10.0) * 10)

    if meal_name == "Breakfast":
        title = f"{protein.title()} breakfast bowl with {carb} and {fat}"
        summary = "Front-load protein and fiber to manage appetite across the day."
    elif meal_name.startswith("Snack"):
        title = snack.capitalize()
        summary = "Small recovery-focused snack to keep energy stable between meals."
    elif meal_name == "Lunch":
        title = f"{protein.title()} power bowl with {carb} and {vegetable}"
        summary = "Balanced midday meal with enough carbs for training energy."
    else:
        title = f"{protein.title()} with {carb} and {vegetable}"
        summary = "High-satiety dinner with protein, produce, and controlled portions."

    time_label, timing_context = meal_timing(meal_name, training_kind)
    protein_grams, carbs_grams, fats_grams = meal_macros(meal_name, calories)
    ingredients, steps, cook_time_minutes = meal_recipe(
        meal_name, protein, carb, vegetable, fat, snack
    )

    return {
        "name": meal_name,
        "title": title,
        "calories": calories,
        "summary": summary,
        "timeLabel": time_label,
        "timingContext": timing_context,
        "imageUrl": meal_image_url(title),
        "proteinGrams": protein_grams,
        "carbsGrams": carbs_grams,
        "fatsGrams": fats_grams,
        "cookTimeMinutes": cook_time_minutes,
        "ingredients": ingredients,
        "steps": steps,
    }


def build_meal_plan(
    profile: dict[str, Any], total_calories: int, workout_plan: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    distribution = calorie_distribution(profile["mealsPerDay"])
    plan = []
    for day_index, day_name in enumerate(DAY_NAMES):
        training_kind = workout_plan[day_index]["kind"] if day_index < len(workout_plan) else "recovery"
        meals = [
            build_meal_entry(
                meal_name,
                profile,
                total_calories,
                ratio,
                day_index + index,
                training_kind,
            )
            for index, (meal_name, ratio) in enumerate(distribution)
        ]
        plan.append({"day": day_name, "totalCalories": total_calories, "meals": meals})
    return plan


def base_workout_templates(goal: str) -> list[str]:
    if goal == "lose":
        return [
            "full_body",
            "interval_cardio",
            "mobility",
            "lower_strength",
            "steady_cardio",
            "upper_strength",
            "recovery_walk",
        ]
    if goal == "gain":
        return [
            "upper_strength",
            "lower_strength",
            "mobility",
            "hypertrophy_push_pull",
            "recovery_walk",
            "legs_core",
            "recovery_walk",
        ]
    return [
        "upper_strength",
        "mobility",
        "lower_strength",
        "conditioning",
        "recovery_walk",
        "full_body",
        "recovery_walk",
    ]


def build_workout_plan(profile: dict[str, Any]) -> list[dict[str, Any]]:
    template_names = base_workout_templates(profile["goal"])
    structured_days = max(1, min(profile["workoutsPerWeek"], 7))
    used_training_days = 0
    plan = []

    for day_name, template_name in zip(DAY_NAMES, template_names):
        template = EXERCISE_LIBRARY[template_name]
        if template["kind"] == "training":
            if used_training_days >= structured_days:
                template = EXERCISE_LIBRARY["recovery_walk"]
            else:
                used_training_days += 1

        duration = template["duration"]
        if profile["activityLevel"] in {"sedentary", "light"} and template["kind"] == "training":
            duration = max(30, duration - 5)
        elif profile["activityLevel"] == "very_active" and template["kind"] == "training":
            duration += 5

        plan.append(
            {
                "day": day_name,
                "kind": template["kind"],
                "focus": template["focus"],
                "durationMinutes": duration,
                "intensity": template["intensity"],
                "exercises": template["exercises"],
                "note": template["note"],
                "suggestedWindow": workout_window(template["kind"], len(plan)),
            }
        )

    return plan


def merge_ai_enhancement(
    parsed: dict[str, Any], meal_plan: list[dict[str, Any]], workout_plan: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ai_meals = parsed.get("mealPlan")
    ai_meal_guidance = parsed.get("mealGuidance")
    ai_workouts = parsed.get("workoutPlan")
    if not isinstance(ai_workouts, list):
        return meal_plan, workout_plan

    if isinstance(ai_meals, list):
        enhanced_meals = []
        for day_index, day in enumerate(meal_plan):
            ai_day = ai_meals[day_index] if day_index < len(ai_meals) and isinstance(ai_meals[day_index], dict) else {}
            ai_entries = ai_day.get("meals") if isinstance(ai_day.get("meals"), list) else []
            merged_entries = []
            for meal_index, meal in enumerate(day["meals"]):
                ai_meal = ai_entries[meal_index] if meal_index < len(ai_entries) and isinstance(ai_entries[meal_index], dict) else {}
                title = normalize_text(ai_meal.get("title")) or meal["title"]
                merged_entries.append(
                    {
                        **meal,
                        "title": title,
                        "summary": normalize_text(ai_meal.get("summary")) or meal["summary"],
                        "timeLabel": normalize_text(ai_meal.get("timeLabel")) or meal["timeLabel"],
                        "timingContext": normalize_text(ai_meal.get("timingContext")) or meal["timingContext"],
                        "imageUrl": meal_image_url(title),
                    }
                )
            enhanced_meals.append({**day, "meals": merged_entries})
    elif isinstance(ai_meal_guidance, dict):
        enhanced_meals = []
        for day in meal_plan:
            merged_entries = []
            for meal in day["meals"]:
                guidance = ai_meal_guidance.get(meal["name"])
                if not isinstance(guidance, dict) and meal["name"].startswith("Snack"):
                    guidance = ai_meal_guidance.get("Snack")
                guidance = guidance if isinstance(guidance, dict) else {}
                merged_entries.append(
                    {
                        **meal,
                        "summary": normalize_text(guidance.get("summary")) or meal["summary"],
                        "timingContext": normalize_text(guidance.get("timingContext")) or meal["timingContext"],
                    }
                )
            enhanced_meals.append({**day, "meals": merged_entries})
    else:
        return meal_plan, workout_plan

    enhanced_workouts = []
    for day_index, workout in enumerate(workout_plan):
        ai_workout = ai_workouts[day_index] if day_index < len(ai_workouts) and isinstance(ai_workouts[day_index], dict) else {}
        enhanced_workouts.append(
            {
                **workout,
                "focus": normalize_text(ai_workout.get("focus")) or workout["focus"],
                "note": normalize_text(ai_workout.get("note")) or workout["note"],
                "suggestedWindow": normalize_text(ai_workout.get("suggestedWindow")) or workout["suggestedWindow"],
            }
        )
    return enhanced_meals, enhanced_workouts


def ai_meta(provider: str, model: str | None, applied: bool, changed: bool) -> dict[str, Any]:
    return {
        "provider": provider,
        "model": model,
        "applied": applied,
        "changed": changed,
    }


def compact_profile_for_ai(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "age": profile.get("age"),
        "sex": profile.get("sex"),
        "heightCm": profile.get("heightCm"),
        "weightKg": profile.get("weightKg"),
        "goal": profile.get("goal"),
        "activityLevel": profile.get("activityLevel"),
        "workoutsPerWeek": profile.get("workoutsPerWeek"),
        "dailyCalorieTarget": profile.get("dailyCalorieTarget"),
        "mealsPerDay": profile.get("mealsPerDay"),
        "dietaryStyle": profile.get("dietaryStyle"),
        "likes": profile.get("likes", []),
        "dislikes": profile.get("dislikes", []),
        "allergies": profile.get("allergies", []),
        "notes": profile.get("notes", ""),
    }


def compact_summary_for_ai(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "bmi": summary.get("bmi"),
        "bmiCategory": summary.get("bmiCategory"),
        "maintenanceCalories": summary.get("maintenanceCalories"),
        "recommendedCalories": summary.get("recommendedCalories"),
        "calorieTarget": summary.get("calorieTarget"),
        "proteinGrams": summary.get("proteinGrams"),
        "waterLiters": summary.get("waterLiters"),
    }


def compact_meal_plan_for_ai(meal_plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact_days: list[dict[str, Any]] = []
    for day in meal_plan:
        compact_days.append(
            {
                "day": day["day"],
                "meals": [
                    {
                        "name": meal["name"],
                        "title": meal["title"],
                        "summary": meal["summary"],
                        "timeLabel": meal["timeLabel"],
                        "timingContext": meal["timingContext"],
                    }
                    for meal in day["meals"]
                ],
            }
        )
    return compact_days


def compact_workout_plan_for_ai(workout_plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "day": workout["day"],
            "kind": workout["kind"],
            "focus": workout["focus"],
            "note": workout["note"],
            "suggestedWindow": workout["suggestedWindow"],
        }
        for workout in workout_plan
    ]


def meal_slot_names(meal_plan: list[dict[str, Any]]) -> list[str]:
    if not meal_plan:
        return []
    return [normalize_text(meal["name"]) for meal in meal_plan[0]["meals"] if normalize_text(meal["name"])]


def current_meal_guidance_for_ai(meal_plan: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    guidance: dict[str, dict[str, str]] = {}
    for day in meal_plan:
        for meal in day["meals"]:
            name = normalize_text(meal["name"])
            if name and name not in guidance:
                guidance[name] = {
                    "summary": meal["summary"],
                    "timingContext": meal["timingContext"],
                }
    return guidance


def build_ollama_enhancement_schema(meal_slots: list[str], workout_count: int) -> dict[str, Any]:
    meal_guidance_properties = {
        meal_slot: {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "timingContext": {"type": "string"},
            },
            "required": ["summary", "timingContext"],
            "additionalProperties": False,
        }
        for meal_slot in meal_slots
    }

    return {
        "type": "object",
        "properties": {
            "mealGuidance": {
                "type": "object",
                "properties": meal_guidance_properties,
                "required": meal_slots,
                "additionalProperties": False,
            },
            "workoutPlan": {
                "type": "array",
                "minItems": workout_count,
                "maxItems": workout_count,
                "items": {
                    "type": "object",
                    "properties": {
                        "focus": {"type": "string"},
                        "note": {"type": "string"},
                        "suggestedWindow": {"type": "string"},
                    },
                    "required": ["focus", "note", "suggestedWindow"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["mealGuidance", "workoutPlan"],
        "additionalProperties": False,
    }


def parse_ai_json_content(raw_content: Any) -> dict[str, Any] | None:
    if not isinstance(raw_content, str):
        return None

    content = raw_content.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        content = "\n".join(lines).strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def try_ollama_enhancement(
    profile: dict[str, Any], summary: dict[str, Any], meal_plan: list[dict[str, Any]], workout_plan: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if os.environ.get("OLLAMA_ENABLED", "1") != "1":
        return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)

    base_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "deepseek-r1:1.5b")
    timeout_seconds = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "120"))
    meal_slots = meal_slot_names(meal_plan)
    if not meal_slots:
        return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)

    response_schema = build_ollama_enhancement_schema(meal_slots, len(workout_plan))
    compact_workout_plan = compact_workout_plan_for_ai(workout_plan)
    payload = {
        "model": model,
        "stream": False,
        "format": response_schema,
        "think": False,
        "options": {"temperature": 0},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a precise nutrition and training planner. "
                    "Return valid JSON matching the response schema only. "
                    "Rewrite the meal guidance and workout notes in fresh wording. "
                    "Keep each field concise, realistic, and helpful."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "profile": compact_profile_for_ai(profile),
                        "summary": compact_summary_for_ai(summary),
                        "mealSlots": meal_slots,
                        "currentMealGuidance": current_meal_guidance_for_ai(meal_plan),
                        "workoutPlan": compact_workout_plan,
                        "rules": [
                            "Keep allergies and dislikes out.",
                            "Keep the same meal slot order and the same number of workout days.",
                            "Do not reuse the exact current wording when a better phrasing is possible.",
                            "Meal guidance should stay generic enough to fit every day for that meal slot.",
                            "Workout entries must include focus, note, and suggestedWindow only.",
                        ],
                    }
                ),
            },
        ],
    }

    request_obj = urllib.request.Request(
        f"{base_url}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout_seconds) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
        parsed = parse_ai_json_content(response_payload.get("message", {}).get("content"))
        if parsed is None:
            return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)
    except Exception:
        return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)

    enhanced_meals, enhanced_workouts = merge_ai_enhancement(parsed, meal_plan, workout_plan)
    return enhanced_meals, enhanced_workouts, ai_meta(
        "ollama", model, True, enhanced_meals != meal_plan or enhanced_workouts != workout_plan
    )


def try_openai_enhancement(
    profile: dict[str, Any], summary: dict[str, Any], meal_plan: list[dict[str, Any]], workout_plan: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    compact_meal_plan = compact_meal_plan_for_ai(meal_plan)
    compact_workout_plan = compact_workout_plan_for_ai(workout_plan)
    payload = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a precise nutrition and training planner. "
                    "Return valid JSON only with keys mealPlan and workoutPlan. "
                    "Keep the same number of days and meal slots. "
                    "Do not add extra commentary. "
                    "For mealPlan, each day must include day and meals, and each meal must only include "
                    "title, summary, timeLabel, timingContext. "
                    "For workoutPlan, each entry must only include focus, note, suggestedWindow."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "profile": compact_profile_for_ai(profile),
                        "summary": compact_summary_for_ai(summary),
                        "mealPlan": compact_meal_plan,
                        "workoutPlan": compact_workout_plan,
                        "rules": [
                            "Keep the same number of days and meal slots.",
                            "Keep allergies and dislikes out.",
                            "Keep titles realistic and professional.",
                            "Meal entries must include title, summary, timeLabel, timingContext.",
                            "Workout entries must include focus, note, suggestedWindow.",
                        ],
                    }
                ),
            },
        ],
    }

    request_data = json.dumps(payload).encode("utf-8")
    request_obj = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=request_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=18) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
        parsed = parse_ai_json_content(response_payload["choices"][0]["message"]["content"])
        if parsed is None:
            return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)
    except Exception:
        return meal_plan, workout_plan, ai_meta("rule_based", None, False, False)

    enhanced_meals, enhanced_workouts = merge_ai_enhancement(parsed, meal_plan, workout_plan)
    return enhanced_meals, enhanced_workouts, ai_meta(
        "openai", model, True, enhanced_meals != meal_plan or enhanced_workouts != workout_plan
    )


def try_ai_enhancement(
    profile: dict[str, Any], summary: dict[str, Any], meal_plan: list[dict[str, Any]], workout_plan: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    ollama_meals, ollama_workouts, ollama_meta = try_ollama_enhancement(
        profile, summary, meal_plan, workout_plan
    )
    if ollama_meta["applied"]:
        return ollama_meals, ollama_workouts, ollama_meta
    return try_openai_enhancement(profile, summary, meal_plan, workout_plan)


def build_progress_snapshot(user_id: int, calorie_target: int) -> dict[str, Any]:
    connection = get_db()
    meal_rows = connection.execute(
        """
        SELECT log_date, meal_day, meal_name, calories
        FROM meal_logs
        WHERE user_id = ?
        ORDER BY log_date DESC, created_at DESC
        """,
        (user_id,),
    ).fetchall()
    workout_rows = connection.execute(
        """
        SELECT log_date, workout_day, focus
        FROM workout_logs
        WHERE user_id = ?
        ORDER BY log_date DESC, created_at DESC
        """,
        (user_id,),
    ).fetchall()
    water_rows = connection.execute(
        """
        SELECT log_date, amount_ml
        FROM water_logs
        WHERE user_id = ?
        ORDER BY log_date DESC, created_at DESC
        """,
        (user_id,),
    ).fetchall()

    today = today_iso()
    today_calories = sum(int(row["calories"]) for row in meal_rows if row["log_date"] == today)
    today_water_ml = sum(int(row["amount_ml"]) for row in water_rows if row["log_date"] == today)
    completed_meals = [f'{row["meal_day"]}|{row["meal_name"]}|{row["log_date"]}' for row in meal_rows]
    completed_workouts = [f'{row["workout_day"]}|{row["focus"]}|{row["log_date"]}' for row in workout_rows]

    workout_dates = sorted({row["log_date"] for row in workout_rows}, reverse=True)
    streak = 0
    expected = datetime.now().date()
    for raw_date in workout_dates:
        logged_date = datetime.fromisoformat(raw_date).date()
        if logged_date == expected:
            streak += 1
            expected = expected.fromordinal(expected.toordinal() - 1)
        elif logged_date < expected:
            break

    return {
        "todayCalories": today_calories,
        "todayWaterMl": today_water_ml,
        "caloriePercent": min(100, int(round((today_calories / max(calorie_target, 1)) * 100))),
        "completedMeals": completed_meals,
        "completedWorkouts": completed_workouts,
        "workoutStreak": streak,
        "completedWorkoutsCount": len(completed_workouts),
    }


def build_summary(profile: dict[str, Any]) -> dict[str, Any]:
    weight_kg = float(profile["weightKg"])
    height_cm = float(profile["heightCm"])
    age = int(profile["age"])

    bmi = weight_kg / ((height_cm / 100) ** 2)
    sex_bias = {"male": 5, "female": -161, "other": -78}[profile["sex"]]
    bmr = int(round(10 * weight_kg + 6.25 * height_cm - 5 * age + sex_bias))
    maintenance = int(round(bmr * ACTIVITY_FACTORS[profile["activityLevel"]]))
    recommended = maintenance + GOAL_ADJUSTMENTS[profile["goal"]]
    calorie_target = profile["dailyCalorieTarget"] or recommended
    protein_grams = int(round(weight_kg * PROTEIN_FACTORS[profile["goal"]]))
    activity_bonus = (
        0.25
        if profile["activityLevel"] == "active"
        else 0.45 if profile["activityLevel"] == "very_active" else 0.1
    )
    workout_bonus = max(0, int(profile["workoutsPerWeek"]) - 3) * 0.08
    water_liters = round(max(2.2, weight_kg * 0.033 + activity_bonus + workout_bonus), 1)

    return {
        "bmi": round(bmi, 1),
        "bmiCategory": bmi_category(bmi),
        "bmr": bmr,
        "maintenanceCalories": maintenance,
        "recommendedCalories": recommended,
        "calorieTarget": calorie_target,
        "calorieSource": "custom" if profile["dailyCalorieTarget"] else "calculated",
        "proteinGrams": protein_grams,
        "waterLiters": water_liters,
    }


def build_plan_response(user: sqlite3.Row, profile_row: sqlite3.Row, use_ai: bool = False) -> dict[str, Any]:
    profile = serialize_profile(profile_row)
    summary = build_summary(profile)
    calorie_target = summary["calorieTarget"]
    cache_key = f'{user["id"]}:{profile["updatedAt"]}'
    workout_plan = build_workout_plan(profile)
    meal_plan = build_meal_plan(profile, calorie_target, workout_plan)
    ai_details = ai_meta("rule_based", None, False, False)

    if use_ai:
        meal_plan, workout_plan, ai_details = try_ai_enhancement(profile, summary, meal_plan, workout_plan)
        AI_PLAN_CACHE[cache_key] = (meal_plan, workout_plan, ai_details)
    elif cache_key in AI_PLAN_CACHE:
        meal_plan, workout_plan, ai_details = AI_PLAN_CACHE[cache_key]

    return {
        "user": serialize_user(user),
        "profile": profile,
        "summary": summary,
        "aiMeta": ai_details,
        "progress": build_progress_snapshot(user["id"], calorie_target),
        "workoutPlan": workout_plan,
        "mealPlan": meal_plan,
    }


def validate_signup_payload(payload: dict[str, Any]) -> dict[str, str]:
    full_name = normalize_text(payload.get("fullName"))
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    if len(full_name) < 2:
        raise ValueError("Full name must contain at least 2 characters.")
    if not EMAIL_RE.match(email):
        raise ValueError("Enter a valid email address.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")

    return {"full_name": full_name, "email": email, "password": password}


def validate_profile_payload(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        age = int(payload.get("age"))
        height_cm = float(payload.get("heightCm"))
        weight_kg = float(payload.get("weightKg"))
        workouts_per_week = int(payload.get("workoutsPerWeek"))
        meals_per_day = int(payload.get("mealsPerDay"))
    except (TypeError, ValueError):
        raise ValueError("Age, height, weight, workout days, and meals per day must be numeric.")

    sex = normalize_text(payload.get("sex")).lower()
    goal = normalize_text(payload.get("goal")).lower()
    activity_level = normalize_text(payload.get("activityLevel")).lower()
    dietary_style = normalize_text(payload.get("dietaryStyle")).lower()
    notes = str(payload.get("notes") or "").strip()
    calorie_target_raw = payload.get("dailyCalorieTarget")
    daily_calorie_target = None

    if calorie_target_raw not in (None, "", "null"):
        try:
            daily_calorie_target = int(calorie_target_raw)
        except (TypeError, ValueError):
            raise ValueError("Daily calorie target must be a valid number.")

    if age < 13 or age > 90:
        raise ValueError("Age must be between 13 and 90.")
    if height_cm < 120 or height_cm > 230:
        raise ValueError("Height must be between 120 cm and 230 cm.")
    if weight_kg < 35 or weight_kg > 250:
        raise ValueError("Weight must be between 35 kg and 250 kg.")
    if sex not in SEXES:
        raise ValueError("Choose male, female, or other.")
    if goal not in GOAL_ADJUSTMENTS:
        raise ValueError("Goal must be lose, maintain, or gain.")
    if activity_level not in ACTIVITY_FACTORS:
        raise ValueError("Choose a valid activity level.")
    if workouts_per_week < 1 or workouts_per_week > 7:
        raise ValueError("Workouts per week must be between 1 and 7.")
    if meals_per_day < 3 or meals_per_day > 5:
        raise ValueError("Meals per day must be between 3 and 5.")
    if dietary_style not in DIETARY_STYLES:
        raise ValueError("Choose a valid dietary style.")
    if daily_calorie_target is not None and (
        daily_calorie_target < 1200 or daily_calorie_target > 4500
    ):
        raise ValueError("Daily calorie target must be between 1200 and 4500.")
    if len(notes) > 500:
        raise ValueError("Notes are limited to 500 characters.")

    return {
        "age": age,
        "sex": sex,
        "height_cm": height_cm,
        "weight_kg": weight_kg,
        "goal": goal,
        "activity_level": activity_level,
        "workouts_per_week": workouts_per_week,
        "daily_calorie_target": daily_calorie_target,
        "meals_per_day": meals_per_day,
        "dietary_style": dietary_style,
        "likes": json.dumps(parse_list_field(payload.get("likes"))),
        "dislikes": json.dumps(parse_list_field(payload.get("dislikes"))),
        "allergies": json.dumps(parse_list_field(payload.get("allergies"))),
        "notes": notes,
        "updated_at": utc_now(),
    }


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
    return response


@app.route("/api/<path:_path>", methods=["OPTIONS"])
def options_handler(_path: str):
    return ("", 204)


@app.route("/")
def root():
    return jsonify(
        {
            "message": "DietTricks backend API",
            "health": "http://127.0.0.1:5002/api/health",
            "frontend": "Use the Vite frontend on http://localhost:5173",
        }
    )


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "DietTricks API", "database": DB_PATH.name})


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    payload = json_payload()
    try:
        data = validate_signup_payload(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if fetch_user_by_email(data["email"]) is not None:
        return jsonify({"error": "An account with this email already exists."}), 409

    connection = get_db()
    cursor = connection.execute(
        """
        INSERT INTO users (full_name, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            data["full_name"],
            data["email"],
            generate_password_hash(data["password"]),
            utc_now(),
        ),
    )
    connection.commit()

    user = fetch_user_by_id(int(cursor.lastrowid))
    assert user is not None

    return (
        jsonify(
            {
                "token": issue_token(user["id"]),
                "user": serialize_user(user),
                "profile": None,
                "plan": None,
            }
        ),
        201,
    )


@app.route("/api/auth/login", methods=["POST"])
def login():
    payload = json_payload()
    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    user = fetch_user_by_email(email)
    if user is None or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    profile_row = fetch_profile(user["id"])
    return jsonify(
        {
            "token": issue_token(user["id"]),
            "user": serialize_user(user),
            "profile": serialize_profile(profile_row) if profile_row is not None else None,
            "plan": build_plan_response(user, profile_row) if profile_row is not None else None,
        }
    )


@app.route("/api/me")
def me():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    profile_row = fetch_profile(user["id"])
    return jsonify(
        {
            "user": serialize_user(user),
            "profile": serialize_profile(profile_row) if profile_row is not None else None,
            "plan": build_plan_response(user, profile_row) if profile_row is not None else None,
        }
    )


@app.route("/api/profile", methods=["PUT"])
def upsert_profile():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    try:
        data = validate_profile_payload(json_payload())
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    connection = get_db()
    connection.execute(
        """
        INSERT INTO profiles (
            user_id, age, sex, height_cm, weight_kg, goal, activity_level,
            workouts_per_week, daily_calorie_target, meals_per_day, dietary_style,
            likes, dislikes, allergies, notes, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            age = excluded.age,
            sex = excluded.sex,
            height_cm = excluded.height_cm,
            weight_kg = excluded.weight_kg,
            goal = excluded.goal,
            activity_level = excluded.activity_level,
            workouts_per_week = excluded.workouts_per_week,
            daily_calorie_target = excluded.daily_calorie_target,
            meals_per_day = excluded.meals_per_day,
            dietary_style = excluded.dietary_style,
            likes = excluded.likes,
            dislikes = excluded.dislikes,
            allergies = excluded.allergies,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        """,
        (
            user["id"],
            data["age"],
            data["sex"],
            data["height_cm"],
            data["weight_kg"],
            data["goal"],
            data["activity_level"],
            data["workouts_per_week"],
            data["daily_calorie_target"],
            data["meals_per_day"],
            data["dietary_style"],
            data["likes"],
            data["dislikes"],
            data["allergies"],
            data["notes"],
            data["updated_at"],
        ),
    )
    connection.commit()

    profile_row = fetch_profile(user["id"])
    assert profile_row is not None

    return jsonify(
        {
            "message": "Profile saved. Your weekly plan has been updated.",
            "plan": build_plan_response(user, profile_row, use_ai=True),
        }
    )


@app.route("/api/plan")
def plan():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    profile_row = fetch_profile(user["id"])
    if profile_row is None:
        return jsonify({"error": "Complete your intake profile first."}), 404

    return jsonify(build_plan_response(user, profile_row))


@app.route("/api/progress/meals", methods=["POST"])
def log_meal():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    payload = json_payload()
    meal_day = normalize_text(payload.get("day"))
    meal_name = normalize_text(payload.get("mealName"))
    meal_title = normalize_text(payload.get("title"))
    try:
        calories = int(payload.get("calories"))
    except (TypeError, ValueError):
        return jsonify({"error": "Calories must be numeric."}), 400

    if meal_day not in DAY_NAMES or not meal_name or not meal_title:
        return jsonify({"error": "Meal day, meal slot, and title are required."}), 400

    connection = get_db()
    connection.execute(
        """
        INSERT INTO meal_logs (user_id, log_date, meal_day, meal_name, meal_title, calories, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, log_date, meal_day, meal_name) DO UPDATE SET
            meal_title = excluded.meal_title,
            calories = excluded.calories,
            created_at = excluded.created_at
        """,
        (user["id"], today_iso(), meal_day, meal_name, meal_title, calories, utc_now()),
    )
    connection.commit()

    profile_row = fetch_profile(user["id"])
    if profile_row is None:
        return jsonify({"error": "Complete your intake profile first."}), 404

    plan_payload = build_plan_response(user, profile_row)
    return jsonify({"message": "Meal logged.", "progress": plan_payload["progress"]})


@app.route("/api/progress/workouts", methods=["POST"])
def complete_workout():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    payload = json_payload()
    workout_day = normalize_text(payload.get("day"))
    focus = normalize_text(payload.get("focus"))
    if workout_day not in DAY_NAMES or not focus:
        return jsonify({"error": "Workout day and focus are required."}), 400
    if workout_day != current_day_name():
        return jsonify({"error": f"You can only finish the workout scheduled for {current_day_name()}."}), 400

    connection = get_db()
    connection.execute(
        """
        INSERT INTO workout_logs (user_id, log_date, workout_day, focus, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, log_date, workout_day, focus) DO UPDATE SET
            created_at = excluded.created_at
        """,
        (user["id"], today_iso(), workout_day, focus, utc_now()),
    )
    connection.commit()

    profile_row = fetch_profile(user["id"])
    if profile_row is None:
        return jsonify({"error": "Complete your intake profile first."}), 404

    plan_payload = build_plan_response(user, profile_row)
    return jsonify({"message": "Workout completed.", "progress": plan_payload["progress"]})


@app.route("/api/progress/water", methods=["POST"])
def log_water():
    user = current_user()
    if user is None:
        return jsonify({"error": "Authentication required."}), 401

    payload = json_payload()
    try:
        amount_ml = int(payload.get("amountMl"))
    except (TypeError, ValueError):
        return jsonify({"error": "Water amount must be numeric."}), 400

    if amount_ml < 50 or amount_ml > 2000:
        return jsonify({"error": "Water amount must be between 50 ml and 2000 ml."}), 400

    connection = get_db()
    connection.execute(
        """
        INSERT INTO water_logs (user_id, log_date, amount_ml, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (user["id"], today_iso(), amount_ml, utc_now()),
    )
    connection.commit()

    profile_row = fetch_profile(user["id"])
    if profile_row is None:
        return jsonify({"error": "Complete your intake profile first."}), 404

    plan_payload = build_plan_response(user, profile_row)
    return jsonify({"message": "Water logged.", "progress": plan_payload["progress"]})


init_db()


if __name__ == "__main__":
    debug_enabled = os.environ.get("NUTRIPLAN_DEBUG", "1") == "1"
    app.run(debug=debug_enabled, use_reloader=False, port=5002)
