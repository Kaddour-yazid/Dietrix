# NutriPlan Studio

Rebuild of the project as a nutrition and workout planning app with:

- `frontend/`: React + Vite + TypeScript
- `backend_api/`: Python + Flask API
- `backend_api/nutriplan.db`: SQLite database created automatically

## Current MVP

- signup and login
- password hashing
- signed bearer tokens
- one saved intake profile per user
- BMI, calorie, protein, and hydration estimates
- generated 7-day meal guidance
- generated weekly workout plan

## Stack

- React 19
- Vite 7
- TypeScript 5
- Flask 3
- SQLite

## Run locally

1. Create a virtual environment and install Python dependencies:

```bash
py -3 -m venv .venv
.venv\Scripts\activate
py -3 -m pip install -r requirements.txt
```

2. Install frontend dependencies:

```bash
npm run frontend:install
```

3. Start the backend:

```bash
npm run backend:dev
```

4. Start the frontend in a second terminal:

```bash
npm run frontend:dev
```

Frontend URL:

- `http://localhost:5173`

Backend URL:

- `http://127.0.0.1:5002`

## Notes

- The SQLite database is created on first backend start.
- Set `NUTRIPLAN_SECRET_KEY` if you want a non-default signing secret.
- The older Flask demo folders are still present in the repository, but the active app is now `frontend/` + `backend_api/`.
