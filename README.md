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
| `RH` | Permissions par défaut : services, employés, comptes, validation et consultation des plannings |
| `CHEF_SERVICE` | Permissions par défaut : gestion des employés et plannings de **son** service, soumission à la RH |
| `ADMIN` | Permissions administratives par défaut ; l'accès global dépend des permissions attribuées |
| `EMPLOYE` | Consultation personnelle uniquement : son profil, ses horaires, ses plannings |

Workflow d'un planning : `BROUILLON` → (soumission chef) → `SOUMIS` → (RH) → `VALIDE` ou `REJETE`.

## Sécurité et permissions (appliquées côté serveur)

- **Toutes** les routes exigent un JWT (`authRequired`) — y compris `/api/services` (trou comblé).
- **Interface** : la navigation et les actions visibles sont filtrées par les permissions du compte, relues depuis `/api/auth/me` ; le rôle ne propose que les permissions par défaut à la création. Les routes gardent leurs contrôles `requirePermission`.
- **Export Emploi du temps** : réservé au rôle `RH` et à la permission `planning.export_edt` sur les exports simple et groupé. Sur une base existante, attribuer la permission avec `cd backend && node scripts/migrate-10-planning-export.js`.
- **Périmètre des données** : le chef reste limité à son service ; un compte sans `planning.view_all` est limité au service qui lui est associé. Le service ne change pas le menu ni les actions.
- **Employé** : accès limité à son espace personnel via `utilisateur.id_employe` ; aucune liste d'équipe, aucune écriture.
- **Comptes** (`/api/auth/users`, RH + ADMIN) : création/modification/désactivation limitées au rôle `CHEF_SERVICE` (un chef = un service) ; suppression = désactivation (`actif=0`, aucune donnée effacée) ; le rôle n'est jamais modifiable par API.
- **Employés** : création par un chef **forcée** dans son service ; transfert inter-service interdit au chef.

## Notifications (table `notification` câblée)

Émises automatiquement : soumission d'un planning → **tous les RH** ; décision RH (VALIDE/REJETE, avec motif) → **chef créateur** (+ copies RH/ADMIN). API personnelles : `GET /api/notifications`, `GET /api/notifications/non-lues/count` (badge 🔔), `PATCH /api/notifications/:id/lu`, `PATCH /api/notifications/marquer-tout-lu`. Toujours filtrées par `req.user.id_utilisateur`.

Formats de planning configurés sur le service (le nom du service ne détermine pas le modèle) :
- `PERIODES_FIXES` : matin / après-midi / soir avec entrée–sortie–durée (modèle du fichier Excel `EMPLOI DU TEMPS ZOMATEL`)
- `HORAIRE_LIBRE` : grille jours × créneaux horaires définis par le chef de service
- `SHIFT_POSTE` : grille jours × shifts × postes

Sur la base active déjà installée, exécuter une fois `backend/database/09_service_model_types.sql` pour activer le type `SHIFT_POSTE` et convertir les anciens formats configurés implicitement par le nom en configuration explicite.

## Module « Gestion du planning » (saisie directe en grille)

Page **`/planning/gestion`** (chef de service) : saisie directe façon Excel, sans formulaire unitaire.

- Service pré-sélectionné selon le chef connecté + sélection de la semaine (liste S-2 → S+10) ;
- grille `Employé × Lundi…Dimanche` limitée aux employés **du service du chef** ;
- clic sur une cellule : horaire `début - fin` (ex. `06:00 - 14:00`) ou statut `REPOS` / `CONGÉ` / `ABSENCE` ; modification et suppression directes ;
- durée calculée automatiquement par cellule, totaux hebdo par employé, comparaison à la référence (`heures planifiées / prévues / différence`) avec alerte de dépassement ;
- contrôles automatiques côté client **et** en base (triggers MariaDB) : heures valides, chevauchement, hors-semaine, employé hors service, congé/indisponibilité/récupération communiqués par la RH (bandeau d'alerte dans la cellule) ;
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

Pour une base active déjà installée, appliquer une fois la contrainte d'unicité des comptes Chef :

```bash
mysql -u root -p gestion_plannings_hotel < backend/database/10_one_chef_per_service.sql
```

Pour une base `zomatel_planning` existante, utiliser `backend/database/10_one_chef_per_service_legacy.sql` à la place. Ces migrations conservent les comptes existants et échouent sans les modifier si plusieurs comptes Chef sont déjà associés au même service ; résoudre alors ces doublons avant de relancer la migration.

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
4. **Soumission** : le chef soumet son planning (statut `SOUMIS`) ; les RH reçoivent une notification.
5. **Gestion des validations RH** : page `/validations` avec filtres par statut et une liste indiquant service, semaine, chef et date de soumission ; ouvrir un planning pour consulter les horaires, postes, absences et totaux, puis le valider ou le rejeter avec un motif obligatoire.
6. **Retour au chef** : le motif du rejet reste consultable et le planning `REJETE` peut être corrigé puis resoumis ; l'historique conserve les soumissions et décisions avec leur auteur et leur date.
7. **Emploi du temps** : seuls les comptes `RH` disposant de `planning.export_edt` peuvent exporter les plannings `VALIDE` en Excel ; l'export multi-plannings conserve le regroupement existant par semaine. L'impression PDF des plannings validés reste disponible.

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
