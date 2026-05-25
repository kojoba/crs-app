# CRS Backend — Community Resource Systems

Self-contained admin + website server. Node.js + Express + SQLite.
Frontend and backend ship together: the Node server serves the static
website AND the admin panel AND the public API the website calls.

```
backend/
├── server.js              # Express entry point
├── package.json           # 7 deps; only better-sqlite3 is native
├── Dockerfile             # production image
├── docker-compose.yml     # one-command run
├── render.yaml            # Render.com blueprint
├── railway.json           # Railway config
├── Procfile               # Heroku / Fly.io style
├── .env.example           # → copy to .env, fill in values
├── db/                    # SQLite DB lives here (auto-created)
├── db/seed-data.json      # initial team, partners, page text
├── routes/                # api.js (public) + admin.js (auth-protected)
├── middleware/auth.js     # session guard
├── views/admin/           # EJS templates for the admin UI
└── public/
    ├── index.html         # the CRS website (fully wired to /api/*)
    └── uploads/           # uploaded publication files
```

The website **already fetches** from `/api/projects` and `/api/publications`
on page load — whatever you create in the admin panel appears on the
public site automatically.

---

## Three ways to deploy

Pick whichever is easiest. All three produce the same result.

### A. Docker (most foolproof, ~2 minutes)

```bash
cd backend
cp .env.example .env
# edit .env: set SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD

docker compose up -d --build
```

Open `http://localhost:3000`. Admin: `http://localhost:3000/admin/login`.

Data persists in `./db/` and `./public/uploads/` — back those two folders
up and you've backed up everything.

### B. Render.com (one-click cloud deploy, free tier available)

1. Push this repo to GitHub.
2. Render → **New +** → **Blueprint** → connect the repo.
3. Render reads `render.yaml`, builds, prompts for `ADMIN_PASSWORD`.
4. Done — your site is live on `*.onrender.com` with HTTPS.

`render.yaml` already provisions a 1 GB persistent disk for the SQLite
DB and uploaded files.

### C. Plain Node on a VPS (DigitalOcean, Hetzner, Lightsail, $4–6/mo)

```bash
# On the server (Ubuntu 22.04+):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo npm install -g pm2

git clone <your-repo> /opt/crs && cd /opt/crs/backend
npm ci --omit=dev
cp .env.example .env       # then edit it
npm run init-db            # creates DB and seeds first admin user
pm2 start server.js --name crs
pm2 save && pm2 startup    # auto-start on reboot

# Reverse proxy with Caddy gives you automatic HTTPS in one line:
echo "crs.example.org { reverse_proxy localhost:3000 }" \
  | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## First login

After deploy, visit `/admin/login`. Sign in with the
`ADMIN_USERNAME` / `ADMIN_PASSWORD` you set in `.env`. **Immediately**
go to **Account → Change password** and pick a real password — the seed
is only used once, on first DB init.

## What lives in the admin panel

Everything on the site is editable here — nothing needs HTML editing anymore.

- **Dashboard** — counts and recent activity.
- **Projects** — full CRUD, each with **multiple images** (gallery). Fields:
  title, region, location, partner, year, description, display order.
- **Publications** — full CRUD with file upload (PDF / DOCX / PPTX /
  images, up to 25 MB). Files are linked from the public site.
- **Team & Trustees** — manage the Board of Trustees and the Management &
  Advisory Staff. Each person has a name, role, bio, display order, and a
  **profile photo** (falls back to initials if no photo).
- **Partners** — manage the Government, Development Cooperation, and
  Community partners shown on the home page.
- **Page Text** — edit the headlines and paragraphs across Home, About,
  Projects, Publications, Contact, and the footer.
- **Account** — change password.

## How the frontend uses the backend

On load, `public/index.html` fetches everything from the backend:

```js
fetch('/api/content');       // editable text blocks
fetch('/api/team');          // trustees + management (with photos)
fetch('/api/partners');      // partner ecosystem
fetch('/api/projects');      // projects + image galleries
fetch('/api/publications');  // publications + files
```

If the API is unreachable, the page falls back to its built-in default
text and simply hides empty collection sections — no broken layouts.

## Local development

```bash
npm install
cp .env.example .env       # then edit
npm run init-db
npm run dev                # uses node --watch for auto-reload
```

## Backups

Two paths matter:

- `db/crs.db` — all metadata (projects, publications, users, sessions)
- `public/uploads/` — uploaded files

Nightly cron is enough:

```bash
tar czf /backups/crs-$(date +%F).tar.gz \
  /opt/crs/backend/db/crs.db /opt/crs/backend/public/uploads
```

## Reset everything

```bash
rm db/crs.db public/uploads/*
npm run init-db
```

## Why this stack

- **Express + better-sqlite3** — synchronous SQLite, zero-config, fast.
  Prebuilt binaries for Node 18 / 20 / 22 on Windows, macOS, Linux —
  `npm install` never has to compile anything on the supported platforms.
- **bcryptjs** — pure-JS bcrypt; no native build, works everywhere.
- **Custom session store** (`db/session-store.js`, ~50 LOC) — reuses
  the same better-sqlite3 connection, removing the need for an
  additional native dependency.
- **EJS** — minimal templating for the admin UI.
- **multer** — file uploads.

Total: 7 npm deps; 1 native module with prebuilds. No external services,
no database server, no Redis.
