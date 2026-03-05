import {
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
  PlanResponse,
  Profile,
  StoredSession,
  User,
} from "./types";

const STORAGE_KEY = "nutriplan-session";

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

function MetricCard(props: { label: string; value: string; note: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
      <p>{props.note}</p>
    </article>
  );
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [user, setUser] = useState<User | null>(session?.user ?? null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [signupForm, setSignupForm] = useState(initialSignupForm);
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfileForm);
  const [statusMessage, setStatusMessage] = useState(
    "Create an account, save your intake profile, and the app will build your weekly diet and workout plan.",
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
            ? "Your saved profile is loaded. Adjust anything and regenerate the plan."
            : "Your account is ready. Complete the intake form to generate the first weekly plan.",
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
      handleAuthSuccess(response, "Account created. Complete your intake profile to build a plan.");
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
          ? "Welcome back. Your latest weekly plan is ready."
          : "Welcome back. Complete your intake profile to generate a plan.",
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
      setStatusMessage("Log in before saving your profile.");
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
      setStatusMessage("Weekly plan refreshed from your saved profile.");
    } catch (error) {
      setStatusMessage((error as Error).message);
    } finally {
      setBusyState(null);
    }
  }

  function logout() {
    setSession(null);
    setUser(null);
    setPlan(null);
    setProfileForm(initialProfileForm);
    setStatusMessage("You have been signed out.");
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="hero">
        <section className="hero-copy">
          <div className="eyebrow">Nutrition planner</div>
          <h1>NutriPlan Studio</h1>
          <p className="hero-text">
            A clean rebuild of the project with React, Vite, TypeScript, Python, and SQLite.
            Users enter body data, calorie targets, activity, likes, dislikes, and the app turns
            that into a weekly training split plus a daily meal structure.
          </p>
          <div className="hero-tags">
            <span>BMI-aware</span>
            <span>SQLite profile storage</span>
            <span>Weekly workouts</span>
            <span>Daily meal guidance</span>
          </div>
        </section>

        <aside className="hero-card">
          <div className="eyebrow">Current state</div>
          <div className="hero-user">{user?.fullName || "Guest"}</div>
          <div className="hero-subtitle">
            {user ? user.email : "Sign up or log in to start generating plans."}
          </div>
          <p>{hydrating ? "Loading saved session..." : statusMessage}</p>
          <div className="hero-actions">
            {user ? (
              <>
                <button type="button" className="ghost-button" onClick={handleRefreshPlan}>
                  Refresh plan
                </button>
                <button type="button" className="ghost-button" onClick={logout}>
                  Log out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: "smooth",
                  })
                }
              >
                Open auth forms
              </button>
            )}
          </div>
        </aside>
      </header>

      {!user ? (
        <main className="auth-grid">
          <section className="panel auth-panel">
            <div className="panel-kicker">Account access</div>
            <h2>Login and signup</h2>
            <div className="auth-columns">
              <form className="stack" onSubmit={handleSignup}>
                <h3>Create account</h3>
                <label>
                  Full name
                  <input
                    value={signupForm.fullName}
                    onChange={(event) => updateSignupField("fullName", event.target.value)}
                    placeholder="Amina Rahman"
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={signupForm.email}
                    onChange={(event) => updateSignupField("email", event.target.value)}
                    placeholder="amina@example.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={signupForm.password}
                    onChange={(event) => updateSignupField("password", event.target.value)}
                    placeholder="Minimum 8 characters"
                  />
                </label>
                <button type="submit" disabled={busyState !== null}>
                  {busyState === "signup" ? "Creating..." : "Sign up"}
                </button>
              </form>

              <form className="stack" onSubmit={handleLogin}>
                <h3>Open session</h3>
                <label>
                  Email
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => updateLoginField("email", event.target.value)}
                    placeholder="amina@example.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => updateLoginField("password", event.target.value)}
                    placeholder="Your password"
                  />
                </label>
                <button type="submit" disabled={busyState !== null}>
                  {busyState === "login" ? "Signing in..." : "Log in"}
                </button>
              </form>
            </div>
          </section>

          <aside className="panel preview-panel">
            <div className="panel-kicker">What the app collects</div>
            <h2>Planner inputs</h2>
            <ul className="feature-list">
              <li>Age, sex, height, weight, and weekly activity level</li>
              <li>Goal: lose, maintain, or gain</li>
              <li>Preferred calorie target and meals per day</li>
              <li>Diet style, favorite foods, dislikes, and allergies</li>
            </ul>
            <div className="taste-preview">
              <span>Sample output</span>
              <strong>4-day workout split + 7 daily meal cards</strong>
            </div>
          </aside>
        </main>
      ) : (
        <main className="dashboard-grid">
          <section className="panel intake-panel">
            <div className="panel-kicker">Intake profile</div>
            <h2>Body data and food preferences</h2>
            <form className="stack" onSubmit={handleProfileSubmit}>
              <div className="form-grid">
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
                  Workout days per week
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
              </div>

              <label>
                Foods you like
                <input
                  value={profileForm.likes}
                  onChange={(event) => updateProfileField("likes", event.target.value)}
                  placeholder="salmon, oats, berries"
                />
              </label>
              <label>
                Foods you dislike
                <input
                  value={profileForm.dislikes}
                  onChange={(event) => updateProfileField("dislikes", event.target.value)}
                  placeholder="mushrooms, mayonnaise"
                />
              </label>
              <label>
                Allergies or foods to avoid
                <input
                  value={profileForm.allergies}
                  onChange={(event) => updateProfileField("allergies", event.target.value)}
                  placeholder="peanuts, shellfish"
                />
              </label>
              <label>
                Notes
                <textarea
                  value={profileForm.notes}
                  onChange={(event) => updateProfileField("notes", event.target.value)}
                  placeholder="Optional context: gym access, injuries, training schedule, cooking time..."
                />
              </label>

              <button type="submit" disabled={busyState !== null}>
                {busyState === "profile" ? "Saving..." : "Save profile and generate plan"}
              </button>
            </form>
          </section>

          <section className="panel summary-panel">
            <div className="panel-kicker">Plan summary</div>
            <h2>Metrics and constraints</h2>
            {plan ? (
              <>
                <div className="metrics-grid">
                  <MetricCard
                    label="BMI"
                    value={`${plan.summary.bmi}`}
                    note={plan.summary.bmiCategory}
                  />
                  <MetricCard
                    label="Target calories"
                    value={`${plan.summary.calorieTarget} kcal`}
                    note={
                      plan.summary.calorieSource === "custom"
                        ? "Using your custom target"
                        : "Calculated from goal and activity"
                    }
                  />
                  <MetricCard
                    label="Protein"
                    value={`${plan.summary.proteinGrams} g/day`}
                    note="Suggested baseline for satiety and recovery"
                  />
                  <MetricCard
                    label="Hydration"
                    value={`${plan.summary.waterLiters} L/day`}
                    note="Estimated minimum based on body weight"
                  />
                </div>

                <div className="taste-block">
                  <div>
                    <span>Likes</span>
                    <p>{plan.profile.likes.length ? plan.profile.likes.join(", ") : "Not specified"}</p>
                  </div>
                  <div>
                    <span>Dislikes</span>
                    <p>
                      {plan.profile.dislikes.length
                        ? plan.profile.dislikes.join(", ")
                        : "Not specified"}
                    </p>
                  </div>
                  <div>
                    <span>Allergies</span>
                    <p>
                      {plan.profile.allergies.length
                        ? plan.profile.allergies.join(", ")
                        : "Not specified"}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                Save the intake form to calculate BMI, calories, hydration, and the full weekly
                plan.
              </div>
            )}

            <div className="chip-groups">
              <div>
                <span>Live likes preview</span>
                <div className="chip-row">
                  {likedFoods.length ? likedFoods.map((item) => <span key={item}>{item}</span>) : <span>None yet</span>}
                </div>
              </div>
              <div>
                <span>Dislikes</span>
                <div className="chip-row">
                  {dislikedFoods.length ? dislikedFoods.map((item) => <span key={item}>{item}</span>) : <span>None yet</span>}
                </div>
              </div>
              <div>
                <span>Allergies</span>
                <div className="chip-row">
                  {allergyFoods.length ? allergyFoods.map((item) => <span key={item}>{item}</span>) : <span>None yet</span>}
                </div>
              </div>
            </div>
          </section>

          <section className="panel workout-panel">
            <div className="panel-kicker">Weekly training</div>
            <h2>Workout structure</h2>
            {plan ? (
              <div className="plan-grid">
                {plan.workoutPlan.map((day) => (
                  <article key={day.day} className="plan-card">
                    <div className="plan-topline">
                      <strong>{day.day}</strong>
                      <span>{day.durationMinutes} min</span>
                    </div>
                    <h3>{day.focus}</h3>
                    <p className="intensity">{day.intensity}</p>
                    <ul className="detail-list">
                      {day.exercises.map((exercise) => (
                        <li key={exercise}>{exercise}</li>
                      ))}
                    </ul>
                    <p className="helper-text">{day.note}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">Your weekly workout split will appear here.</div>
            )}
          </section>

          <section className="panel meals-panel">
            <div className="panel-kicker">Daily food plan</div>
            <h2>Seven-day meal guidance</h2>
            {plan ? (
              <div className="meal-grid">
                {plan.mealPlan.map((day) => (
                  <article key={day.day} className="meal-card">
                    <div className="plan-topline">
                      <strong>{day.day}</strong>
                      <span>{day.totalCalories} kcal</span>
                    </div>
                    <div className="meal-list">
                      {day.meals.map((meal) => (
                        <section key={`${day.day}-${meal.name}`} className="meal-item">
                          <div className="meal-header">
                            <strong>{meal.name}</strong>
                            <span>{meal.calories} kcal</span>
                          </div>
                          <h3>{meal.title}</h3>
                          <p>{meal.summary}</p>
                        </section>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">Your seven-day meal structure will appear here.</div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
