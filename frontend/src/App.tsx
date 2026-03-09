import {
  type CSSProperties,
  type FormEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import { apiRequest } from "./api";
import type {
  ActivityLevel,
  AuthResponse,
  BiologicalSex,
  DietaryStyle,
  Goal,
  MeResponse,
  MealDay,
  PlanResponse,
  Profile,
  ProgressSnapshot,
  StoredSession,
  Summary,
  User,
  WorkoutDay,
} from "./types";

const STORAGE_KEY = "diettricks-session";
const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  lose: -350,
  maintain: 0,
  gain: 250,
};
const PROTEIN_FACTORS: Record<Goal, number> = {
  lose: 1.8,
  maintain: 1.6,
  gain: 2,
};
const GOAL_LABELS: Record<Goal, string> = {
  lose: "Cut phase",
  maintain: "Performance balance",
  gain: "Muscle build",
};
const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  active: "Active",
  very_active: "Very active",
};
const DIET_STYLE_LABELS: Record<DietaryStyle, string> = {
  balanced: "Balanced",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  high_protein: "High protein",
  low_carb: "Low carb",
};
const AUTH_COPY = {
  title: "Welcome in, build a plan that looks coached.",
  body:
    "DietTricks gives you one calm place for nutrition, workouts, and profile setup. Start with account access, then move into a cleaner guided flow.",
};
const USER_ICON_PNG = "https://img.icons8.com/ios-filled/100/8a6b2f/user-male-circle.png";
const LOADING_LINES = [
  "We are generating the best program for you.",
  "Your health over anything.",
  "Workout is a way of life.",
  "Balancing meals, recovery, and training.",
];
const TRAINING_GALLERY = [
  {
    title: "Strength block",
    image:
      "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "Conditioning session",
    image:
      "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "Mobility reset",
    image:
      "https://images.unsplash.com/photo-1518611012118-fb2f7b8ca4a4?auto=format&fit=crop&w=1200&q=80",
  },
];

type DashboardTab = "dashboard" | "meals" | "training" | "profile";
type AuthMode = "login" | "signup";

interface SignupFormState {
  fullName: string;
  email: string;
  password: string;
}

interface LoginFormState {
  email: string;
  password: string;
}

interface ProfileFormState {
  age: string;
  sex: BiologicalSex;
  heightCm: string;
  weightKg: string;
  goal: Goal;
  activityLevel: ActivityLevel;
  workoutsPerWeek: string;
  dailyCalorieTarget: string;
  mealsPerDay: string;
  dietaryStyle: DietaryStyle;
  likes: string;
  dislikes: string;
  allergies: string;
  notes: string;
}

interface QuickMetricProps {
  label: string;
  value: string;
  note: string;
}

interface DayTabProps {
  day: string;
  active: boolean;
  onClick: () => void;
}

const initialSignupForm: SignupFormState = {
  fullName: "",
  email: "",
  password: "",
};

const initialLoginForm: LoginFormState = {
  email: "",
  password: "",
};

const initialProfileForm: ProfileFormState = {
  age: "24",
  sex: "female",
  heightCm: "168",
  weightKg: "64",
  goal: "maintain",
  activityLevel: "moderate",
  workoutsPerWeek: "4",
  dailyCalorieTarget: "",
  mealsPerDay: "4",
  dietaryStyle: "balanced",
  likes: "salmon, oats, berries",
  dislikes: "",
  allergies: "",
  notes: "",
};

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function profileToForm(profile: Profile | null): ProfileFormState {
  if (!profile) {
    return initialProfileForm;
  }

  return {
    age: String(profile.age),
    sex: profile.sex,
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    goal: profile.goal,
    activityLevel: profile.activityLevel,
    workoutsPerWeek: String(profile.workoutsPerWeek),
    dailyCalorieTarget: profile.dailyCalorieTarget ? String(profile.dailyCalorieTarget) : "",
    mealsPerDay: String(profile.mealsPerDay),
    dietaryStyle: profile.dietaryStyle,
    likes: profile.likes.join(", "),
    dislikes: profile.dislikes.join(", "),
    allergies: profile.allergies.join(", "),
    notes: profile.notes,
  };
}

function buildProfilePayload(form: ProfileFormState) {
  return {
    age: Number(form.age),
    sex: form.sex,
    heightCm: Number(form.heightCm),
    weightKg: Number(form.weightKg),
    goal: form.goal,
    activityLevel: form.activityLevel,
    workoutsPerWeek: Number(form.workoutsPerWeek),
    dailyCalorieTarget: form.dailyCalorieTarget ? Number(form.dailyCalorieTarget) : null,
    mealsPerDay: Number(form.mealsPerDay),
    dietaryStyle: form.dietaryStyle,
    likes: splitCsv(form.likes),
    dislikes: splitCsv(form.dislikes),
    allergies: splitCsv(form.allergies),
    notes: form.notes,
  };
}

function buildPreviewSummary(form: ProfileFormState): Summary {
  const age = clampNumber(Math.round(toNumber(form.age, 24)), 13, 90);
  const heightCm = clampNumber(toNumber(form.heightCm, 168), 120, 230);
  const weightKg = clampNumber(toNumber(form.weightKg, 64), 35, 250);
  const sexBias = form.sex === "male" ? 5 : form.sex === "female" ? -161 : -78;
  const bmi = weightKg / ((heightCm / 100) ** 2);
  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + sexBias);
  const maintenanceCalories = Math.round(bmr * ACTIVITY_FACTORS[form.activityLevel]);
  const recommendedCalories = maintenanceCalories + GOAL_ADJUSTMENTS[form.goal];
  const dailyCalorieTarget = form.dailyCalorieTarget
    ? clampNumber(Math.round(toNumber(form.dailyCalorieTarget, recommendedCalories)), 1200, 4500)
    : recommendedCalories;
  const proteinGrams = Math.round(weightKg * PROTEIN_FACTORS[form.goal]);
  const waterLiters = Number(
    Math.max(
      2.2,
      weightKg * 0.033 +
        (form.activityLevel === "active" ? 0.25 : form.activityLevel === "very_active" ? 0.45 : 0.1) +
        Math.max(0, toNumber(form.workoutsPerWeek, 4) - 3) * 0.08,
    ).toFixed(1),
  );

  return {
    bmi: Number(bmi.toFixed(1)),
    bmiCategory:
      bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy range" : bmi < 30 ? "Overweight" : "Obesity",
    bmr,
    maintenanceCalories,
    recommendedCalories,
    calorieTarget: dailyCalorieTarget,
    calorieSource: form.dailyCalorieTarget ? "custom" : "calculated",
    proteinGrams,
    waterLiters,
  };
}

function buildPreviewWorkoutPlan(form: ProfileFormState): WorkoutDay[] {
  const workoutCount = clampNumber(Math.round(toNumber(form.workoutsPerWeek, 4)), 1, 7);
  const sequences: Record<Goal, Array<Omit<WorkoutDay, "day">>> = {
    lose: [
      {
        kind: "training",
        focus: "Metabolic strength",
        durationMinutes: 48,
        intensity: "Medium",
        exercises: ["Squat + press circuit", "Rower intervals", "Core finish"],
        note: "Keep rest short and pace controlled.",
        suggestedWindow: "18:00",
      },
      {
        kind: "training",
        focus: "Intervals",
        durationMinutes: 34,
        intensity: "High",
        exercises: ["Warm-up walk", "10 fast rounds", "Cooldown mobility"],
        note: "Push on the work phases only.",
        suggestedWindow: "17:30",
      },
      {
        kind: "training",
        focus: "Lower body",
        durationMinutes: 50,
        intensity: "Medium",
        exercises: ["Goblet squats", "Romanian deadlifts", "Walking lunges"],
        note: "Prioritize range of motion over load.",
        suggestedWindow: "18:00",
      },
      {
        kind: "training",
        focus: "Upper body",
        durationMinutes: 45,
        intensity: "Medium",
        exercises: ["Bench press", "Cable rows", "Overhead press"],
        note: "Smooth reps and full recovery between sets.",
        suggestedWindow: "18:30",
      },
    ],
    maintain: [
      {
        kind: "training",
        focus: "Upper strength",
        durationMinutes: 46,
        intensity: "Medium",
        exercises: ["Bench press", "Seated cable row", "Face pulls"],
        note: "Stay two reps away from failure.",
        suggestedWindow: "18:00",
      },
      {
        kind: "recovery",
        focus: "Mobility and core",
        durationMinutes: 28,
        intensity: "Low",
        exercises: ["90-90 flow", "Thoracic rotations", "Dead bugs"],
        note: "Use this session to reset posture and hips.",
        suggestedWindow: "08:00",
      },
      {
        kind: "training",
        focus: "Lower strength",
        durationMinutes: 52,
        intensity: "Medium",
        exercises: ["Front squat", "Hip thrust", "Split squats"],
        note: "Slow eccentric, stable torso.",
        suggestedWindow: "18:00",
      },
      {
        kind: "training",
        focus: "Conditioning",
        durationMinutes: 38,
        intensity: "Medium-high",
        exercises: ["Bike sprints", "Step-ups", "Battle ropes"],
        note: "Keep transitions tight to build capacity.",
        suggestedWindow: "17:30",
      },
    ],
    gain: [
      {
        kind: "training",
        focus: "Push day",
        durationMinutes: 58,
        intensity: "Medium",
        exercises: ["Incline press", "Shoulder press", "Cable fly"],
        note: "Add load only if the form stays clean.",
        suggestedWindow: "18:00",
      },
      {
        kind: "training",
        focus: "Pull day",
        durationMinutes: 55,
        intensity: "Medium",
        exercises: ["Rows", "Lat pulldown", "Rear delt fly"],
        note: "Pause on peak contraction where possible.",
        suggestedWindow: "18:00",
      },
      {
        kind: "training",
        focus: "Leg day",
        durationMinutes: 60,
        intensity: "Medium-high",
        exercises: ["Back squat", "Romanian deadlift", "Leg press"],
        note: "Treat this as the main growth session.",
        suggestedWindow: "18:30",
      },
      {
        kind: "training",
        focus: "Full body pump",
        durationMinutes: 44,
        intensity: "Medium",
        exercises: ["Dumbbell press", "Split squat", "Pull-ups"],
        note: "Focus on volume and quality, not ego loading.",
        suggestedWindow: "17:30",
      },
    ],
  };
  const templates = sequences[form.goal];

  return DAY_NAMES.map((day, index) => {
    if (index >= workoutCount) {
      return {
        day,
        kind: "recovery",
        focus: "Recovery walk",
        durationMinutes: 25,
        intensity: "Low",
        exercises: ["Outdoor walk", "Calf stretch", "Hip opener"],
        note: "Keep the body moving without adding fatigue.",
        suggestedWindow: "08:00",
      };
    }

    return {
      day,
      ...templates[index % templates.length],
    };
  });
}

function buildPreviewMealPlan(form: ProfileFormState, summary: Summary): MealDay[] {
  const mealCount = clampNumber(Math.round(toNumber(form.mealsPerDay, 4)), 3, 5);
  const likedFoods = splitCsv(form.likes);
  const primaryLike = likedFoods[0] ?? "salmon";
  const secondaryLike = likedFoods[1] ?? "oats";
  const dietLabel = DIET_STYLE_LABELS[form.dietaryStyle].toLowerCase();
  const variants = [
    { breakfast: "Fuel bowl", lunch: "Studio lunch", dinner: "Recovery plate", snack: "Between-set snack" },
    { breakfast: "Morning prep", lunch: "Protein stack", dinner: "Evening reset", snack: "Quick bite" },
    { breakfast: "Pre-work mix", lunch: "Performance lunch", dinner: "Dinner balance", snack: "Light refuel" },
  ];
  const distribution =
    mealCount === 3
      ? [
          { name: "Breakfast", ratio: 0.3 },
          { name: "Lunch", ratio: 0.38 },
          { name: "Dinner", ratio: 0.32 },
        ]
      : mealCount === 4
        ? [
            { name: "Breakfast", ratio: 0.24 },
            { name: "Lunch", ratio: 0.33 },
            { name: "Snack", ratio: 0.12 },
            { name: "Dinner", ratio: 0.31 },
          ]
        : [
            { name: "Breakfast", ratio: 0.21 },
            { name: "Snack", ratio: 0.1 },
            { name: "Lunch", ratio: 0.27 },
            { name: "Snack 2", ratio: 0.12 },
            { name: "Dinner", ratio: 0.3 },
          ];

  return DAY_NAMES.map((day, dayIndex) => {
    const variant = variants[dayIndex % variants.length];

    return {
      day,
      totalCalories: summary.calorieTarget,
      meals: distribution.map((entry) => {
        const calories = Math.round((summary.calorieTarget * entry.ratio) / 10) * 10;
        if (entry.name === "Breakfast") {
          const details = buildMealDetails(
            `${variant.breakfast} with ${primaryLike} and ${secondaryLike}`,
            calories,
            entry.name,
          );
          return {
            name: entry.name,
            title: `${variant.breakfast} with ${primaryLike} and ${secondaryLike}`,
            calories,
            summary: `Start the day with ${dietLabel} structure, protein, and slow carbs.`,
            timeLabel: "07:30",
            timingContext: "Breakfast",
            imageUrl: mealPhotoUrl(`${variant.breakfast} with ${primaryLike} and ${secondaryLike}`),
            ...details,
          };
        }

        if (entry.name.startsWith("Snack")) {
          const details = buildMealDetails(`${variant.snack} for training flow`, calories, entry.name);
          return {
            name: entry.name,
            title: `${variant.snack} for training flow`,
            calories,
            summary: "A smaller meal slot to keep energy and appetite steady.",
            timeLabel: entry.name === "Snack" ? "16:30" : "21:00",
            timingContext: entry.name === "Snack" ? "Pre-workout snack" : "Evening snack",
            imageUrl: mealPhotoUrl(`${variant.snack} for training flow`),
            ...details,
          };
        }

        if (entry.name === "Lunch") {
          const details = buildMealDetails(`${variant.lunch} built around ${primaryLike}`, calories, entry.name);
          return {
            name: entry.name,
            title: `${variant.lunch} built around ${primaryLike}`,
            calories,
            summary: "This is the anchor meal for midday energy and recovery.",
            timeLabel: "13:00",
            timingContext: "Main meal",
            imageUrl: mealPhotoUrl(`${variant.lunch} built around ${primaryLike}`),
            ...details,
          };
        }

        const details = buildMealDetails(`${variant.dinner} with a ${dietLabel} finish`, calories, entry.name);
        return {
          name: entry.name,
          title: `${variant.dinner} with a ${dietLabel} finish`,
          calories,
          summary: "End the day with enough protein and a calmer digestion pace.",
          timeLabel: "19:30",
          timingContext: "Post-workout dinner",
          imageUrl: mealPhotoUrl(`${variant.dinner} with a ${dietLabel} finish`),
          ...details,
        };
      }),
    };
  });
}

function getInitials(name: string | undefined): string {
  const parts = (name ?? "")
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  return parts.length ? parts.map((part) => part[0]?.toUpperCase() ?? "").join("") : "NP";
}

function getFirstName(name: string | undefined): string {
  return (name ?? "").trim().split(" ")[0] || "Athlete";
}

function formatShortDay(day: string): string {
  return day.slice(0, 3).toUpperCase();
}

function currentDayName(): string {
  const index = (new Date().getDay() + 6) % 7;
  return DAY_NAMES[index];
}

function parseTimeLabel(value: string): number {
  const [hours, minutes] = value.split(":").map((item) => Number(item));
  return (hours || 0) * 60 + (minutes || 0);
}

function isMealAvailable(
  dayName: string,
  meals: MealDay["meals"],
  mealIndex: number,
  mealLogged: boolean,
): { allowed: boolean; reason: string } {
  if (mealLogged) {
    return { allowed: true, reason: "Already logged" };
  }
  if (dayName !== currentDayName()) {
    return { allowed: false, reason: `You can log this on ${dayName}` };
  }
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeLabel(meals[mealIndex].timeLabel);
  const next = mealIndex < meals.length - 1 ? parseTimeLabel(meals[mealIndex + 1].timeLabel) : 24 * 60;
  if (minutesNow < start) {
    return { allowed: false, reason: `Available from ${meals[mealIndex].timeLabel}` };
  }
  if (minutesNow >= next) {
    return { allowed: false, reason: "Meal window passed" };
  }
  return { allowed: true, reason: "Available now" };
}

function formatDistanceLabel(totalMinutes: number): string {
  if (totalMinutes <= 1) {
    return "1 min";
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function getUpcomingMeal(dayName: string, meals: MealDay["meals"]) {
  if (meals.length === 0) {
    return null;
  }
  const today = currentDayName();
  if (dayName !== today) {
    return {
      meal: meals[0],
      label: `${dayName} ${meals[0].timeLabel}`,
      headline: "Tomorrow starts here",
      note: `Your next meal window opens on ${dayName}.`,
    };
  }
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const nextMeal = meals.find((meal) => parseTimeLabel(meal.timeLabel) >= minutesNow);
  if (nextMeal) {
    const distanceMinutes = Math.max(0, parseTimeLabel(nextMeal.timeLabel) - minutesNow);
    return {
      meal: nextMeal,
      label: `Today ${nextMeal.timeLabel}`,
      headline: distanceMinutes <= 60 ? "Your next meal is close" : "Next meal later today",
      note:
        distanceMinutes === 0
          ? "Your meal window is open now."
          : `Window opens in ${formatDistanceLabel(distanceMinutes)}.`,
    };
  }
  return {
    meal: meals[0],
    label: `Tomorrow ${meals[0].timeLabel}`,
    headline: "Tomorrow starts here",
    note: "You finished today's meal windows.",
  };
}

function mealLogKey(day: string, mealName: string): string {
  return `${day}|${mealName}`;
}

function workoutLogKey(day: string, focus: string): string {
  return `${day}|${focus}`;
}

function isWorkoutAvailable(
  day: WorkoutDay,
  workoutCompleted: boolean,
): { allowed: boolean; reason: string } {
  if (day.kind !== "training") {
    return { allowed: false, reason: "Recovery day" };
  }
  if (workoutCompleted) {
    return { allowed: true, reason: "Completed today" };
  }
  if (day.day !== currentDayName()) {
    return { allowed: false, reason: `Available on ${day.day}` };
  }
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeLabel(day.suggestedWindow);
  if (minutesNow + 15 < start) {
    return { allowed: false, reason: `Available from ${day.suggestedWindow}` };
  }
  return { allowed: true, reason: "Available now" };
}

function trainingImageUrl(focus: string, index: number): string {
  return TRAINING_GALLERY[index % TRAINING_GALLERY.length].image;
}

function mealPhotoUrl(title: string): string {
  const lowered = title.toLowerCase();
  if (lowered.includes("salmon") || lowered.includes("shrimp")) {
    return "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1200&q=80";
  }
  if (lowered.includes("chicken") || lowered.includes("turkey")) {
    return "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=1200&q=80";
  }
  if (lowered.includes("yogurt") || lowered.includes("berries")) {
    return "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=1200&q=80";
  }
  if (lowered.includes("smoothie")) {
    return "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=1200&q=80";
  }
  if (lowered.includes("tofu") || lowered.includes("vegan")) {
    return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80";
  }
  if (lowered.includes("oats") || lowered.includes("breakfast")) {
    return "https://images.unsplash.com/photo-1517673400267-0251440c45dc?auto=format&fit=crop&w=1200&q=80";
  }
  return "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=1200&q=80";
}

function ringStyle(percent: number): CSSProperties {
  const safePercent = clampNumber(percent, 0, 100);
  return {
    background: `conic-gradient(var(--accent) 0 ${safePercent}%, rgba(34, 34, 34, 0.1) ${safePercent}% 100%)`,
  };
}

function QuickMetric(props: QuickMetricProps) {
  return (
    <article className="quick-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.note}</p>
    </article>
  );
}

function DayTab(props: DayTabProps) {
  return (
    <button type="button" className={props.active ? "day-tab active" : "day-tab"} onClick={props.onClick}>
      <span>{formatShortDay(props.day)}</span>
      <strong>{props.day}</strong>
    </button>
  );
}

function buildMealDetails(title: string, calories: number, mealName: string) {
  const lowered = title.toLowerCase();
  const proteinGrams =
    mealName === "Breakfast" ? Math.max(24, Math.round(calories * 0.28 / 4)) : Math.max(18, Math.round(calories * 0.3 / 4));
  const carbsGrams =
    mealName.startsWith("Snack") ? Math.max(14, Math.round(calories * 0.34 / 4)) : Math.max(24, Math.round(calories * 0.38 / 4));
  const fatsGrams = Math.max(8, Math.round((calories - (proteinGrams * 4 + carbsGrams * 4)) / 9));

  let ingredients = ["olive oil", "herbs", "seasoning"];
  if (lowered.includes("salmon")) {
    ingredients = ["salmon", "rice", "greens", "olive oil", "lemon"];
  } else if (lowered.includes("chicken")) {
    ingredients = ["chicken breast", "rice or couscous", "vegetables", "olive oil", "paprika"];
  } else if (lowered.includes("yogurt")) {
    ingredients = ["Greek yogurt", "berries", "oats", "honey", "nuts"];
  } else if (lowered.includes("smoothie")) {
    ingredients = ["protein powder", "banana", "berries", "milk", "oats"];
  } else if (lowered.includes("tofu")) {
    ingredients = ["tofu", "rice", "broccoli", "soy sauce", "sesame oil"];
  } else if (lowered.includes("oats") || lowered.includes("breakfast")) {
    ingredients = ["oats", "milk", "fruit", "seeds", "protein source"];
  }

  const steps =
    mealName.startsWith("Snack")
      ? [
          "Prepare the snack portion.",
          "Pair it with water or a light drink.",
          "Use it as a quick energy or recovery meal.",
        ]
      : [
          "Cook the main protein until done.",
          "Prepare the carbs and vegetables in parallel.",
          "Plate everything together with seasoning and healthy fats.",
        ];

  return {
    proteinGrams,
    carbsGrams,
    fatsGrams,
    cookTimeMinutes: mealName.startsWith("Snack") ? 5 : mealName === "Breakfast" ? 15 : 25,
    ingredients,
    steps,
  };
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [user, setUser] = useState<User | null>(session?.user ?? null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [selectedMealDay, setSelectedMealDay] = useState<string>(DAY_NAMES[0]);
  const [selectedTrainingDay, setSelectedTrainingDay] = useState<string>(DAY_NAMES[0]);
  const [selectedMealDetail, setSelectedMealDetail] = useState<MealDay["meals"][number] | null>(null);
  const [pendingMealKeys, setPendingMealKeys] = useState<string[]>([]);
  const [loadingLineIndex, setLoadingLineIndex] = useState(0);
  const [signupForm, setSignupForm] = useState(initialSignupForm);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfileForm);
  const [statusMessage, setStatusMessage] = useState(
    "Shape a nutrition profile, save it once, and the studio will map meals and training around it.",
  );
  const [busyState, setBusyState] = useState<"signup" | "login" | "profile" | "refresh" | null>(
    null,
  );
  const [hydrating, setHydrating] = useState(Boolean(session?.token));

  const deferredLikes = useDeferredValue(profileForm.likes);
  const deferredDislikes = useDeferredValue(profileForm.dislikes);
  const deferredAllergies = useDeferredValue(profileForm.allergies);

  const likedFoods = splitCsv(deferredLikes);
  const dislikedFoods = splitCsv(deferredDislikes);
  const allergyFoods = splitCsv(deferredAllergies);

  useEffect(() => {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.token) {
      setHydrating(false);
      setUser(null);
      setPlan(null);
      return;
    }

    let ignore = false;
    setHydrating(true);

    apiRequest<MeResponse>("/me", { method: "GET" }, session.token)
      .then((data) => {
        if (ignore) {
          return;
        }

        setUser(data.user);
        setPlan(data.plan);
        setProfileForm(profileToForm(data.profile));
        setStatusMessage(
          data.plan
            ? "Profile synced. Edit the left rail any time and refresh the studio layout."
            : "Account ready. Fill the intake cards on the left and generate your first plan.",
        );
      })
      .catch((error: Error) => {
        if (ignore) {
          return;
        }

        setSession(null);
        setUser(null);
        setPlan(null);
        setStatusMessage(error.message);
      })
      .finally(() => {
        if (!ignore) {
          setHydrating(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [session?.token]);

  function updateSignupField<Key extends keyof SignupFormState>(
    field: Key,
    value: SignupFormState[Key],
  ) {
    setSignupForm((current) => ({ ...current, [field]: value }));
  }

  function updateLoginField<Key extends keyof LoginFormState>(
    field: Key,
    value: LoginFormState[Key],
  ) {
    setLoginForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileField<Key extends keyof ProfileFormState>(
    field: Key,
    value: ProfileFormState[Key],
  ) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  function handleAuthSuccess(response: AuthResponse, message: string) {
    startTransition(() => {
      setSession({ token: response.token, user: response.user });
      setUser(response.user);
      setPlan(response.plan);
      setProfileForm(profileToForm(response.profile));
    });
    setActiveTab("dashboard");
    setOnboardingStep(0);
    setStatusMessage(message);
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyState("signup");

    try {
      const response = await apiRequest<AuthResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify(signupForm),
      });
      handleAuthSuccess(response, "Account created. Build your intake profile to unlock the dashboard.");
      setSignupForm(initialSignupForm);
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setBusyState(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyState("login");

    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });
      handleAuthSuccess(
        response,
        response.plan
          ? "Welcome back. The dashboard has been rebuilt from your latest saved profile."
          : "Welcome back. Complete the intake rail to generate the first version of your plan.",
      );
      setLoginForm(initialLoginForm);
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setBusyState(null);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.token) {
      setStatusMessage("Log in before saving your intake profile.");
      return;
    }

    setBusyState("profile");
    try {
      const response = await apiRequest<{ message: string; plan: PlanResponse }>(
        "/profile",
        {
          method: "PUT",
          body: JSON.stringify(buildProfilePayload(profileForm)),
        },
        session.token,
      );
      setPlan(response.plan);
      setProfileForm(profileToForm(response.plan.profile));
      setStatusMessage(response.message);
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setBusyState(null);
    }
  }

  async function handleRefreshPlan() {
    if (!session?.token) {
      return;
    }

    setBusyState("refresh");
    try {
      const response = await apiRequest<PlanResponse>("/plan", { method: "GET" }, session.token);
      setPlan(response);
      setStatusMessage("Dashboard refreshed from your saved profile.");
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setBusyState(null);
    }
  }

  async function handleLogMeal(day: string, meal: MealDay["meals"][number]) {
    if (!session?.token || !plan) {
      return;
    }

    const key = mealLogKey(day, meal.name);
    setPendingMealKeys((current) => (current.includes(key) ? current : [...current, key]));

    try {
      await apiRequest<{ message: string; progress: ProgressSnapshot }>(
        "/progress/meals",
        {
          method: "POST",
          body: JSON.stringify({
            day,
            mealName: meal.name,
            title: meal.title,
            calories: meal.calories,
          }),
        },
        session.token,
      );
      const refreshedPlan = await apiRequest<PlanResponse>("/plan", { method: "GET" }, session.token);
      setPlan(refreshedPlan);
      setStatusMessage("Meal logged.");
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setPendingMealKeys((current) => current.filter((entry) => entry !== key));
    }
  }

  async function handleCompleteWorkout(day: WorkoutDay) {
    if (!session?.token || !plan) {
      return;
    }
    const availability = isWorkoutAvailable(
      day,
      progress.completedWorkouts
        .map((entry) => entry.split("|").slice(0, 2).join("|"))
        .includes(workoutLogKey(day.day, day.focus)),
    );
    if (!availability.allowed) {
      setStatusMessage(availability.reason);
      return;
    }

    try {
      const response = await apiRequest<{ message: string; progress: ProgressSnapshot }>(
        "/progress/workouts",
        {
          method: "POST",
          body: JSON.stringify({
            day: day.day,
            focus: day.focus,
          }),
        },
        session.token,
      );
      setPlan((current) => (current ? { ...current, progress: response.progress } : current));
      setStatusMessage(response.message);
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  }

  async function handleLogWater(amountMl: number) {
    if (!session?.token || !plan) {
      return;
    }

    try {
      const response = await apiRequest<{ message: string; progress: ProgressSnapshot }>(
        "/progress/water",
        {
          method: "POST",
          body: JSON.stringify({ amountMl }),
        },
        session.token,
      );
      setPlan((current) => (current ? { ...current, progress: response.progress } : current));
      setStatusMessage(response.message);
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  }

  function logout() {
    setSession(null);
    setUser(null);
    setPlan(null);
    setProfileForm(initialProfileForm);
    setStatusMessage("You have been signed out.");
  }

  const previewSummary = buildPreviewSummary(profileForm);
  const summary = plan?.summary ?? previewSummary;
  const workoutPlan = plan?.workoutPlan ?? buildPreviewWorkoutPlan(profileForm);
  const mealPlan = plan?.mealPlan ?? buildPreviewMealPlan(profileForm, summary);
  const progress =
    plan?.progress ?? {
      todayCalories: 0,
      todayWaterMl: 0,
      caloriePercent: 0,
      completedMeals: [],
      completedWorkouts: [],
      workoutStreak: 0,
      completedWorkoutsCount: 0,
    };
  const dashboardProfile = plan?.profile ?? {
    ...buildProfilePayload(profileForm),
    likes: likedFoods,
    dislikes: dislikedFoods,
    allergies: allergyFoods,
    updatedAt: new Date().toISOString(),
  };
  const trainingDays = workoutPlan.filter((day) => day.intensity !== "Low").length;
  const completedWorkoutKeys = new Set(
    progress.completedWorkouts.map((entry) => entry.split("|").slice(0, 2).join("|")),
  );
  const completedMealKeys = new Set(
    progress.completedMeals.map((entry) => entry.split("|").slice(0, 2).join("|")),
  );
  const completedTrainingDays = workoutPlan.filter((day) =>
    completedWorkoutKeys.has(workoutLogKey(day.day, day.focus)),
  ).length;
  const completedMealCount = mealPlan
    .flatMap((day) => day.meals.map((meal) => mealLogKey(day.day, meal.name)))
    .filter((key) => completedMealKeys.has(key)).length;
  const plannedMealCount = mealPlan.reduce((total, day) => total + day.meals.length, 0);
  const trainingPercent = Math.round((completedTrainingDays / Math.max(trainingDays, 1)) * 100);
  const mealLoggingPercent = Math.round((completedMealCount / Math.max(plannedMealCount, 1)) * 100);
  const legacyTodayTasks = [
    {
      label: "Log today’s meals",
      meta: `${completedMealCount}/${plannedMealCount} logged`,
      active: completedMealCount > 0,
    },
    {
      label: "Complete a workout",
      meta: `${completedTrainingDays}/${trainingDays} sessions done`,
      active: completedTrainingDays > 0,
    },
    {
      label: "Protect your streak",
      meta: `${progress.workoutStreak} day streak`,
      active: progress.workoutStreak > 0,
    },
  ];
  const completionValue = Math.round(
    (trainingPercent + progress.caloriePercent + (progress.workoutStreak > 0 ? 100 : 0)) / 3,
  );
  const ringIconSize = 1.8 + progress.caloriePercent / 35;
  const waterPercent = Number.isFinite(progress.todayWaterMl)
    ? Math.min(100, Math.round((progress.todayWaterMl / Math.max(summary.waterLiters * 1000, 1)) * 100))
    : 0;
  const currentDay = currentDayName();
  const todayWorkout = workoutPlan.find((day) => day.day === currentDay) ?? workoutPlan[0];
  const todayMeals = mealPlan.find((day) => day.day === currentDay)?.meals ?? [];
  const upcomingMeal = getUpcomingMeal(currentDay, todayMeals);
  const todayMealCount = todayMeals.length;
  const todayLoggedMealCount = todayMeals.filter((meal) =>
    completedMealKeys.has(mealLogKey(currentDay, meal.name)),
  ).length;
  const todayWorkoutCompleted = Boolean(
    todayWorkout &&
      todayWorkout.kind === "training" &&
      completedWorkoutKeys.has(workoutLogKey(todayWorkout.day, todayWorkout.focus)),
  );
  const todayTasks = [
    {
      label: "Log today's meals",
      meta: todayMealCount ? `${todayLoggedMealCount}/${todayMealCount} meals logged` : "No meals scheduled",
      active: todayLoggedMealCount > 0 && todayLoggedMealCount < Math.max(todayMealCount, 1),
      done: todayMealCount > 0 && todayLoggedMealCount === todayMealCount,
    },
    {
      label: todayWorkout?.kind === "training" ? "Complete today's workout" : "Honor today's recovery",
      meta:
        todayWorkout?.kind === "training"
          ? todayWorkoutCompleted
            ? "Workout saved for today"
            : `${todayWorkout?.durationMinutes ?? 0} min ${todayWorkout?.focus ?? "session"}`
          : "Recovery, walking, and mobility",
      active: todayWorkout?.kind === "training" && !todayWorkoutCompleted,
      done: todayWorkout?.kind === "training" ? todayWorkoutCompleted : true,
    },
    {
      label: "Protect your streak",
      meta:
        progress.workoutStreak > 0
          ? `${progress.workoutStreak} day streak running`
          : "Complete today's plan to start day 1",
      active: progress.workoutStreak > 0,
      done: progress.workoutStreak > 0,
    },
  ];
  const remainingTaskCount = todayTasks.filter((task) => !task.done).length;
  const dashboardSetupRows = [
    { label: "Goal", value: GOAL_LABELS[dashboardProfile.goal] },
    { label: "Activity", value: ACTIVITY_LABELS[dashboardProfile.activityLevel] },
    { label: "Meals / day", value: String(dashboardProfile.mealsPerDay) },
    { label: "Workout days", value: String(dashboardProfile.workoutsPerWeek) },
  ];
  const onboardingProgress = ((onboardingStep + 1) / 3) * 100;
  const needsOnboarding = Boolean(user && !plan);
  const mealShowcase = mealPlan.map((day) => ({
    ...day,
    meals: day.meals.map((meal) => ({
      ...meal,
      logged: completedMealKeys.has(mealLogKey(day.day, meal.name)),
      pending: pendingMealKeys.includes(mealLogKey(day.day, meal.name)),
    })),
  }));
  const trainingShowcase = workoutPlan.slice(0, 6).map((day, index) => ({
    ...day,
    image: trainingImageUrl(day.focus, index),
    completed: completedWorkoutKeys.has(workoutLogKey(day.day, day.focus)),
  }));
  const selectedMealDayData =
    mealShowcase.find((day) => day.day === selectedMealDay) ?? mealShowcase[0] ?? null;
  const selectedTrainingDayData =
    trainingShowcase.find((day) => day.day === selectedTrainingDay) ?? trainingShowcase[0] ?? null;
  const selectedTrainingAvailability = selectedTrainingDayData
    ? isWorkoutAvailable(selectedTrainingDayData, Boolean(selectedTrainingDayData.completed))
    : null;

  useEffect(() => {
    if (mealShowcase.length > 0 && !mealShowcase.some((day) => day.day === selectedMealDay)) {
      setSelectedMealDay(mealShowcase[0].day);
    }
  }, [mealShowcase, selectedMealDay]);

  useEffect(() => {
    if (
      trainingShowcase.length > 0 &&
      !trainingShowcase.some((day) => day.day === selectedTrainingDay)
    ) {
      setSelectedTrainingDay(trainingShowcase[0].day);
    }
  }, [selectedTrainingDay, trainingShowcase]);

  useEffect(() => {
    if (busyState !== "profile") {
      setLoadingLineIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingLineIndex((current) => (current + 1) % LOADING_LINES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [busyState]);

  function goToNextStep() {
    setOnboardingStep((current) => Math.min(current + 1, 2));
  }

  function goToPreviousStep() {
    setOnboardingStep((current) => Math.max(current - 1, 0));
  }

  function renderDashboardWindow() {
    return (
      <section className="tab-window">
        <section className="dashboard-header">
          <div>
            <div className="eyebrow">Dashboard</div>
            <h1>{getFirstName(user?.fullName)}, here&apos;s your weekly overview.</h1>
          </div>

          <div className="headline-metrics">
            <div className="headline-metric-card">
              <strong>{progress.todayCalories}</strong>
              <span>Calories logged</span>
            </div>
            <div className="headline-metric-card">
              <strong>{summary.proteinGrams}</strong>
              <span>Protein target</span>
            </div>
            <div className="headline-metric-card">
              <strong>{progress.workoutStreak}</strong>
              <span>Workout streak</span>
            </div>
          </div>
        </section>

        <div className="dashboard-grid-shell">
          <aside className="left-rail">
            <article className="profile-feature-card">
              <div className="feature-portrait profile-portrait-card">
                <img src={USER_ICON_PNG} alt="User profile" className="profile-icon-art" />
                <div className="feature-avatar-copy profile-icon-copy">
                  <strong>{user?.fullName}</strong>
                  <span>{ACTIVITY_LABELS[dashboardProfile.activityLevel]}</span>
                </div>
              </div>
              <div className="feature-tags">
                <span>{DIET_STYLE_LABELS[dashboardProfile.dietaryStyle]}</span>
                <span>{GOAL_LABELS[dashboardProfile.goal]}</span>
              </div>
            </article>

            <article className="dashboard-side-card">
              <div className="dashboard-side-head">
                <span className="eyebrow">Profile overview</span>
                <strong>Current setup</strong>
              </div>
              <div className="mini-summary-grid">
                <QuickMetric label="BMI" value={`${summary.bmi}`} note={summary.bmiCategory} />
                <QuickMetric
                  label="BMR"
                  value={`${summary.bmr}`}
                  note={summary.calorieSource === "custom" ? "Custom intake active" : "Auto-generated"}
                />
              </div>
              <div className="dashboard-info-list">
                {dashboardSetupRows.map((item) => (
                  <div key={item.label} className="dashboard-info-row">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              <p className="dashboard-side-note">
                Use the Profile tab to edit body metrics, food preferences, and goal details.
              </p>
            </article>
          </aside>

          <section className="center-stage">
            <div className="insight-card-grid">
              <article className="insight-card ring-card">
                <div className="card-topline">
                  <span>Fuel tracker</span>
                  <button type="button" className="corner-chip">
                    {progress.caloriePercent}%
                  </button>
                </div>
                <div className="fuel-ring" style={ringStyle(progress.caloriePercent)}>
                  <div>
                    <span className="ring-icon" style={{ fontSize: `${ringIconSize}rem` }}>
                      {"\uD83D\uDD25"}
                    </span>
                  </div>
                </div>
                <div className="ring-readout">
                  <strong>
                    {progress.todayCalories} / {summary.calorieTarget} kcal
                  </strong>
                </div>
                <div className="inline-pills">
                  <span>{summary.waterLiters} L water</span>
                  <span>{summary.proteinGrams} g protein</span>
                </div>
              </article>

              <article className="insight-card ring-card">
                <div className="card-topline">
                  <span>Water tracker</span>
                  <button type="button" className="corner-chip">
                    {waterPercent}%
                  </button>
                </div>
                <div className="fuel-ring water-ring" style={ringStyle(waterPercent)}>
                  <div>
                    <span className="ring-icon" style={{ fontSize: `${1.7 + waterPercent / 45}rem` }}>
                      {"\uD83D\uDCA7"}
                    </span>
                  </div>
                </div>
                <div className="ring-readout">
                  <strong>
                    {(progress.todayWaterMl / 1000).toFixed(1)} / {summary.waterLiters.toFixed(1)} L
                  </strong>
                </div>
                <div className="meal-action-row">
                  {[250, 500, 750].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className="slot-action slot-action-secondary"
                      onClick={() => void handleLogWater(amount)}
                    >
                      +{amount} ml
                    </button>
                  ))}
                </div>
              </article>

              <article className="insight-card habit-card">
                <div className="card-topline">
                  <span>Real compliance</span>
                  <strong>{completionValue}%</strong>
                </div>
                <div className="habit-lines">
                  <div>
                    <label>Training load</label>
                    <div className="segmented-track">
                      <span style={{ width: `${trainingPercent}%` }} />
                    </div>
                  </div>
                  <div>
                    <label>Calorie target</label>
                    <div className="segmented-track">
                      <span style={{ width: `${progress.caloriePercent}%` }} />
                    </div>
                  </div>
                  <div>
                    <label>Meal logging</label>
                    <div className="segmented-track dark">
                      <span style={{ width: `${mealLoggingPercent}%` }} />
                    </div>
                  </div>
                </div>
                <p>
                  {completedMealCount > 0 || completedTrainingDays > 0
                    ? `${completedMealCount} meals logged and ${completedTrainingDays} workouts completed so far.`
                    : "No meals or workouts have been logged yet."}
                </p>
              </article>
            </div>

            <article className="planner-panel">
              <div className="planner-head">
                <div>
                  <span className="eyebrow">Current day</span>
                  <h2>{currentDay} plan</h2>
                </div>
                <div className="planner-month">{todayWorkout?.kind === "training" ? "Training day" : "Recovery day"}</div>
              </div>

              <div className="planner-columns">
                <div className="planner-events">
                  <article className="planner-event-card">
                    <div className="planner-event-time">{todayWorkout?.durationMinutes ?? 0} min</div>
                    <strong>{todayWorkout?.focus ?? "Recovery"}</strong>
                    <p>{todayWorkout?.note ?? "Keep moving lightly and reset."}</p>
                    <div className="planner-chip-row">
                      {todayMeals.map((meal) => (
                        <span key={`${currentDay}-${meal.name}`}>{meal.name}</span>
                      ))}
                    </div>
                  </article>
                  {upcomingMeal ? (
                    <article className="planner-event-card next-meal-card">
                      <img
                        src={upcomingMeal.meal.imageUrl || mealPhotoUrl(upcomingMeal.meal.title)}
                        alt={upcomingMeal.meal.title}
                      />
                      <div className="next-meal-copy">
                        <div className="planner-event-time">{upcomingMeal.label}</div>
                        <strong>{upcomingMeal.headline}</strong>
                        <p>{upcomingMeal.meal.title}</p>
                        <span className="next-meal-note">{upcomingMeal.note}</span>
                        <div className="planner-chip-row">
                          <span>{upcomingMeal.meal.name}</span>
                          <span>{upcomingMeal.meal.calories} kcal</span>
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              </div>
            </article>
          </section>

          <aside className="right-rail">
            <article className="task-panel">
              <div className="task-panel-head">
                <span>Next steps</span>
                <strong>{remainingTaskCount}</strong>
              </div>
              <div className="task-list">
                {todayTasks.map((task) => (
                  <div
                    key={task.label}
                    className={`task-item${task.done ? " done" : task.active ? " active" : ""}`}
                  >
                    <span className={`task-dot${task.done ? " done" : ""}`}>
                      {task.done ? "\u2713" : ""}
                    </span>
                    <div>
                      <strong>{task.label}</strong>
                      <span>{task.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="right-mini-panel">
              <div className="dashboard-side-head">
                <span className="eyebrow">Today</span>
                <strong>What matters now</strong>
              </div>
              <div className="dashboard-info-list">
                <div className="dashboard-info-row">
                  <span>Today workout</span>
                  <strong>{todayWorkout?.focus ?? "Recovery"}</strong>
                </div>
                <div className="dashboard-info-row">
                  <span>Meal windows</span>
                  <strong>{todayMeals.length}</strong>
                </div>
              </div>
            </article>
          </aside>
        </div>
      </section>
    );
  }

  function renderMealsWindow() {
    return (
      <section className="tab-window">
        <section className="tab-section-head">
          <div>
            <div className="eyebrow">Meals</div>
            <h2>Weekly meal schedule</h2>
          </div>
          <p>Select a day to see the exact meal timing, calories, and what to log.</p>
        </section>

        <div className="day-tab-row">
          {mealShowcase.map((day) => (
            <DayTab
              key={day.day}
              day={day.day}
              active={selectedMealDayData?.day === day.day}
              onClick={() => setSelectedMealDay(day.day)}
            />
          ))}
        </div>

        {selectedMealDayData ? (
          <section className="meal-schedule-grid">
            <article className="day-schedule-card">
              <div className="day-schedule-head">
                <div>
                  <span className="eyebrow">{selectedMealDayData.day}</span>
                  <strong>{selectedMealDayData.totalCalories} kcal planned</strong>
                </div>
                <span className="day-schedule-count">{selectedMealDayData.meals.length} meals</span>
              </div>
              <p className="schedule-day-note">
                Meals are arranged around your selected meal count and workout timing. Use the
                button on each card after you eat it.
              </p>

              <div className="meal-slot-list">
                {selectedMealDayData.meals.map((meal, mealIndex) => {
                  const availability = isMealAvailable(
                    selectedMealDayData.day,
                    selectedMealDayData.meals,
                    mealIndex,
                    meal.logged,
                  );
                  return (
                  <article
                    key={`${selectedMealDayData.day}-${meal.name}`}
                    className={`meal-slot-card${!availability.allowed ? " meal-slot-locked" : ""}`}
                    onClick={() => setSelectedMealDetail(meal)}
                  >
                    <img
                      src={meal.imageUrl || mealPhotoUrl(meal.title)}
                      alt={meal.title}
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = mealPhotoUrl(meal.title);
                      }}
                    />
                    <div className="meal-slot-copy">
                      <div className="meal-slot-topline">
                        <span>{meal.name}</span>
                        <strong>{meal.timeLabel}</strong>
                      </div>
                      <h3>{meal.title}</h3>
                      <p>{meal.summary}</p>
                      <div className="gallery-meta">
                        <span>{meal.timingContext}</span>
                        <span>{meal.calories} kcal</span>
                      </div>
                      <div className="meal-availability">{availability.reason}</div>
                      <div className="meal-action-row">
                        <button
                          type="button"
                          className="slot-action slot-action-secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedMealDetail(meal);
                          }}
                        >
                          View details
                        </button>
                        <button
                          type="button"
                          className={meal.logged ? "slot-action logged" : "slot-action"}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleLogMeal(selectedMealDayData.day, meal);
                          }}
                          disabled={meal.logged || meal.pending || !availability.allowed}
                        >
                          {meal.logged ? "\u2713 Eaten" : meal.pending ? "Saving..." : "Mark as eaten"}
                        </button>
                      </div>
                    </div>
                  </article>
                )})}
              </div>
            </article>
          </section>
        ) : null}
      </section>
    );
  }

  function renderTrainingWindow() {
    return (
      <section className="tab-window">
        <section className="tab-section-head">
          <div>
            <div className="eyebrow">Training</div>
            <h2>Weekly training schedule</h2>
          </div>
          <p>Select a day to see the exact workout focus, timing, and whether it is a rest day.</p>
        </section>

        <div className="day-tab-row">
          {trainingShowcase.map((day) => (
            <DayTab
              key={day.day}
              day={day.day}
              active={selectedTrainingDayData?.day === day.day}
              onClick={() => setSelectedTrainingDay(day.day)}
            />
          ))}
        </div>

        {selectedTrainingDayData ? (
          <section className="gallery-shell">
            <article className="day-schedule-card training-day-card">
              <div className="training-day-grid">
                <img src={selectedTrainingDayData.image} alt={selectedTrainingDayData.focus} />
                <div className="gallery-card-copy">
                  <span>{selectedTrainingDayData.day}</span>
                  <strong>{selectedTrainingDayData.focus}</strong>
                  <p>{selectedTrainingDayData.note}</p>
                  <div className="gallery-meta">
                    <span>{selectedTrainingDayData.suggestedWindow}</span>
                    <span>{selectedTrainingDayData.intensity}</span>
                  </div>
                  <ul className="training-list">
                    {selectedTrainingDayData.exercises.map((exercise) => (
                      <li key={exercise}>{exercise}</li>
                    ))}
                  </ul>
                  <div className="gallery-meta">
                    <span>{selectedTrainingDayData.durationMinutes} min</span>
                    <span>
                      {selectedTrainingDayData.kind === "training" ? "Training day" : "Recovery day"}
                    </span>
                  </div>
                  {selectedTrainingAvailability ? (
                    <div className="meal-availability">{selectedTrainingAvailability.reason}</div>
                  ) : null}
                  {selectedTrainingDayData.kind === "training" ? (
                    <button
                      type="button"
                      className={selectedTrainingDayData.completed ? "slot-action logged" : "slot-action"}
                      onClick={() => void handleCompleteWorkout(selectedTrainingDayData)}
                      disabled={selectedTrainingDayData.completed || !selectedTrainingAvailability?.allowed}
                    >
                      {selectedTrainingDayData.completed ? "Completed" : "Finish workout"}
                    </button>
                  ) : (
                    <div className="rest-day-note">Recovery day. Stay light, walk, and reset.</div>
                  )}
                </div>
              </div>
            </article>
          </section>
        ) : null}
      </section>
    );
  }

  function renderProfileWindow() {
    return (
      <section className="tab-window">
        <section className="tab-section-head">
          <div>
            <div className="eyebrow">Profile</div>
            <h2>Body metrics, preferences, and plan settings</h2>
          </div>
          <p>This window owns your editable data only: body metrics, goals, allergies, and notes.</p>
        </section>

        <section className="profile-shell">
          <div className="profile-layout">
            <article className="profile-feature-card">
              <div className="feature-portrait">
                <div className="feature-avatar">{getInitials(user?.fullName)}</div>
                <div className="feature-avatar-copy">
                  <strong>{user?.fullName}</strong>
                  <span>{GOAL_LABELS[dashboardProfile.goal]}</span>
                </div>
              </div>
              <div className="feature-tags">
                <span>{DIET_STYLE_LABELS[dashboardProfile.dietaryStyle]}</span>
                <span>{ACTIVITY_LABELS[dashboardProfile.activityLevel]}</span>
              </div>
              <div className="taste-preview-block profile-taste-block">
                <span>Taste map</span>
                <div className="chip-cloud">
                  {(likedFoods.length ? likedFoods : ["No likes yet"]).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <div className="taste-columns">
                  <div>
                    <label>Dislikes</label>
                    <p>{dislikedFoods.length ? dislikedFoods.join(", ") : "None listed"}</p>
                  </div>
                  <div>
                    <label>Allergies</label>
                    <p>{allergyFoods.length ? allergyFoods.join(", ") : "None listed"}</p>
                  </div>
                </div>
              </div>
            </article>

            <form className="profile-form-panel" onSubmit={handleProfileSubmit}>
              <div className="compact-form-grid">
                <label>
                  Age
                  <input
                    type="number"
                    value={profileForm.age}
                    onChange={(event) => updateProfileField("age", event.target.value)}
                  />
                </label>
                <label>
                  Sex
                  <select
                    value={profileForm.sex}
                    onChange={(event) => updateProfileField("sex", event.target.value as BiologicalSex)}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Height (cm)
                  <input
                    type="number"
                    value={profileForm.heightCm}
                    onChange={(event) => updateProfileField("heightCm", event.target.value)}
                  />
                </label>
                <label>
                  Weight (kg)
                  <input
                    type="number"
                    value={profileForm.weightKg}
                    onChange={(event) => updateProfileField("weightKg", event.target.value)}
                  />
                </label>
                <label>
                  Goal
                  <select
                    value={profileForm.goal}
                    onChange={(event) => updateProfileField("goal", event.target.value as Goal)}
                  >
                    <option value="lose">Lose weight</option>
                    <option value="maintain">Maintain</option>
                    <option value="gain">Gain muscle</option>
                  </select>
                </label>
                <label>
                  Activity level
                  <select
                    value={profileForm.activityLevel}
                    onChange={(event) =>
                      updateProfileField("activityLevel", event.target.value as ActivityLevel)
                    }
                  >
                    <option value="sedentary">Sedentary</option>
                    <option value="light">Lightly active</option>
                    <option value="moderate">Moderately active</option>
                    <option value="active">Active</option>
                    <option value="very_active">Very active</option>
                  </select>
                </label>
                <label>
                  Workout days
                  <input
                    type="number"
                    min="1"
                    max="7"
                    value={profileForm.workoutsPerWeek}
                    onChange={(event) => updateProfileField("workoutsPerWeek", event.target.value)}
                  />
                </label>
                <label>
                  Meals per day
                  <input
                    type="number"
                    min="3"
                    max="5"
                    value={profileForm.mealsPerDay}
                    onChange={(event) => updateProfileField("mealsPerDay", event.target.value)}
                  />
                </label>
                <label>
                  Dietary style
                  <select
                    value={profileForm.dietaryStyle}
                    onChange={(event) =>
                      updateProfileField("dietaryStyle", event.target.value as DietaryStyle)
                    }
                  >
                    <option value="balanced">Balanced</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="vegan">Vegan</option>
                    <option value="pescatarian">Pescatarian</option>
                    <option value="high_protein">High protein</option>
                    <option value="low_carb">Low carb</option>
                  </select>
                </label>
                <label className="compact-span-two">
                  Daily calorie target
                  <input
                    type="number"
                    value={profileForm.dailyCalorieTarget}
                    onChange={(event) => updateProfileField("dailyCalorieTarget", event.target.value)}
                    placeholder="Leave blank for auto"
                  />
                </label>
                <label className="compact-span-two">
                  Likes
                  <input value={profileForm.likes} onChange={(event) => updateProfileField("likes", event.target.value)} />
                </label>
                <label>
                  Dislikes
                  <input value={profileForm.dislikes} onChange={(event) => updateProfileField("dislikes", event.target.value)} />
                </label>
                <label>
                  Allergies
                  <input value={profileForm.allergies} onChange={(event) => updateProfileField("allergies", event.target.value)} />
                </label>
                <label className="compact-span-two">
                  Notes
                  <textarea value={profileForm.notes} onChange={(event) => updateProfileField("notes", event.target.value)} />
                </label>
              </div>

              <button type="submit" className="save-profile-button" disabled={busyState !== null}>
                {busyState === "profile" ? "Saving..." : "Save profile and rebuild dashboard"}
              </button>
            </form>
          </div>
        </section>
      </section>
    );
  }

  function renderMealModal() {
    if (!selectedMealDetail) {
      return null;
    }

    return (
      <div className="modal-overlay" onClick={() => setSelectedMealDetail(null)}>
        <article className="meal-modal" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="modal-close"
            onClick={() => setSelectedMealDetail(null)}
            aria-label="Close meal details"
          >
            ×
          </button>
          <div className="meal-modal-grid">
            <img
              src={selectedMealDetail.imageUrl || mealPhotoUrl(selectedMealDetail.title)}
              alt={selectedMealDetail.title}
            />
            <div className="meal-modal-copy">
              <span className="eyebrow">{selectedMealDetail.timingContext}</span>
              <h3>{selectedMealDetail.title}</h3>
              <p>{selectedMealDetail.summary}</p>

              <div className="meal-macro-grid">
                <QuickMetric
                  label="Calories 🔥"
                  value={`${selectedMealDetail.calories}`}
                  note={`${selectedMealDetail.cookTimeMinutes} min cook`}
                />
                <QuickMetric
                  label="Protein 🥩"
                  value={`${selectedMealDetail.proteinGrams}g`}
                  note="Muscle recovery"
                />
                <QuickMetric
                  label="Carbs 🌾"
                  value={`${selectedMealDetail.carbsGrams}g`}
                  note="Training fuel"
                />
                <QuickMetric
                  label="Fats 🥑"
                  value={`${selectedMealDetail.fatsGrams}g`}
                  note="Hormonal support"
                />
              </div>

              <div className="meal-detail-block">
                <strong>Ingredients</strong>
                <ul>
                  {selectedMealDetail.ingredients.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="meal-detail-block">
                <strong>How to cook it</strong>
                <ol>
                  {selectedMealDetail.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </article>
      </div>
    );
  }

  function renderLoadingOverlay() {
    if (busyState !== "profile") {
      return null;
    }

    return (
      <div className="modal-overlay loading-overlay">
        <article className="loading-card">
          <span className="eyebrow">Building your plan</span>
          <h3>{LOADING_LINES[loadingLineIndex]}</h3>
          <div className="loading-bar">
            <span style={{ width: `${35 + loadingLineIndex * 18}%` }} />
          </div>
          <p>We are shaping meals, workouts, and timing around your profile.</p>
        </article>
      </div>
    );
  }

  function renderActiveWindow() {
    if (activeTab === "meals") {
      return renderMealsWindow();
    }
    if (activeTab === "training") {
      return renderTrainingWindow();
    }
    if (activeTab === "profile") {
      return renderProfileWindow();
    }
    return renderDashboardWindow();
  }

  if (!user) {
    return (
      <div className="page-shell">
        <div className="reference-frame auth-frame">
          <section className="showcase-panel">
            <div className="top-strip">
              <div className="brand-chip">DietTricks</div>
            </div>
            <div className="showcase-copy">
              <div className="eyebrow">Nutrition and training studio</div>
              <h1>{AUTH_COPY.title}</h1>
              <p>{AUTH_COPY.body}</p>
            </div>

            <article className="showcase-simple-card">
              <div className="showcase-simple-visual">
                <div className="showcase-simple-glow" />
                <div className="showcase-simple-avatar" />
              </div>
              <div className="showcase-simple-copy">
                <div className="showcase-simple-pill">Clean wellness entry</div>
                <strong>Sign in first. Build the rest after.</strong>
                <p>
                  Keep the first screen focused on access. After login, the app opens meals,
                  training, and profile setup in their own spaces.
                </p>
              </div>
            </article>
          </section>

          <aside className="auth-panel-shell">
            <div className="auth-intro">
              <div className="eyebrow">Access the studio</div>
              <h2>Simple sign in</h2>
              <p>Keep the first screen clean: only account access, nothing extra.</p>
            </div>

            <div className="status-banner">{hydrating ? "Loading saved session..." : statusMessage}</div>

            <div className="auth-mode-switch">
              <button
                type="button"
                className={authMode === "login" ? "mode-chip active" : "mode-chip"}
                onClick={() => setAuthMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={authMode === "signup" ? "mode-chip active" : "mode-chip"}
                onClick={() => setAuthMode("signup")}
              >
                Create account
              </button>
            </div>

            <form className="auth-card auth-card-full" onSubmit={authMode === "login" ? handleLogin : handleSignup}>
              <div className="auth-card-head">
                <span>{authMode === "login" ? "Open session" : "Start fresh"}</span>
                <strong>{authMode === "login" ? "Welcome back" : "Create your DietTricks account"}</strong>
              </div>

              {authMode === "signup" ? (
                <label>
                  Full name
                  <input
                    value={signupForm.fullName}
                    onChange={(event) => updateSignupField("fullName", event.target.value)}
                    placeholder="Amina Rahman"
                  />
                </label>
              ) : null}

              <label>
                Email
                <input
                  type="email"
                  value={authMode === "login" ? loginForm.email : signupForm.email}
                  onChange={(event) =>
                    authMode === "login"
                      ? updateLoginField("email", event.target.value)
                      : updateSignupField("email", event.target.value)
                  }
                  placeholder="amina@example.com"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={authMode === "login" ? loginForm.password : signupForm.password}
                  onChange={(event) =>
                    authMode === "login"
                      ? updateLoginField("password", event.target.value)
                      : updateSignupField("password", event.target.value)
                  }
                  placeholder={authMode === "login" ? "Your password" : "Minimum 8 characters"}
                />
              </label>

              <button type="submit" disabled={busyState !== null}>
                {authMode === "login"
                  ? busyState === "login"
                    ? "Signing in..."
                    : "Sign in"
                  : busyState === "signup"
                    ? "Creating..."
                    : "Create account"}
              </button>
            </form>

            <div className="auth-footer-note">
              <span>DietTricks branding</span>
              <span>Clean first step</span>
              <span>Warm color language</span>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className="page-shell">
        <div className="reference-frame onboarding-frame">
          <aside className="onboarding-rail">
            <div className="brand-chip">DietTricks</div>
            <div className="onboarding-copy">
              <div className="eyebrow">First-time setup</div>
              <h2>Let&apos;s build your profile in three clean steps.</h2>
              <p>
                Start with body information, move into habits and food style, then finish with goal
                targeting. The progress rail fills as you move forward.
              </p>
            </div>

            <div className="onboarding-progress-card">
              <div className="progress-line">
                <span style={{ height: `${onboardingProgress}%` }} />
              </div>
              <div className="progress-steps">
                <button
                  type="button"
                  className={onboardingStep === 0 ? "progress-step active" : "progress-step"}
                  onClick={() => setOnboardingStep(0)}
                >
                  <strong>01</strong>
                  <span>Biometrics</span>
                </button>
                <button
                  type="button"
                  className={onboardingStep === 1 ? "progress-step active" : "progress-step"}
                  onClick={() => setOnboardingStep(1)}
                >
                  <strong>02</strong>
                  <span>Healthy life</span>
                </button>
                <button
                  type="button"
                  className={onboardingStep === 2 ? "progress-step active" : "progress-step"}
                  onClick={() => setOnboardingStep(2)}
                >
                  <strong>03</strong>
                  <span>Goal setup</span>
                </button>
              </div>
            </div>

            <button type="button" className="toolbar-button light" onClick={logout}>
              Log out
            </button>
          </aside>

          <section className="onboarding-stage">
            <div className="onboarding-stage-head">
              <div className="eyebrow">Step {onboardingStep + 1} of 3</div>
              <h1>
                {onboardingStep === 0
                  ? "Tell DietTricks about your body metrics."
                  : onboardingStep === 1
                    ? "Describe how you eat and move today."
                    : "Set the result you want to chase."}
              </h1>
              <p>{statusMessage}</p>
            </div>

            <form
              className="onboarding-form"
              onSubmit={(event) => {
                if (onboardingStep < 2) {
                  event.preventDefault();
                  goToNextStep();
                  return;
                }
                void handleProfileSubmit(event);
              }}
            >
              <div key={onboardingStep} className="onboarding-panel">
                {onboardingStep === 0 ? (
                  <div className="onboarding-grid">
                    <label>
                      Age
                      <input
                        type="number"
                        value={profileForm.age}
                        onChange={(event) => updateProfileField("age", event.target.value)}
                      />
                    </label>
                    <label>
                      Sex
                      <select
                        value={profileForm.sex}
                        onChange={(event) =>
                          updateProfileField("sex", event.target.value as BiologicalSex)
                        }
                      >
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Height (cm)
                      <input
                        type="number"
                        value={profileForm.heightCm}
                        onChange={(event) => updateProfileField("heightCm", event.target.value)}
                      />
                    </label>
                    <label>
                      Weight (kg)
                      <input
                        type="number"
                        value={profileForm.weightKg}
                        onChange={(event) => updateProfileField("weightKg", event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}

                {onboardingStep === 1 ? (
                  <div className="onboarding-grid">
                    <label>
                      Activity level
                      <select
                        value={profileForm.activityLevel}
                        onChange={(event) =>
                          updateProfileField("activityLevel", event.target.value as ActivityLevel)
                        }
                      >
                        <option value="sedentary">Sedentary</option>
                        <option value="light">Lightly active</option>
                        <option value="moderate">Moderately active</option>
                        <option value="active">Active</option>
                        <option value="very_active">Very active</option>
                      </select>
                    </label>
                    <label>
                      Workout days
                      <input
                        type="number"
                        min="1"
                        max="7"
                        value={profileForm.workoutsPerWeek}
                        onChange={(event) =>
                          updateProfileField("workoutsPerWeek", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Meals per day
                      <input
                        type="number"
                        min="3"
                        max="5"
                        value={profileForm.mealsPerDay}
                        onChange={(event) => updateProfileField("mealsPerDay", event.target.value)}
                      />
                    </label>
                    <label>
                      Dietary style
                      <select
                        value={profileForm.dietaryStyle}
                        onChange={(event) =>
                          updateProfileField("dietaryStyle", event.target.value as DietaryStyle)
                        }
                      >
                        <option value="balanced">Balanced</option>
                        <option value="vegetarian">Vegetarian</option>
                        <option value="vegan">Vegan</option>
                        <option value="pescatarian">Pescatarian</option>
                        <option value="high_protein">High protein</option>
                        <option value="low_carb">Low carb</option>
                      </select>
                    </label>
                    <label className="onboarding-span-two">
                      Foods you usually like
                      <input
                        value={profileForm.likes}
                        onChange={(event) => updateProfileField("likes", event.target.value)}
                        placeholder="salmon, oats, berries"
                      />
                    </label>
                    <label>
                      Dislikes
                      <input
                        value={profileForm.dislikes}
                        onChange={(event) => updateProfileField("dislikes", event.target.value)}
                        placeholder="mushrooms"
                      />
                    </label>
                    <label>
                      Allergies
                      <input
                        value={profileForm.allergies}
                        onChange={(event) => updateProfileField("allergies", event.target.value)}
                        placeholder="peanuts"
                      />
                    </label>
                  </div>
                ) : null}

                {onboardingStep === 2 ? (
                  <div className="onboarding-grid">
                    <label>
                      Goal
                      <select
                        value={profileForm.goal}
                        onChange={(event) => updateProfileField("goal", event.target.value as Goal)}
                      >
                        <option value="lose">Lose weight</option>
                        <option value="maintain">Maintain</option>
                        <option value="gain">Gain muscle</option>
                      </select>
                    </label>
                    <label>
                      Daily calorie target
                      <input
                        type="number"
                        value={profileForm.dailyCalorieTarget}
                        onChange={(event) =>
                          updateProfileField("dailyCalorieTarget", event.target.value)
                        }
                        placeholder="Leave blank for auto"
                      />
                    </label>
                    <label className="onboarding-span-two">
                      Notes
                      <textarea
                        value={profileForm.notes}
                        onChange={(event) => updateProfileField("notes", event.target.value)}
                        placeholder="Gym access, injuries, schedule, cooking time..."
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="onboarding-footer">
                <button
                  type="button"
                  className="step-button step-button-secondary"
                  onClick={goToPreviousStep}
                  disabled={onboardingStep === 0}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="step-button step-button-primary"
                  disabled={busyState === "profile"}
                >
                  {onboardingStep === 2
                    ? busyState === "profile"
                      ? "Building..."
                      : "Finish and build dashboard"
                    : "Continue"}
                </button>
              </div>
            </form>
          </section>
        </div>
        {renderLoadingOverlay()}
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="reference-frame dashboard-frame">
        <header className="dashboard-topbar">
          <div className="brand-chip">DietTricks</div>
          <nav className="top-nav">
            <button
              type="button"
              className={activeTab === "dashboard" ? "nav-chip active" : "nav-chip"}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={activeTab === "meals" ? "nav-chip active" : "nav-chip"}
              onClick={() => setActiveTab("meals")}
            >
              Meals
            </button>
            <button
              type="button"
              className={activeTab === "training" ? "nav-chip active" : "nav-chip"}
              onClick={() => setActiveTab("training")}
            >
              Training
            </button>
            <button
              type="button"
              className={activeTab === "profile" ? "nav-chip active" : "nav-chip"}
              onClick={() => setActiveTab("profile")}
            >
              Profile
            </button>
          </nav>
          <div className="toolbar-actions">
            {activeTab === "dashboard" ? (
              <button type="button" className="toolbar-button" onClick={handleRefreshPlan}>
                {busyState === "refresh" ? "Refreshing..." : "Refresh"}
              </button>
            ) : null}
            <div className="profile-pill">
              <div className="profile-pill-avatar">{getInitials(user.fullName)}</div>
              <div>
                <strong>{getFirstName(user.fullName)}</strong>
                <span>{user.email}</span>
              </div>
            </div>
            <button type="button" className="toolbar-button light" onClick={logout}>
              Log out
            </button>
          </div>
        </header>

        {renderActiveWindow()}
        {renderMealModal()}
        {renderLoadingOverlay()}
      </div>
    </div>
  );
}
