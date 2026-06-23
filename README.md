# 📊 Copilot Insights — Enterprise Analytics for GitHub Copilot

> **Turn GitHub Copilot usage into AI-powered executive insight.** The new **AI Analyst** converts your enterprise Copilot data into grounded recommendations, while the dashboard gives engineering leaders full visibility into **adoption**, **licensing costs**, **AI credit spend**, and **AI model activity** across every team and organization.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-6-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ New in v1.0 — AI Analyst

Copilot Insights now includes an optional **AI Analyst** powered by the GitHub Copilot SDK. It turns your synced Copilot data into structured Markdown briefings for engineering leaders, covering **cost and license optimization**, **adoption coaching**, **executive summaries**, **delivery impact**, **ROI and spend forecasts**, and **team scorecards**.

The AI Analyst is designed for transparency and governance:

- 🧠 **Grounded analysis** — every narrative is generated from dashboard metrics, enterprise context, org topology, feature mix, and persisted access/seat signals
- 📊 **Business-ready output** — structured Markdown with key metrics, risks, recommended actions, caveats, and analysis confidence
- 🏢 **Enterprise personalization** — admins can provide additional instructions and assumptions, such as hourly cost, priority teams, and reporting preferences
- 🔒 **Operational control** — AI is off by default, uses a dedicated Copilot token, caches generated insights, and includes a cache management panel
- 🔍 **Transparency report** — see [docs/ai-analyst.md](docs/ai-analyst.md) for what data is sent, prompt structure, cache behavior, and security model

## 💡 Why Copilot Insights?

GitHub Copilot is transforming how teams write code — but without visibility into how it's being used, it's hard to measure the return on your investment. Copilot Insights bridges that gap by providing:

- 📈 **Adoption tracking** — see which teams and users are actively using Copilot, and where adoption lags
- 💰 **License optimization** — identify unused seats and potential savings across your enterprise
- 🤖 **Model intelligence** — understand which AI models drive the most value and how AI credit budgets are consumed
- 🧠 **AI-powered analyst briefings** — convert raw metrics into executive, cost, adoption, delivery, ROI, and team recommendations
- ⚡ **Productivity metrics** — measure code completions, agent usage, PR impact, and CLI adoption in one place
- 🔒 **Enterprise governance** — role-based access, audit logging, and team-level filtering for compliance

## 🗂️ Dashboard Pages

| Page | Route | Description |
|---|---|---|
| **AI Analyst** | `/ai-analyst` | AI-generated executive, cost, adoption, delivery, ROI, and team analysis grounded in synced dashboard data |
| **My Usage** | `/my-usage` | A signed-in developer's **own** AI Credit consumption, broken down by model, with a month selector and trend (identity mode only) |
| **Copilot Usage** | `/metrics` | Daily/weekly active users, code completions, chat mode breakdown, model & language analytics |
| **Code Generation** | `/code-generation` | LOC added/deleted by user vs agent, breakdowns by feature, model, and language |
| **PR & Autofix** | `/pull-requests` | AI-assisted PR creation, Copilot code review suggestions, autofix analytics, and merge metrics |
| **Agent Impact** | `/agents` | Agent adoption rate, IDE Agent vs GitHub Coding Agent breakdown, top agent users |
| **AI Adoption** | `/ai-adoption` | Cohort-based adoption analysis (code-first, agent-first, multi-agent), progression trends, and per-cohort productivity |
| **CLI Impact** | `/cli` | CLI adoption, session/request volumes, token consumption, version distribution |
| **Copilot Licensing** | `/seats` | Seat assignments, license utilization, plan distribution, savings opportunities (live from GitHub API) |
| **AI Credits** | `/ai-credits` | AI credit consumption, included pool utilization, model/org/team/user breakdowns, and monthly trends |
| **Premium Requests** | `/premium-requests` | Historical premium-request usage report retained for pre-usage-based-billing periods |
| **Models** | `/models` | AI model catalog with usage stats, premium vs included tiers, and feature breakdown |
| **Users** | `/users` | Individual user activity explorer with license status, engagement patterns, and feature adoption |
| **Enterprise Teams** | `/enterprise-teams` | Team management with member sync from GitHub Enterprise Teams API |
| **Metrics Reference** | `/reference` | 200+ metric definitions, calculation formulas, and data sources |

### ✨ Cross-cutting Features

- 🌍 **Internationalization** — 7 languages (English, Arabic RTL, Spanish, French, German, Hindi, Italian) via `useTranslation()` hook
- 🌓 **Dark/Light/System theme** — three-mode theme with `dark:` Tailwind variants and theme-aware Chart.js options
- 📄 **PDF export** — one-click PDF generation for all dashboard pages
- 🔎 **Multi-select filters** — filter charts by organization, enterprise team, user, model, or language
- 🧠 **AI Analyst** — optional Copilot SDK-powered analysis with grounded prompts, Markdown output, caching, admin assumptions, and enterprise context
- 🚩 **Configuration banner** — shown when GitHub token or enterprise slug is missing
- ℹ️ **About report context** — each report includes an “About this report” banner with metric scope/context
- 📝 **Audit logging** — tracks admin actions for compliance
- 🔐 **Dashboard auth gate** — optional password protection for all dashboard pages

## 📸 Screenshots

### Landing Page

Welcome page with feature overview cards and quick navigation to all dashboards.

![Landing Page](docs/screenshots/landing.png)

### AI Analyst

AI-generated executive, ROI, and team scorecard analysis with grounded Markdown summaries and collapsible cards.

![AI Analyst](docs/screenshots/ai-analyst.png)

### Copilot Usage

Daily and weekly active users, code completions, chat requests, and model usage trends.

![Copilot Usage](docs/screenshots/copilot-usage.png)

### Code Generation

Lines of code added and deleted across modes, models, and languages.

![Code Generation](docs/screenshots/code-generation.png)

### PR & Autofix

AI-assisted pull request creation, Copilot code review suggestions, and autofix analytics.

![PR & Autofix](docs/screenshots/pr-autofix.png)

### Agent Impact

Agent adoption rate, IDE Agent vs GitHub Coding Agent breakdown, and top agent users.

![Agent Impact](docs/screenshots/agent-impact.png)

### AI Adoption

User adoption cohorts (code-first, agent-first, multi-agent), progression over time, and per-cohort productivity.

![AI Adoption](docs/screenshots/ai-adoption.png)

### CLI Impact

GitHub Copilot CLI adoption, session and request volumes, and token consumption.

![CLI Impact](docs/screenshots/cli-impact.png)

### Copilot Licensing

License utilization, seat costs, and savings opportunities — live from GitHub API.

![Copilot Licensing](docs/screenshots/copilot-licensing.png)

### AI Credits

AI credit usage, included credit pool utilization, and billing breakdowns by model, org, team, and user.

![AI Credits](docs/screenshots/ai-credits.png)

### Premium Requests (Historical)

Premium request consumption report for historical periods before AI credit billing took effect.

![Premium Requests](docs/screenshots/premium-requests.png)

### Users

Individual user activity explorer with license status, engagement metrics, and feature adoption.

![Users](docs/screenshots/users.png)

### Enterprise Teams

Enterprise team management with member sync from GitHub Enterprise Teams API.

![Enterprise Teams](docs/screenshots/enterprise-teams.png)

### Metrics Reference

200+ metric definitions with calculation formulas, data sources, and usage guidance.

![Metrics Reference](docs/screenshots/metrics-reference.png)

### Settings — Configuration

Manage your GitHub connection and enterprise slug.

![Settings](docs/screenshots/settings.png)

### Settings — AI Analyst

Configure the AI Analyst token, model, admin assumptions, enterprise context status, and cached insight management.

![AI Analyst Settings](docs/screenshots/settings-ai-analyst.png)

### Settings — Data Sync

Schedule automatic syncs, trigger manual pulls, or upload NDJSON exports.

![Data Sync](docs/screenshots/data-sync.png)

## 🏗️ Architecture

- **Frontend**: Next.js 16.2 App Router, React 19.2, Tailwind CSS 4.2, Chart.js 4.5
- **Backend**: Next.js API routes, Drizzle ORM 0.45, Zod 4.3
- **Database**: PostgreSQL 18 (star schema — 10 dimensions + 9 fact tables)
- **ETL**: Custom ingest pipeline with GitHub Copilot Usage Metrics API (v2026-03-10)
- **Billing data**: Seats fetched live; AI Credits fetched from GitHub billing API and snapshotted for trend continuity
- **Infrastructure**: Azure Container Apps, Azure Database for PostgreSQL, Azure Container Registry, Key Vault

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

The optional **AI Analyst** turns your Copilot data into written executive, cost, adoption, and
delivery analysis using the GitHub Copilot SDK. See
[docs/ai-analyst.md](docs/ai-analyst.md) for a full transparency report on the data it gathers, the
prompts it uses, and how analysis is generated, cached, and secured.

## ✅ Prerequisites

- **Node.js** 24+ and **pnpm** (`corepack enable`)
- **PostgreSQL** 18+ (local or cloud)
- **GitHub Enterprise Cloud** with Copilot enabled
- **GitHub Personal Access Token** with `manage_billing:copilot`, `manage_billing:enterprise`, `read:enterprise`, `read:org` scopes

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/ghcp-dashboard.git
cd ghcp-dashboard

# 2. Install dependencies
cd app
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database URL and admin password

# 4. Run database migrations
pnpm exec drizzle-kit migrate

# 5. Start the development server
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) and navigate to **Settings** to configure your GitHub token and sync schedule.

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `ADMIN_PASSWORD` | No | Password for Settings page access. If unset, settings are open to all. Only leave this unset for local development on a trusted machine |
| `DASHBOARD_PASSWORD` | No | Password gate for all dashboard pages. If unset, dashboards are open to all. Only leave this unset for local development or intentionally public dashboards |
| `GITHUB_OAUTH_CLIENT_ID` | No | GitHub OAuth App client id. Enables **identity mode** when set together with the two vars below |
| `GITHUB_OAUTH_CLIENT_SECRET` | No | GitHub OAuth App client secret (pair with `GITHUB_OAUTH_CLIENT_ID`) |
| `SESSION_SECRET` | No | Long random string used to HMAC-sign identity session cookies. Required for identity mode |
| `ADMIN_LOGINS` | No | Comma-separated GitHub logins granted the **admin** role in identity mode (case-insensitive). Everyone else signs in as a **developer** |
| `NEXT_PUBLIC_BUILD_ID` | No | Git commit SHA shown in sidebar footer (auto-set in Docker) |
| `NEXT_PUBLIC_BUILD_TIME` | No | Build timestamp shown in sidebar footer (auto-set in Docker) |

> [!WARNING]
> For any non-local deployment, set `ADMIN_PASSWORD` to protect the **Settings** page. The Settings UI can configure the GitHub token, Enterprise slug, and sync interval. If dashboard pages should not be publicly accessible, also set `DASHBOARD_PASSWORD`. Leaving these unset is only recommended for local development on a trusted machine.
The **GitHub token**, **Enterprise slug**, and **sync interval** are configured via the Settings UI and stored in the database.

A complete, annotated template of every variable lives in [`app/.env.example`](app/.env.example) — copy it to `app/.env` and fill in the values.

## 🔐 Authentication & Access Modes

The dashboard supports three **additive** authentication modes. They are selected purely by which environment variables are set, so you can adopt them incrementally without code changes:

| Mode | How it's enabled | Who can access what |
|---|---|---|
| **Open** | No auth vars set | Everyone sees every page. Use only for local development on a trusted machine |
| **Shared-password** | `DASHBOARD_PASSWORD` and/or `ADMIN_PASSWORD` set | A single password gates the dashboard (`DASHBOARD_PASSWORD`) and/or the Settings pages (`ADMIN_PASSWORD`). There is no per-user identity |
| **Identity (GitHub OAuth)** | `GITHUB_OAUTH_CLIENT_ID` **+** `GITHUB_OAUTH_CLIENT_SECRET` **+** `SESSION_SECRET` all set | Each user signs in with GitHub and receives a signed, stateless session cookie carrying their **login** and **role** (`admin` or `developer`, resolved from `ADMIN_LOGINS`) |

In **identity mode**:

- **Developers** see only the **My Usage** page (`/my-usage`) — their own AI Credit consumption, broken down by model, scoped server-side to their signed-in login. Org-wide and cross-user reports (`/ai-credits`, `/seats`, `/users`, etc.) and the Settings pages are hidden from their navigation **and** enforced server-side: a crafted `?user=<other-login>` can never read another user's rows.
- **Admins** (logins listed in `ADMIN_LOGINS`) see everything, exactly as before.

### GitHub OAuth App setup

1. Create a GitHub **OAuth App** (Settings → Developer settings → OAuth Apps → *New OAuth App*).
2. Set the **Authorization callback URL** to `https://<your-host>/api/auth/github/callback` (use `http://localhost:3000/api/auth/github/callback` for local development).
3. Copy the generated **Client ID** and a **Client secret** into `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
4. Set `SESSION_SECRET` to a long random string and list your admin GitHub logins in `ADMIN_LOGINS`.

> The OAuth App only reads each user's GitHub identity (login + id) to establish a session — developers never receive billing or enterprise scopes.

### Billing data source & ingestion

AI Credit data is sourced from the validated **async `ai_credit` report export** — `POST /enterprises/{enterprise}/settings/billing/reports` — which returns a download URL once GitHub finishes generating the report. This export requires an **admin enterprise PAT** (classic PAT with `manage_billing:enterprise` read); without that scope GitHub returns `404`. Ingestion is decoupled into a **scheduled Azure Container Apps cron Job** that runs the export, downloads the report, and upserts per-user rows into the database. The dashboard (including **My Usage**) only reads those pre-ingested rows — developers never receive billing scopes and only ever see rows scoped to themselves.

## 🚢 Deployment

**Azure is the recommended — and simplest — way to get the dashboard up and running.** A single `azd up` provisions every resource, wires up secrets and managed identity, and deploys the app. If you'd rather run it yourself, a self-hosted option is fully supported too.

### ⭐ Option 1 — Azure (recommended)

The fastest path to a production-ready deployment. This project ships Infrastructure as Code (Bicep) and an [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/) configuration, so one command stands everything up for you (Container Apps, PostgreSQL, Container Registry, Key Vault, and Application Insights).

**Requirements**

- An Azure subscription
- [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- [Docker](https://www.docker.com/) (used to build the app image)

**Deploy**

```bash
# Provision infrastructure + deploy the app (first run)
azd up

# Subsequent deploys (app only)
azd deploy
```

When the deploy finishes, `azd` prints the app URL. Open it, go to **Settings**, and add your GitHub token and sync schedule — that's it.

#### 💵 Estimated monthly cost

A typical deployment in the **North Europe** region costs **approximately $45 / month** (USD), ranging from roughly **$35 to $65 / month** depending on dashboard traffic and log volume. Figures are pay-as-you-go list-price estimates; reserved capacity or savings plans reduce them further. For a precise quote, use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/).

### 🐳 Option 2 — Self-hosted (bring your own infrastructure)

Run the dashboard anywhere you can host a container — your own VM, Kubernetes, another cloud, or on-premises.

**Requirements**

- **PostgreSQL** 18+ (managed or self-run), reachable from the app
- **Docker** — the app ships a production `Dockerfile` with Next.js standalone output (or use **Node.js** 24+ and **pnpm** for local development)
- **TLS / reverse proxy** (e.g. nginx, Caddy) in front of the app for any shared deployment
- **GitHub Personal Access Token** with `manage_billing:copilot`, `manage_billing:enterprise`, `read:enterprise`, `read:org` (added later via the Settings UI)
- Environment variables (see [Environment Variables](#environment-variables)):
  - `DATABASE_URL` — **required**
  - `ADMIN_PASSWORD` — **required** for any shared/non-local deployment
  - `DASHBOARD_PASSWORD` — optional, gates all dashboard pages
  - `APPLICATIONINSIGHTS_CONNECTION_STRING` — optional, enables telemetry

**Run with Docker**

```bash
# Build the production image
docker build -t copilot-insights ./app

# Run it against your PostgreSQL instance
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/copilot_insights?sslmode=require" \
  -e ADMIN_PASSWORD="<strong-password>" \
  copilot-insights
```

Database migrations run automatically on startup. Once the container is up, open `http://localhost:3000` (or your proxied URL), go to **Settings**, and configure your GitHub token and sync schedule.

> [!TIP]
> For local development, use the [Quick Start](#quick-start) above (`pnpm run dev`) instead of building a container.

## 📁 Project Structure

```
ghcp-dashboard/
├── app/                          # Next.js application
│   ├── src/
│   │   ├── app/                  # Pages and API routes
│   │   │   ├── api/              # REST API endpoints (31 routes)
│   │   │   ├── metrics/          # Copilot Usage dashboard
│   │   │   ├── code-generation/  # Code generation report
│   │   │   ├── pull-requests/    # PR & Autofix report
│   │   │   ├── agents/           # Agent impact report
│   │   │   ├── ai-adoption/      # AI adoption cohorts report
│   │   │   ├── cli/              # CLI impact report
│   │   │   ├── seats/            # Licensing page (live)
│   │   │   ├── ai-credits/       # AI credits usage + billing dashboard
│   │   │   ├── premium-requests/ # Historical premium requests report
│   │   │   ├── models/           # AI model catalog
│   │   │   ├── users/            # User explorer
│   │   │   ├── enterprise-teams/ # Enterprise team management
│   │   │   ├── reference/        # Metrics reference
│   │   │   └── settings/         # Configuration, data sync, audit log & app info
│   │   ├── components/           # Shared React components
│   │   ├── lib/                  # Database, ETL, i18n, theme, utilities
│   │   └── types/                # TypeScript type definitions
│   ├── drizzle/                  # Database migrations
│   ├── public/                   # Static assets
│   ├── Dockerfile                # Multi-stage production build
│   └── package.json
├── infra/                        # Azure Bicep IaC
├── docs/                         # Documentation & screenshots
└── azure.yaml                    # Azure Developer CLI config
```

## 📜 Scripts

```bash
pnpm run dev          # Start dev server
pnpm run build        # Production build
pnpm run start        # Start production server
pnpm run lint         # ESLint check
pnpm run db:generate  # Generate Drizzle migrations
pnpm run db:migrate   # Run migrations
pnpm run db:push      # Push schema to DB
pnpm run ingest       # Manual data ingest
```

## 🔄 Data Sync

The dashboard supports two sync modes:

1. **Auto-sync**: Background sync on a configurable interval (default: every 6 hours). Runs via `instrumentation.ts` on server startup.
2. **Manual sync**: Trigger from the Settings → Data Sync page via SSE streaming.

Both modes call the GitHub Copilot Usage Metrics API (v2026-03-10) and transform the data into a star schema for analytics queries.

## 📄 License

[MIT](LICENSE)
