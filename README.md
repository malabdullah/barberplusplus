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
| Frontend | React 18, React Router v6, Vite 7 |
| Backend | Supabase (Auth, PostgreSQL, Edge Functions, Storage) |
| Styling | CSS Custom Properties, responsive design |
| i18n | i18next (English, Arabic) |
| Icons | lucide-react |
| Charts | recharts |

## Environments

Barber++ uses one codebase and three isolated environments:

| Environment | Frontend | Supabase | Data |
|-------------|----------|----------|------|
| Local | Vite | Local CLI stack | Deterministic synthetic fixtures |
| Staging | Immutable Docker image on Dokploy | Separate self-hosted stack | Synthetic only |
| Production | The staging-tested image digest on Dokploy | Existing self-hosted stack | Live customer data |

Runtime browser configuration is injected when the Nginx container starts. A
frontend image never contains staging or production credentials or origins.

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
   cp .env.local.example .env.local
   cp supabase/functions/.env.example supabase/functions/.env.local
   npm run local:bootstrap
   ```

3. **Start Supabase, Edge Functions, and Vite**
   ```bash
   npm run local:start
   ```

The bootstrap intentionally stops until the authoritative production schema
baseline has been reviewed and committed. See
[`docs/database-baseline.md`](docs/database-baseline.md) for that one-time gate.

## Scripts

```bash
npm run dev      # Start development server
npm run local:bootstrap # Install and rebuild the complete local stack
npm run local:start     # Start Supabase, Edge Functions, and Vite
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # Lint, unit tests, build, and domain safety checks
npm run test:e2e # Browser journeys
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
