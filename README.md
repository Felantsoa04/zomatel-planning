# Zomatel Planning — Application de gestion de plannings

Application de gestion des plannings hebdomadaires des services hôteliers Zomatel.

> **Base de données active : `gestion_plannings_hotel`** (voir section suivante).
> L'ancienne base `zomatel_planning` reste utilisable via les scripts `01_compat_alter.sql` / `schema.sql`.

- **Frontend** : Next.js 14 (App Router) + React 18 → http://localhost:3000
- **Backend** : Node.js + Express + MariaDB (API REST + JWT) → http://localhost:4000
- **Base de données** : MariaDB

## Rôles et workflow

| Rôle | Droits |
|---|---|
| `RH` | Crée les services, employés et comptes ; valide ou rejette les plannings ; consulte l'emploi du temps |
| `CHEF_SERVICE` | Crée les plannings de **son** service, saisit les affectations et créneaux, soumet à la RH |
| `ADMIN` | Vision globale : gestion des services (suppression), consultation de tous les employés et comptes |
| `EMPLOYE` | Consultation personnelle uniquement : son profil, ses horaires, ses plannings |

Workflow d'un planning : `BROUILLON` → (soumission chef) → `SOUMIS` → (RH) → `VALIDE` ou `REJETE`.

## Sécurité et permissions (appliquées côté serveur)

- **Toutes** les routes exigent un JWT (`authRequired`) — y compris `/api/services` (trou comblé).
- **Chef de service** : le paramètre `id_service` du client est **ignoré** — le filtrage utilise `req.user.id_service` (employés, plannings, affectations, créneaux, grille, couverture). Accès à un planning d'un autre service → `403`.
- **Employé** : accès limité à son espace personnel via `utilisateur.id_employe` ; aucune liste d'équipe, aucune écriture.
- **Comptes** (`/api/auth/users`, RH + ADMIN) : création/modification/désactivation limitées au rôle `CHEF_SERVICE` (un chef = un service) ; suppression = désactivation (`actif=0`, aucune donnée effacée) ; le rôle n'est jamais modifiable par API.
- **Employés** : création par un chef **forcée** dans son service ; transfert inter-service interdit au chef.

## Notifications (table `notification` câblée)

Émises automatiquement : soumission d'un planning → **tous les RH** ; décision RH (VALIDE/REJETE, avec motif) → **chef créateur** (+ copies RH/ADMIN). API personnelles : `GET /api/notifications`, `GET /api/notifications/non-lues/count` (badge 🔔), `PATCH /api/notifications/:id/lu`, `PATCH /api/notifications/marquer-tout-lu`. Toujours filtrées par `req.user.id_utilisateur`.

Deux types d'affichage par service :
- `PERIODES_FIXES` : matin / après-midi / soir avec entrée–sortie–durée (modèle du fichier Excel `EMPLOI DU TEMPS ZOMATEL`)
- `HORAIRE_LIBRE` : grille jours × créneaux horaires définis par le chef de service

## Module « Gestion du planning » (saisie directe en grille)

Page **`/planning/gestion`** (chef de service) : saisie directe façon Excel, sans formulaire unitaire.

- Service pré-sélectionné selon le chef connecté + sélection de la semaine (liste S-2 → S+10) ;
- grille `Employé × Lundi…Dimanche` limitée aux employés **du service du chef** ;
- clic sur une cellule : horaire `début - fin` (ex. `06:00 - 14:00`) ou statut `REPOS` / `CONGÉ` / `ABSENCE` ; modification et suppression directes ;
- durée calculée automatiquement par cellule, totaux hebdo par employé, comparaison à la référence (`heures planifiées / prévues / différence`) avec alerte de dépassement ;
- contrôles automatiques côté client **et** en base (triggers MariaDB) : heures valides, 8 h/jour max, chevauchement, hors-semaine, employé hors service, congé/indisponibilité/récupération communiqués par la RH (bandeau d'alerte dans la cellule) ;
- statuts : `BROUILLON` et `REJETE` modifiables, `SOUMIS` et `VALIDE` verrouillés ;
- actions : **Enregistrer brouillon** / **Vérifier le planning** / **Soumettre à la RH** (sauvegarde puis soumission).

API ajoutées : `GET|PUT /api/plannings/:id/grille`, `GET /api/plannings/:id/modifiable`, `PATCH /api/plannings/:id/soumettre` (élargi à `REJETE`). La sauvegarde de grille renvoie `207` avec le détail des cellules refusées (erreur affichée dans la cellule concernée, les autres cellules restent enregistrées).

Le Dashboard reste synthétique : il affiche désormais un bouton d'accès **« Gestion du planning »** mais ne sert jamais à la saisie des horaires.

## Comptes de démonstration

| Login | Mot de passe | Rôle |
|---|---|---|
| `admin` | `admin123` | ADMIN |
| `rh` | `rh123` | RH |
| `chef` | `chef123` | CHEF_SERVICE (Réception) |
| `employe` | `employe123` | EMPLOYE (lié à RAMORA) |

## Base `gestion_plannings_hotel` (base principale)

Base complète créée pour l'application, avec les règles métier appliquées **en base** par triggers :

| Règle | Application en base |
|---|---|
| 8 h de travail max par jour et par employé | `trg_creneau_bi/bu` (refus si total du jour > 8 h) |
| Conflits d'horaires (chevauchement de créneaux) | `trg_creneau_bi/bu` (refus si intersection) |
| Créneau sur repos/absence/congé interdit | `trg_creneau_bi/bu` |
| Affectation bornée à la semaine du planning | `trg_affectation_bi` |
| Validation planning réservée aux RH | `trg_validation_rh_bi` |
| Congé validé/refusé uniquement par un RH, avec traçabilité | `trg_conge_bi/bu` |
| Récupération saisie par RH/ADMIN/CHEF_SERVICE | `trg_recuperation_bi` |
| CHEF_SERVICE toujours rattaché à un service | `trg_utilisateur_bi/bu` |
| Max 3 créneaux (matin/après-midi/soir) par jour | `trg_creneau_bi` |

Installation :

```bash
mysql -u root -p < backend/database/gestion_plannings_hotel_schema.sql
mysql -u root -p < backend/database/gestion_plannings_hotel_seed.sql
```

Contenu : 15 tables (service, utilisateur, employe, type_horaire, planning, affectation, creneau_travail, conge, recuperation, indisponibilite, validation_rh, controle_couverture, besoin_couverture, historique_modification, jour_ferie, notification), 4 vues (`v_duree_creneau`, `v_duree_jour`, `v_total_hebdo_employe`, `v_emploi_du_temps`), 9 triggers.

Vues utiles :
- `v_total_hebdo_employe` : total hebdo + dépassement par employé/planning (contrat API)
- `v_emploi_du_temps` : emploi du temps généré (1 ligne employé × jour, colonnes matin/après-midi/soir)

Comptes de test : `admin`/`admin123`, `rh`/`rh123`, `chef`/`chef123` (chef du service Réception).

Le backend y est connecté via `DB_NAME=gestion_plannings_hotel` dans `backend/.env`.

## Ancienne base `zomatel_planning` (compatibilité)

## Installation de A à Z

### 1. Prérequis

- Node.js ≥ 18
- MariaDB ≥ 10.6 (service démarré)

### 2. Base de données

**Cas A — la base `zomatel_planning` existe déjà** (données conservées) :

```bash
# Mise à niveau non destructive : ajoute les colonnes/index/vues manquants
mysql -u root -p zomatel_planning < backend/database/01_compat_alter.sql

# Comptes de démonstration (non destructif)
mysql -u root -p zomatel_planning < backend/database/seed.sql
```

**Cas B — installation neuve** :

```bash
mysql -u root -p < backend/database/00_create_db.sql
mysql -u root -p zomatel_planning < backend/database/schema.sql
mysql -u root -p zomatel_planning < backend/database/seed.sql
```

Comptes de démonstration :
- RH : login `rh` / mot de passe `rh123`
- Chef de service (Réception) : login `chef` / mot de passe `chef123`
- Comptes préexistants (ex. `admin`, `chef_cuisine`, `chef_salle`) : conserver leur mot de passe d'origine ou le réinitialiser via `POST /api/auth/users` (RH) ou directement en base (hash bcrypt).

> NB : le mot de passe de l'utilisateur applicatif `zomatel_app` doit correspondre à `DB_PASSWORD` dans `backend/.env`. Réaligner si besoin :
> `ALTER USER 'zomatel_app'@'localhost' IDENTIFIED BY 'zomatel_dev_2026';`

### 3. Backend

```bash
cd backend
npm install
npm run dev        # API sur http://localhost:4000
```

Le fichier `backend/.env` doit contenir :

```env
PORT=4000
CORS_ORIGIN=http://localhost:3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=zomatel_app
DB_PASSWORD=zomatel_dev_2026
DB_NAME=zomatel_planning
JWT_SECRET=une_longue_chaine_aleatoire
JWT_EXPIRES_IN=8h
```

Vérification : `curl http://localhost:4000/api/health` → `{"status":"ok"}`

### 4. Frontend

```bash
cd frontend
npm install
npm run dev        # Interface sur http://localhost:3000
```

Le fichier `frontend/.env.local` doit contenir :

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

## Utilisation

1. **Connexion** sur `/login` (ex. `rh` / `rh123`).
2. **RH — référentiels** :
   - `/service` : créer les services (RECEPTION → périodes fixes, STOCK → horaire libre)
   - `/employees` : ajouter les employés (matricule, statut, service, référence hebdo 44 h / 48 h)
   - Créer les comptes chef de service via `POST /api/auth/users` (réservé RH)
3. **Chef de service — planning** :
   - `/planning/new` : choisir lundi → dimanche (n° de semaine ISO calculé automatiquement)
   - `/planning/[id]` : cliquer sur une case employé × jour pour saisir le statut (Travail / Repos / Absence / Congé) et les créneaux (entrée/sortie par période)
4. **Soumission** : bouton « Soumettre à la RH » (statut devient `SOUMIS`)
5. **Validation RH** : boutons Valider / Rejeter avec motif (statut `VALIDE`/`REJETE`)
6. **Emploi du temps** : vue reproduisant le modèle Excel — un bloc par jour (périodes en colonnes, entrée/sortie/durée), totaux par période/jour, bloc RECAP hebdomadaire avec alerte de dépassement, impression PDF via le bouton dédié.

## Structure du projet

```
backend/
├── database/
│   ├── 00_create_db.sql     # base + utilisateur (installation neuve)
│   ├── 01_compat_alter.sql  # mise à niveau NON destructive de la base existante
│   ├── schema.sql           # tables + vues (référence, installation neuve)
│   └── seed.sql             # comptes/types de démonstration (idempotent)
└── src/
    ├── config/db.js         # pool mysql2 → MariaDB
    ├── controllers/         # auth, service, employe, planning, affectation, creneau, validation, couverture, recuperation
    ├── middleware/          # authRequired (JWT), requireRole, errorHandler
    ├── routes/              # /api/auth, /api/services, /api/employes, /api/plannings, ...
    ├── utils/               # jwt, historique (traçabilité)
    ├── app.js
    └── server.js

frontend/
└── src/
    ├── app/
    │   ├── login/           # page de connexion
    │   ├── dashboard/       # liste des plannings
    │   ├── planning/new/    # création d'un planning hebdo
    │   ├── planning/[id]/   # détail : saisie + validation + vue EDT
    │   ├── employees/       # gestion des employés
    │   └── service/         # gestion des services
    ├── components/          # Navbar, EmploiDuTemps (modèle Excel), AffectationsHoraireLibre
    └── lib/                 # api.js (fetch + JWT), auth.js (session)
```

## Sécurité — avant mise en production

- [ ] Changer `JWT_SECRET` et les mots de passe des comptes
- [ ] Supprimer les comptes de démonstration (`seed.sql`)
- [ ] Remplacer le localStorage par des cookies httpOnly pour la session
- [ ] Restreindre `CORS_ORIGIN` au domaine réel
