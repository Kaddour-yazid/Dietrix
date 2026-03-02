# Secure Software Development Demo

Projet pedagogique pour un module de developpement logiciel securise.

## Version principale React + Python

Le depot contient maintenant une version moderne separee en deux parties :

- `frontend/` : interface React du questionnaire nutritionnel
- `backend_api/` : API Flask volontairement vulnerable

Cette version est celle a privilegier pour la demonstration du module.

## Anciennes versions Flask

Les dossiers suivants restent presents pour une comparaison simple serveur-rendu :

- `insecure_app/` : version Flask vulnerable
- `secure_app/` : version Flask corrigee

## Fonctionnalites

- inscription et connexion
- affichage d'un profil
- publication de messages
- panneau d'administration

## Scenario pedagogique

L'application simule un formulaire sur les habitudes nutritionnelles :

- plat prefere
- nombre de repas par jour
- nombre de collations par semaine
- quantite d'eau bue par jour
- type de regime
- allergies
- commentaires libres

## Vulnerabilites montrees dans `backend_api` + `frontend`

- mots de passe stockes en clair
- injection SQL dans la connexion et la recherche
- XSS stockee dans les champs libres et rendu HTML brut dans React
- controle d'acces casse sur la vue admin
- secret en dur
- session stockee dans `localStorage`
- absence de validation d'entree
- absence de protection CSRF
- endpoint debug exposant les utilisateurs
- endpoint de reset non protege
- CORS permissif

## Corrections dans `secure_app`

- hash des mots de passe
- requetes SQL parametrees
- echappement des contenus HTML
- verification serveur du role admin
- configuration de session plus sure
- validation des entrees
- jetons CSRF

## Installation

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
npm run frontend:install
```

## Lancement

API vulnerable du questionnaire :

```bash
python backend_api/app.py
```

Frontend React :

```bash
npm run frontend:dev
```

Important : lance l'API et le frontend dans deux terminaux differents, car `python backend_api/app.py` bloque le terminal tant que le serveur tourne.

Versions Flask :

```bash
python insecure_app/app.py
python secure_app/app.py
```

Les applications utilisent des bases SQLite separees dans leur dossier.

Compte admin initialise :

- utilisateur : `admin`
- mot de passe : `Admin123!`

## Usage attendu pour le module

1. Montrer les failles dans le formulaire nutritionnel `backend_api/` et `frontend/`.
2. Expliquer leur impact.
3. Montrer ensuite les corrections presentes dans `secure_app`.
4. Comparer les implementations avec `docs/vulnerabilities.md`.
