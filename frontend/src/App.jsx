import { startTransition, useDeferredValue, useEffect, useState } from "react";

const API_URL = "http://127.0.0.1:5002/api";

const initialRegister = {
  username: "",
  password: "",
  role: "student",
  note: "",
  theme: "citrus",
};

const initialLogin = {
  username: "",
  password: "",
};

const initialSurvey = {
  favorite_dish: "",
  meals_per_day: "3",
  snacks_per_week: "4",
  water_per_day: "1.5L",
  diet_style: "omnivore",
  allergies: "",
  comments: "",
  visibility: "public",
};

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem("nutriform-session")) || null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(() => readSession());
  const [registerForm, setRegisterForm] = useState(initialRegister);
  const [loginForm, setLoginForm] = useState(initialLogin);
  const [profileForm, setProfileForm] = useState({ note: "", theme: "citrus" });
  const [surveyForm, setSurveyForm] = useState(initialSurvey);
  const [surveys, setSurveys] = useState([]);
  const [profile, setProfile] = useState(null);
  const [adminData, setAdminData] = useState({ users: [], surveys: [] });
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Questionnaire nutritionnel premium. Securite faible.");
  const deferredSearch = useDeferredValue(search);

  const filteredSurveys = !deferredSearch.trim()
    ? surveys
    : surveys.filter((survey) => {
        const term = deferredSearch.toLowerCase();
        return (
          survey.username.toLowerCase().includes(term) ||
          survey.favorite_dish.toLowerCase().includes(term) ||
          survey.comments.toLowerCase().includes(term)
        );
      });

  useEffect(() => {
    loadSurveys();
  }, []);

  useEffect(() => {
    if (session?.username) {
      window.localStorage.setItem("nutriform-session", JSON.stringify(session));
      loadProfile(session.username);
    } else {
      window.localStorage.removeItem("nutriform-session");
      setProfile(null);
    }
  }, [session]);

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Role": session?.role || "guest",
      },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Erreur API");
    }
    return data;
  }

  async function loadSurveys() {
    const data = await api("/surveys");
    setSurveys(data);
  }

  async function loadProfile(username) {
    const data = await api(`/profile/${username}`);
    setProfile(data);
    setProfileForm({
      note: data.user.note || "",
      theme: data.user.theme || "citrus",
    });
  }

  async function handleRegister(event) {
    event.preventDefault();
    try {
      const data = await api("/register", {
        method: "POST",
        body: JSON.stringify(registerForm),
      });
      setMessage(data.message);
      startTransition(() => {
        setSession({
          username: data.user.username,
          role: data.user.role,
          note: data.user.note,
          theme: data.user.theme,
          token: "client-generated",
        });
      });
      setRegisterForm(initialRegister);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    try {
      const data = await api("/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });
      setSession(data);
      setMessage(`Bienvenue ${data.username}.`);
      setLoginForm(initialLogin);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    if (!session?.username) {
      setMessage("Connecte-toi pour modifier ton profil.");
      return;
    }

    try {
      const data = await api(`/profile/${session.username}`, {
        method: "POST",
        body: JSON.stringify(profileForm),
      });
      setMessage(data.message);
      await loadProfile(session.username);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleSurveySubmit(event) {
    event.preventDefault();
    if (!session?.username) {
      setMessage("Connecte-toi pour envoyer le questionnaire.");
      return;
    }

    try {
      const data = await api("/surveys", {
        method: "POST",
        body: JSON.stringify({
          ...surveyForm,
          username: session.username,
        }),
      });
      setMessage(data.message);
      setSurveyForm(initialSurvey);
      await loadSurveys();
      await loadProfile(session.username);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleAdminLoad() {
    try {
      const data = await api("/admin/surveys?admin=1");
      setAdminData(data);
      setMessage("Console admin chargee.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function logout() {
    setSession(null);
    setAdminData({ users: [], surveys: [] });
    setMessage("Session supprimee cote navigateur.");
  }

  return (
    <div className="shell">
      <div className="background-blur background-blur-left" />
      <div className="background-blur background-blur-right" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">React + Python nutrition form</p>
          <h1>NutriForm Lab</h1>
          <p className="lede">
            Une application inspiree d&apos;un formulaire sur les habitudes alimentaires:
            plat prefere, frequence des repas, collations, eau bue et commentaires libres.
          </p>
          <div className="hero-badges">
            <span>Formulaire nutrition</span>
            <span>SQL injection</span>
            <span>XSS stockee</span>
            <span>Broken access control</span>
          </div>
        </div>

        <aside className="status-card">
          <div className="status-label">Etat client</div>
          <div className="status-value">{session?.username || "Invite"}</div>
          <div className="status-subvalue">Role: {session?.role || "guest"}</div>
          <p>{message}</p>
          <div className="status-actions">
            <button className="ghost" onClick={loadSurveys}>Actualiser</button>
            <button className="ghost" onClick={handleAdminLoad}>Charger admin</button>
            <button className="ghost" onClick={logout}>Effacer session</button>
          </div>
        </aside>
      </header>

      <main className="grid">
        <section className="panel auth-panel">
          <div className="panel-title">Comptes</div>
          <div className="columns">
            <form className="stack" onSubmit={handleRegister}>
              <h2>Inscription</h2>
              <input
                value={registerForm.username}
                onChange={(event) =>
                  setRegisterForm({ ...registerForm, username: event.target.value })
                }
                placeholder="Nom d'utilisateur"
              />
              <input
                type="password"
                value={registerForm.password}
                onChange={(event) =>
                  setRegisterForm({ ...registerForm, password: event.target.value })
                }
                placeholder="Mot de passe"
              />
              <select
                value={registerForm.role}
                onChange={(event) =>
                  setRegisterForm({ ...registerForm, role: event.target.value })
                }
              >
                <option value="student">student</option>
                <option value="admin">admin</option>
              </select>
              <select
                value={registerForm.theme}
                onChange={(event) =>
                  setRegisterForm({ ...registerForm, theme: event.target.value })
                }
              >
                <option value="citrus">Citrus</option>
                <option value="forest">Forest</option>
                <option value="midnight">Midnight</option>
              </select>
              <textarea
                value={registerForm.note}
                onChange={(event) =>
                  setRegisterForm({ ...registerForm, note: event.target.value })
                }
                placeholder="Note personnelle HTML"
              />
              <button type="submit">Creer le compte</button>
            </form>

            <form className="stack" onSubmit={handleLogin}>
              <h2>Connexion</h2>
              <input
                value={loginForm.username}
                onChange={(event) =>
                  setLoginForm({ ...loginForm, username: event.target.value })
                }
                placeholder="Nom d'utilisateur"
              />
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm({ ...loginForm, password: event.target.value })
                }
                placeholder="Mot de passe"
              />
              <button type="submit">Ouvrir la session</button>
              <div className="hint">Compte initial: admin / Admin123!</div>
            </form>
          </div>
        </section>

        <section className="panel composer-panel">
          <div className="panel-title">Questionnaire</div>
          <div className="columns">
            <form className="stack" onSubmit={handleSurveySubmit}>
              <h2>Habitudes alimentaires</h2>
              <input
                value={surveyForm.favorite_dish}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, favorite_dish: event.target.value })
                }
                placeholder="Plat prefere"
              />
              <select
                value={surveyForm.meals_per_day}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, meals_per_day: event.target.value })
                }
              >
                <option value="1">1 repas</option>
                <option value="2">2 repas</option>
                <option value="3">3 repas</option>
                <option value="4+">4 repas ou plus</option>
              </select>
              <select
                value={surveyForm.snacks_per_week}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, snacks_per_week: event.target.value })
                }
              >
                <option value="0">0 collation</option>
                <option value="1-3">1 a 3</option>
                <option value="4-7">4 a 7</option>
                <option value="8+">8 ou plus</option>
              </select>
              <select
                value={surveyForm.water_per_day}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, water_per_day: event.target.value })
                }
              >
                <option value="<1L">moins de 1L</option>
                <option value="1.5L">1.5L</option>
                <option value="2L">2L</option>
                <option value="3L+">3L ou plus</option>
              </select>
              <select
                value={surveyForm.diet_style}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, diet_style: event.target.value })
                }
              >
                <option value="omnivore">omnivore</option>
                <option value="vegetarien">vegetarien</option>
                <option value="vegan">vegan</option>
                <option value="sans-gluten">sans gluten</option>
              </select>
              <input
                value={surveyForm.allergies}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, allergies: event.target.value })
                }
                placeholder="Allergies"
              />
              <textarea
                value={surveyForm.comments}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, comments: event.target.value })
                }
                placeholder="Commentaires libres"
              />
              <select
                value={surveyForm.visibility}
                onChange={(event) =>
                  setSurveyForm({ ...surveyForm, visibility: event.target.value })
                }
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
              <button type="submit">Envoyer le formulaire</button>
            </form>

            <form className="stack" onSubmit={handleProfileSave}>
              <h2>Profil repondant</h2>
              <select
                value={profileForm.theme}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, theme: event.target.value })
                }
              >
                <option value="citrus">Citrus</option>
                <option value="forest">Forest</option>
                <option value="midnight">Midnight</option>
              </select>
              <textarea
                value={profileForm.note}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, note: event.target.value })
                }
                placeholder="Description du profil"
              />
              <button type="submit">Sauver le profil</button>

              {profile?.user && (
                <div className={`profile-preview theme-${profile.user.theme || "citrus"}`}>
                  <div>
                    <div className="profile-meta">Profil public</div>
                    <h3>{profile.user.username}</h3>
                    <p>Role: {profile.user.role}</p>
                  </div>
                  <div
                    className="bio-html"
                    dangerouslySetInnerHTML={{
                      __html: profile.user.note || "<i>Aucune note</i>",
                    }}
                  />
                </div>
              )}
            </form>
          </div>
        </section>

        <section className="panel feed-panel">
          <div className="feed-header">
            <div>
              <div className="panel-title">Reponses publiques</div>
              <h2>Tableau nutritionnel</h2>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Chercher un plat ou un commentaire"
            />
          </div>

          <div className="post-list">
            {filteredSurveys.map((survey) => (
              <article key={survey.id} className="post-card">
                <div className="post-topline">
                  <strong>{survey.username}</strong>
                  <span>{survey.diet_style}</span>
                </div>
                <div className="survey-grid">
                  <div>
                    <span className="muted-label">Plat prefere</span>
                    <div
                      className="post-body"
                      dangerouslySetInnerHTML={{ __html: survey.favorite_dish }}
                    />
                  </div>
                  <div>
                    <span className="muted-label">Repas / jour</span>
                    <div>{survey.meals_per_day}</div>
                  </div>
                  <div>
                    <span className="muted-label">Collations / semaine</span>
                    <div>{survey.snacks_per_week}</div>
                  </div>
                  <div>
                    <span className="muted-label">Eau / jour</span>
                    <div>{survey.water_per_day}</div>
                  </div>
                  <div>
                    <span className="muted-label">Allergies</span>
                    <div>{survey.allergies || "Aucune"}</div>
                  </div>
                  <div>
                    <span className="muted-label">Visibilite</span>
                    <div>{survey.visibility}</div>
                  </div>
                </div>
                <div
                  className="post-body"
                  dangerouslySetInnerHTML={{ __html: survey.comments || "<i>Sans commentaire</i>" }}
                />
              </article>
            ))}
          </div>
        </section>

        <section className="panel admin-panel">
          <div className="panel-title">Console admin</div>
          <h2>Acces aux comptes et aux reponses</h2>
          <p>Le controle d&apos;acces repose surtout sur les parametres et le role cote client.</p>
          <div className="admin-layout">
            <div className="admin-grid">
              {adminData.users.map((user) => (
                <div key={user.id} className="admin-card">
                  <div className="admin-head">
                    <strong>{user.username}</strong>
                    <span>{user.role}</span>
                  </div>
                  <div>Mot de passe: {user.password}</div>
                  <div>Theme: {user.theme}</div>
                  <div
                    className="bio-html"
                    dangerouslySetInnerHTML={{ __html: user.note || "<i>Sans note</i>" }}
                  />
                </div>
              ))}
            </div>

            <div className="admin-grid">
              {adminData.surveys.map((survey) => (
                <div key={survey.id} className="admin-card">
                  <div className="admin-head">
                    <strong>{survey.username}</strong>
                    <span>{survey.visibility}</span>
                  </div>
                  <div>Plat: {survey.favorite_dish}</div>
                  <div>Repas/jour: {survey.meals_per_day}</div>
                  <div>Collations/semaine: {survey.snacks_per_week}</div>
                  <div>Eau/jour: {survey.water_per_day}</div>
                  <div>Regime: {survey.diet_style}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
