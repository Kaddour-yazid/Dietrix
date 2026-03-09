export type Goal = "lose" | "maintain" | "gain";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type BiologicalSex = "male" | "female" | "other";
export type DietaryStyle =
  | "balanced"
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "high_protein"
  | "low_carb";

export interface User {
  id: number;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface Profile {
  age: number;
  sex: BiologicalSex;
  heightCm: number;
  weightKg: number;
  goal: Goal;
  activityLevel: ActivityLevel;
  workoutsPerWeek: number;
  dailyCalorieTarget: number | null;
  mealsPerDay: number;
  dietaryStyle: DietaryStyle;
  likes: string[];
  dislikes: string[];
  allergies: string[];
  notes: string;
  updatedAt: string;
}

export interface Summary {
  bmi: number;
  bmiCategory: string;
  bmr: number;
  maintenanceCalories: number;
  recommendedCalories: number;
  calorieTarget: number;
  calorieSource: "custom" | "calculated";
  proteinGrams: number;
  waterLiters: number;
}

export interface WorkoutDay {
  day: string;
  kind: string;
  focus: string;
  durationMinutes: number;
  intensity: string;
  exercises: string[];
  note: string;
  suggestedWindow: string;
}

export interface MealEntry {
  name: string;
  title: string;
  calories: number;
  summary: string;
  timeLabel: string;
  timingContext: string;
  imageUrl: string;
  proteinGrams: number;
  carbsGrams: number;
  fatsGrams: number;
  cookTimeMinutes: number;
  ingredients: string[];
  steps: string[];
}

export interface MealDay {
  day: string;
  totalCalories: number;
  meals: MealEntry[];
}

export interface ProgressSnapshot {
  todayCalories: number;
  todayWaterMl: number;
  caloriePercent: number;
  completedMeals: string[];
  completedWorkouts: string[];
  workoutStreak: number;
  completedWorkoutsCount: number;
}

export interface AiMeta {
  provider: string;
  model: string | null;
  applied: boolean;
  changed: boolean;
}

export interface PlanResponse {
  user: User;
  profile: Profile;
  summary: Summary;
  aiMeta: AiMeta;
  progress: ProgressSnapshot;
  workoutPlan: WorkoutDay[];
  mealPlan: MealDay[];
}

export interface AuthResponse {
  token: string;
  user: User;
  profile: Profile | null;
  plan: PlanResponse | null;
}

export interface MeResponse {
  user: User;
  profile: Profile | null;
  plan: PlanResponse | null;
}

export interface StoredSession {
  token: string;
  user: User;
}
