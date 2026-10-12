# Copilot instructions for Zomatel Planning

This repository is a hotel weekly-planning application, not a generic CRUD app. The source of truth for business rules lives in the MariaDB schema, views, and triggers under `backend/database/`, while the API and UI mirror those rules for service-scoped schedules, role permissions, and weekly planning workflows.

## Build, test, and lint commands

### Local setup

```bash
cd backend && npm install
cd frontend && npm install

cd backend && npm run dev    # API on http://localhost:4000
cd frontend && npm run dev   # UI on http://localhost:3000
```

### Frontend build

```bash
cd frontend && npm run build
```

### Health check

```bash
curl http://localhost:4000/api/health
```

### Database setup

```bash
mysql -u root -p < backend/database/gestion_plannings_hotel_schema.sql
mysql -u root -p < backend/database/gestion_plannings_hotel_seed.sql
```

### Single-feature validation

There is no repo-wide `npm test` or `npm run lint` script configured. Use the targeted validation scripts under `backend/scripts/` that match the workflow you changed, instead of inventing a custom suite.

```bash
cd backend && node scripts/test-workflow-validation.js
cd backend && node scripts/test-messenger.js
cd backend && node scripts/test-export-une-semaine.js
cd backend && node scripts/test-export-multi.js
cd backend && node scripts/test-discussions.js
```

Prefer the nearest script for the affected area (workflow validation, messenger, export, etc.) over broad or unrelated checks.

## High-level architecture

### Backend: Express + MariaDB + JWT + Socket.IO

- `backend/src/server.js` creates the HTTP server and starts Socket.IO.
- `backend/src/app.js` mounts the API, configures CORS/JSON parsing, serves uploads, and registers error handling.
- `backend/src/routes/` exposes the domain API (`/api/auth`, `/api/plannings`, `/api/services`, `/api/employes`, `/api/messenger`, `/api/notifications`, etc.).
- `backend/src/controllers/` holds the business logic for auth, services, employees, schedules, assignments, validations, coverage, recoveries, and messaging.
- `backend/src/middleware/` enforces JWT (`authRequired`), role checks, and permission checks; server-side authorization is authoritative.
- `backend/database/` is part of the application logic: schema, migrations, views, and trigger-based validation define the real scheduling constraints.

### Frontend: Next.js App Router

- `frontend/src/app/` contains the user-facing screens: login, dashboard, planning creation/detail, validations, messaging, employees, service management, and admin flows.
- `frontend/src/components/` contains reusable schedule/reporting widgets.
- `frontend/src/lib/api.js` centralizes fetch calls and JWT headers; `frontend/src/lib/auth.js` handles session state and 401/403 behavior.

### Domain workflow

- Planning lifecycle: `BROUILLON` → `SOUMIS` → `VALIDE` or `REJETE`.
- Roles: `RH`, `CHEF_SERVICE`, `ADMIN`, `EMPLOYE`.
- Service ownership and weekly limits are enforced in the database, not only in the UI.
- The direct grid editing workflow (`/api/plannings/:id/grille`) is central: employees × days, slots, status, and save/submit validation are first-class features.
- Notifications are emitted automatically on submission and RH decisions and then filtered by `req.user.id_utilisateur`.

## Key conventions

- Keep backend, SQL schema, and UI changes aligned whenever permissions or business rules change; the server is the source of truth.
- Follow the existing layout (`routes/` + `controllers/` + `middleware/`) rather than adding ad hoc logic in page components.
- Use the project’s French-first domain terms consistently: `RH`, `CHEF_SERVICE`, `ADMIN`, `EMPLOYE`, `BROUILLON`, `SOUMIS`, `VALIDE`, `REJETE`.
- Treat MariaDB triggers and views as business logic. If a schedule rule, overlap check, service scope, weekly-hour limit, or validation flow is ambiguous, prefer `README.md` and `backend/database/` over UI assumptions.
- Do not bypass JWT validation or server-side permission checks; client-side role flags are never sufficient.
- Keep environment configuration split correctly: `backend/.env` for backend settings and `frontend/.env.local` for the public API URL.
- Use `gestion_plannings_hotel` as the active database unless explicitly working on legacy compatibility scripts under `backend/database/`.
- Keep demo credentials documented in `README.md` aligned with any auth-related changes.
- When editing schedule behavior, think in terms of service boundaries, weekly constraints, and validation states rather than generic CRUD operations.

## Reference docs

- `README.md` is the canonical project overview and operational reference.
- `backend/database/*.sql` defines the effective business rules, including compatibility scripts, schema, seed data, and migration updates.
- For feature work, validate against the nearest workflow-specific script in `backend/scripts/` rather than broad test suites.
