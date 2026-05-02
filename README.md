# DietTricks

DietTricks is a diet and training planner built with:

- `frontend/`: React + Vite + TypeScript
- `backend_api/`: Flask API + SQLite
- `backend_api/nutriplan.db`: local database created automatically

The app is now a local-first build. Supabase is not used. User accounts, profile data, meal logs, workout logs, and water logs are stored in SQLite.
SQLCipher can be enabled for the main backend database through `NUTRIPLAN_DB_PASSPHRASE`.

## What We Changed

- rebuilt the active app around `frontend/` + `backend_api/`
- replaced remote/cloud persistence with local SQLite
- added signup, login, signed auth tokens, and profile save
- added a 3-step onboarding flow for first-time users
- redesigned the UI into a cleaner DietTricks dashboard with separate windows:
  - `Dashboard`
  - `Meals`
  - `Training`
  - `Profile`
- added weekly meal scheduling with:
  - meal timing
  - meal detail modal
  - nutrition details
  - ingredient amounts
  - cooking steps
  - `Mark as eaten`
- added weekly training scheduling with:
  - daily workout focus
  - recovery days
  - `Finish workout`
- added dashboard progress tracking for:
  - calories
  - water
  - workout streak
  - completed meals
  - completed workouts
- added time gating:
  - meals can only be logged inside their meal window
  - workouts can only be completed for the current day
- added optional local AI integration through Ollama

## Stack

- React 19
- Vite 7
- TypeScript 5
- Flask 3
- SQLite
- SQLCipher (optional, for encrypted local storage)
- Ollama (optional)

## Project Structure

```text
mlds/
├─ backend_api/
│  ├─ app.py
│  └─ nutriplan.db
├─ frontend/
│  ├─ src/
│  └─ package.json
├─ package.json
├─ requirements.txt
└─ .env.example
```

## Run Locally

### 1. Install Python dependencies

```powershell
cd C:\Users\Click\Desktop\diet\mlds
py -3 -m venv .venv
.venv\Scripts\activate
py -3 -m pip install -r requirements.txt
```

### 2. Install frontend dependencies

```powershell
cd C:\Users\Click\Desktop\diet\mlds
cmd /c npm run frontend:install
```

### 3. Start the backend

```powershell
cd C:\Users\Click\Desktop\diet\mlds
py -3 backend_api\app.py
```

Backend:

- `http://127.0.0.1:5002`

### 4. Start the frontend in a second terminal

```powershell
cd C:\Users\Click\Desktop\diet\mlds
cmd /c npm run frontend:dev
```

Frontend:

- `http://localhost:5173`

If `5173` is busy, Vite will print another port such as `5174`.

## French Execution Guide

For a full French walkthrough with installation, PowerShell commands, Ollama setup, and troubleshooting, see:

- `docs/guide_execution_projet_fr.txt`

That guide covers:

- Windows prerequisites and installation of Python and Node.js
- creation and activation of the virtual environment
- backend and frontend startup commands
- optional Ollama setup and verification
- common execution issues and fixes

## Optional Local AI With Ollama

DietTricks works without AI. If Ollama is installed, the backend can try a local model to refine meals and workouts.

### Install and pull a model

```powershell
ollama pull deepseek-r1:1.5b
```

If Ollama is already running, `ollama serve` may show a port-in-use message. That is fine.

### Configure environment

Create `C:\Users\Click\Desktop\diet\mlds\.env` from `.env.example`.

Example:

```env
OLLAMA_ENABLED=1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=deepseek-r1:1.5b
OLLAMA_TIMEOUT_SECONDS=120
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
NUTRIPLAN_DB_PASSPHRASE=change_me_before_using_sqlcipher
```

Notes:

- `.env` is ignored and should not be committed.
- OpenAI is optional.
- `OLLAMA_TIMEOUT_SECONDS=120` gives the backend more time to wait for slower local model responses.
- If no AI provider is available, the app falls back to the built-in rule-based planner.

## Optional Database Encryption With SQLCipher

If you want the main backend database encrypted at rest, set `NUTRIPLAN_DB_PASSPHRASE` in `.env`.

For a brand-new database:

- set `NUTRIPLAN_DB_PASSPHRASE`
- start the backend normally
- `backend_api/nutriplan.db` will be created as a SQLCipher database

For the existing plaintext `backend_api/nutriplan.db` already in this repo:

```powershell
cd C:\Users\Click\Desktop\diet\mlds
py -3 backend_api\migrate_to_sqlcipher.py
```

That script:

- exports the current plaintext SQLite database into an encrypted SQLCipher database
- replaces `backend_api/nutriplan.db` with the encrypted version
- keeps a backup at `backend_api/nutriplan.plaintext.bak`

After migration, keep `NUTRIPLAN_DB_PASSPHRASE` set before starting the backend.

## How The App Works

### Authentication

- user signs up or logs in
- backend returns a signed token
- frontend stores the session locally

### First-time flow

- if no saved profile exists, the user goes through onboarding
- onboarding collects:
  - biometrics
  - health habits
  - goal and food setup

### Profile save

- the profile is stored in SQLite
- backend generates:
  - summary metrics
  - meal plan
  - workout plan
  - progress snapshot

### Meals

- meals are grouped by day
- each meal has:
  - title
  - time
  - calories
  - protein/carbs/fats
  - ingredient amounts
  - cooking steps
- `Mark as eaten` logs the meal and updates calories on the dashboard

### Training

- training is grouped by day
- current-day workouts can be completed
- recovery days are shown clearly
- completed workouts increase the streak/progress state

### Water

- water is logged from the dashboard
- quick buttons update the water ring
- target water is personalized from profile data

## Useful Commands

Backend syntax check:

```powershell
cd C:\Users\Click\Desktop\diet\mlds
py -3 -m py_compile backend_api\app.py
```

Frontend production build:

```powershell
cd C:\Users\Click\Desktop\diet\mlds
cmd /c npm run frontend:build
```

## Notes For Teammates

- the active app is only `frontend/` + `backend_api/`
- the SQLite database is created automatically on first backend start
- do not commit `.env`
- if frontend changes do not appear, hard refresh with `Ctrl + F5`
- if water or workout logging looks stale, make sure the backend was restarted after code changes

## Current Limitations

- Ollama integration exists, but local model quality depends on the model and machine speed
- the built-in planner is still the most stable fallback
- the repo may still show non-blocking Vite/Tailwind/Browserslist warnings in development
