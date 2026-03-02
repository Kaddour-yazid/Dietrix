# Comparaison des failles et des corrections

## Nouvelle version React + API Python

Le frontend React et le backend Flask implementent un questionnaire nutritionnel inspire d'un formulaire classique :

- plat prefere
- nombre de repas par jour
- nombre de collations par semaine
- eau bue par jour
- type de regime
- allergies
- commentaires libres

Les mauvaises pratiques restent volontaires pour servir de base de remediation.

### Failles cote backend

- stockage des mots de passe en clair
- injection SQL dans `/api/login`, `/api/surveys` et `/api/profile/<username>`
- mise a jour de profil sans verification d'identite
- elevation de privilege via le role envoye a l'inscription
- endpoint admin contournable avec `?admin=1`
- endpoint debug ouvert
- endpoint reset ouvert
- configuration CORS tres permissive

### Failles cote frontend

- session stockee dans `localStorage`
- role client reutilise pour les requetes
- affichage HTML via `dangerouslySetInnerHTML`
- aucune validation ou sanitation des saisies
- logique d'affichage admin basee sur des donnees client

## 1. Stockage des mots de passe

- `insecure_app` stocke les mots de passe en clair dans SQLite.
- `secure_app` utilise `generate_password_hash()` et `check_password_hash()`.

## 2. Injection SQL

- `insecure_app` construit la requete de connexion avec une concatenation de chaines.
- `secure_app` utilise des requetes parametrees.

Exemple d'attaque sur la version vulnerable :

```text
username: admin' --
password: n'importe quoi
```

## 3. Cross-Site Scripting

- `insecure_app` rend la bio et les messages avec `|safe`.
- `secure_app` laisse l'auto-escaping Jinja proteger l'affichage.

## 4. Controle d'acces

- `insecure_app` accepte `?admin=1` pour afficher le panneau admin.
- `secure_app` impose un controle strict base sur la session serveur.

## 5. Session management

- `insecure_app` utilise une cle de session en dur et des cookies peu proteges.
- `secure_app` permet de definir la cle par variable d'environnement et active des options de cookies plus sures.

## 6. Validation des donnees

- `insecure_app` accepte presque toutes les entrees.
- `secure_app` verifie longueur, format et contenu.

## 7. CSRF

- `insecure_app` ne protege aucun formulaire.
- `secure_app` ajoute un jeton CSRF a tous les formulaires sensibles.

## Conseils pour ton rapport

- montrer le code vulnerable
- montrer un petit scenario d'exploitation
- montrer le code corrige
- conclure sur la reduction de risque
