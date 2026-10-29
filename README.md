# Barber++

A modern barbershop management dashboard built with React and Supabase. Manage multiple branches, staff, services, and bookings with role-based access for managers and barbers.

## Features

### For Managers
- **Multi-Branch Management** - Create and manage multiple barbershop locations
- **Staff Management** - Add barbers, set schedules, assign services
- **Service Catalog** - Define services with pricing, duration, and descriptions
- **Booking Control** - View, create, modify bookings across all branches
- **Real-Time Analytics** - Dashboard with booking stats, revenue insights
- **Activity Logs** - Track all system actions for accountability
- **Notifications** - In-app alerts for bookings, staff updates

### For Barbers
- **Personal Dashboard** - View daily schedule and upcoming bookings
- **Availability Management** - Set working hours, time-offs, vacations
- **Booking Management** - Accept, complete, or cancel assigned bookings
- **Profile Settings** - Update personal info and specialties

### General
- **Bilingual Support** - Full English and Arabic with RTL layout
- **Dark/Light Themes** - System-aware theme switching
- **Mobile Responsive** - Works on all device sizes
- **Secure Authentication** - Email/password with rate limiting

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | React 18, React Router 7, Vite 7 |
| Backend | Supabase (Auth, PostgreSQL, Edge Functions, Storage) |
| Styling | CSS Custom Properties, responsive design |
| i18n | i18next (English, Arabic) |
| Icons | lucide-react |
| Charts | recharts |

## Environments

Barber++ uses one codebase and two environments:

| Environment | Frontend | Supabase | Data |
|-------------|----------|----------|------|
| Local Test (`dev`) | Vite on the Mac, port 5173 | Dedicated Docker Supabase stack | Synthetic fixtures only |
| Production (`main`) | Immutable image managed by Dokploy | Existing production Supabase VPS | Live customer data |

Runtime browser configuration is injected when the Nginx container starts. A
frontend image contains no deployment credentials. Browser configuration contains
only the public backend origin and publishable key. There is no permanent staging
environment. See [the operating guide](docs/environments.md).

## Getting Started

### Prerequisites
- Node.js 24.20.0+
- npm
- Docker Desktop or another Docker-compatible runtime

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/malabdullah/barberplusplus.git
   cd barberplusplus
   ```

2. **Bootstrap the complete local environment**
   ```bash
   npm run local:setup
   ```

3. **Start Supabase, Edge Functions, and Vite**
   ```bash
   npm run local:start
   ```

Setup creates isolated Test data from the committed migrations and seed. Repeating
setup preserves an initialized Test database. Use `npm run local:reset` only when
you explicitly want to discard local Test data. Setup generates ignored local
credentials; never copy production credentials into this checkout.

Local startup and browser CI pin PostgREST to `v16.4` using the reviewed Supabase
CLI `2.116.0` override. This includes the upstream fix for intermittent
`PGRST303` errors immediately after login. Existing different overrides are
preserved and cause startup to stop for review. A running stack is not replaced
automatically: changing its service version requires a project-scoped stop/start
that preserves volumes, followed by verification. Do not use setup, database
reset or `stop --no-backup` to update an existing development stack.

## Scripts

```bash
npm run dev      # Start development server
npm run local:setup     # Install and initialize fresh local Test
npm run local:start     # Start Supabase, Edge Functions, and Vite
npm run local:stop      # Stop this Test stack, preserving data
npm run local:reset     # Explicitly discard/reseed only this Test database
npm run local:status    # Inspect local Test readiness
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # Lint, unit tests, build, and domain safety checks
npm run test:e2e # Browser journeys
npm run test:production-image # Container health, routing and runtime configuration
```

## Project Structure

```
src/
├── components/     # Reusable UI components
├── pages/          # Route pages (manager, barber, admin)
├── services/       # API layer (Supabase queries)
├── context/        # Global state (AppContext)
├── hooks/          # Custom React hooks
├── utils/          # Helpers (validation, security)
├── i18n/           # Translations (en.json, ar.json)
├── constants/      # Static data (countries, time slots)
└── styles/         # Global CSS and design tokens
```

## User Roles

| Role | Access |
|------|--------|
| **Manager** | Full access to assigned branches, staff, bookings |
| **Barber** | Personal schedule, assigned bookings only |
| **Admin** | Platform-wide settings, analytics, user management |

## Design System

The app uses a "Gentleman's Club" aesthetic with:
- **Primary Color**: Amber (#D4A853)
- **Display Font**: Cormorant Garamond
- **Body Font**: Outfit
- **Theme**: Dark by default, light option available

CSS custom properties are defined in `src/styles/index.css`.

## Security

- Rate limiting on authentication endpoints
- UUID validation on all entity IDs
- SQL injection prevention via parameterized queries
- CSV injection protection in exports
- Session expiration notifications
- Roles are read from administrator-controlled `app_metadata`
- Row-level security remains the authoritative authorization boundary
- Non-production communication is restricted by recipient allowlists
- Cron calls use a dedicated shared secret stored in each environment's Vault

Operational setup and release instructions are in
[`docs/environments.md`](docs/environments.md),
[`docs/deployment-runbook.md`](docs/deployment-runbook.md), and
[`docs/backup-restore.md`](docs/backup-restore.md).

## License

MIT

## Author

Built by [@malabdullah](https://github.com/malabdullah)
