from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "nutriplan.db"
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


def get_db() -> sqlite3.Connection:
    connection = g.get("db")
    if connection is None:
        connection = sqlite3.connect(DB_PATH)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        g.db = connection
    return connection


@app.teardown_appcontext
def close_db(_error: BaseException | None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db() -> None:
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
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


def build_meal_entry(
    meal_name: str,
    profile: dict[str, Any],
    total_calories: int,
    ratio: float,
    day_index: int,
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

    return {
        "name": meal_name,
        "title": title,
        "calories": calories,
        "summary": summary,
    }


def build_meal_plan(profile: dict[str, Any], total_calories: int) -> list[dict[str, Any]]:
    distribution = calorie_distribution(profile["mealsPerDay"])
    plan = []
    for day_index, day_name in enumerate(DAY_NAMES):
        meals = [
            build_meal_entry(meal_name, profile, total_calories, ratio, day_index + index)
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
                "focus": template["focus"],
                "durationMinutes": duration,
                "intensity": template["intensity"],
                "exercises": template["exercises"],
                "note": template["note"],
            }
        )

    return plan


def build_plan_response(user: sqlite3.Row, profile_row: sqlite3.Row) -> dict[str, Any]:
    profile = serialize_profile(profile_row)
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
    water_liters = round(max(2.2, weight_kg * 0.033), 1)

    return {
        "user": serialize_user(user),
        "profile": profile,
        "summary": {
            "bmi": round(bmi, 1),
            "bmiCategory": bmi_category(bmi),
            "bmr": bmr,
            "maintenanceCalories": maintenance,
            "recommendedCalories": recommended,
            "calorieTarget": calorie_target,
            "calorieSource": "custom" if profile["dailyCalorieTarget"] else "calculated",
            "proteinGrams": protein_grams,
            "waterLiters": water_liters,
        },
        "workoutPlan": build_workout_plan(profile),
        "mealPlan": build_meal_plan(profile, calorie_target),
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
            "message": "NutriPlan backend API",
            "health": "http://127.0.0.1:5002/api/health",
            "frontend": "Use the Vite frontend on http://localhost:5173",
        }
    )


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "service": "NutriPlan API", "database": DB_PATH.name})


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
            "plan": build_plan_response(user, profile_row),
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


init_db()


if __name__ == "__main__":
    app.run(debug=True, port=5002)
