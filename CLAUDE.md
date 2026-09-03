# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Barber++ is a barbershop manager dashboard built with React 18 and Vite. It provides role-based interfaces for managers (multi-branch operations) and barbers (personal schedule/bookings). The backend uses Supabase for authentication and PostgreSQL database.

## Supabase Environments

Local, staging, and production use separate Supabase stacks. Never hardcode a
project reference or remote origin; use `supabase/config.toml` locally and the
environment-owned runtime/secret values documented in `docs/environments.md`.

## Commands

```bash
npm run dev      # Start development server (Vite)
npm run local:bootstrap # Recreate local Supabase and synthetic fixtures
npm run local:start     # Start the complete local stack
npm run build    # Production build
npm run preview  # Preview production build
npm run check    # Run repository validation
```

## Architecture

### Tech Stack
- **Frontend**: React 18, React Router v6, Vite 7
- **Backend**: Supabase (Auth + PostgreSQL + Edge Functions)
- **Styling**: CSS with custom properties (design system in `src/styles/index.css`)
- **i18n**: i18next with English and Arabic locales (`src/i18n/locales/`)
- **Icons**: lucide-react
- **Dates**: date-fns
- **Charts**: recharts

### Directory Structure
```
src/
├── components/
│   ├── Forms/      # BarberForm, BranchForm, BookingForm
│   ├── Layout/     # Layout, Sidebar, TopBar (manager & barber variants)
│   └── UI/         # Modal, ConfirmDialog, NotificationToast
├── pages/          # Route pages (manager at root, barber at /barber)
├── services/       # API layer (auth, branches, barbers, services, bookings)
├── context/        # AppContext (global state via React Context)
├── lib/            # Supabase client setup
├── i18n/           # i18next config and locale JSON files
├── hooks/          # Custom hooks (useGeoLocation, useLogger)
├── utils/          # Helpers (validation, caseConverter, bookingConflicts)
├── constants/      # countries, locations, time slots, booking statuses
└── styles/         # Global CSS with design tokens
```

### State Management
All state flows through `AppContext.jsx`:
- User auth state and role (manager/barber)
- Domain data: branches, barbers, services, bookings
- Branch-scoped filtering via `selectedBranchId`
- Theme management (dark/light/system)

Access via `useApp()` hook in components.

### Routing Structure
- **Public**: `/login`, `/signup`, `/forgot-password`
- **Manager** (role="manager"): `/`, `/branches`, `/services`, `/barbers`, `/bookings`, `/settings`
- **Barber** (role="barber"): `/barber`, `/barber/bookings`, `/barber/availability`, `/barber/profile`

Protected routes use `ProtectedRoute` component with `allowedRole` prop.

### Service Layer Pattern
Services in `src/services/` follow this pattern:
```javascript
export const entityService = {
  getAll: async () => { /* Supabase query */ },
  getById: async (id) => { /* ... */ },
  create: async (data) => { /* ... */ },
  update: async (id, data) => { /* ... */ },
  delete: async (id) => { /* ... */ }
}
```

### Database Field Conversion
Services use `toFrontend()`/`toDatabase()` converters for snake_case (DB) ↔ camelCase (frontend):
```javascript
// DB returns: { branch_id, customer_name }
// Frontend uses: { branchId, customerName }
const toFrontend = (record) => ({ branchId: record.branch_id, ... });
const toDatabase = (data) => ({ branch_id: data.branchId, ... });
```

### Design System
CSS custom properties defined in `src/styles/index.css`:
- Colors: `--bg-primary`, `--accent-primary` (#D4A853 amber), `--status-*`
- Typography: `--font-display` (Cormorant Garamond), `--font-body` (Outfit)
- Spacing: `--space-xs` through `--space-3xl`
- Theme switching via `data-theme` attribute on document root

## Key Patterns

- All manager operations are scoped to `selectedBranchId`
- Barbers only see data for their assigned branch
- Forms use controlled components with local state
- Modals/dialogs use the shared `Modal` and `ConfirmDialog` components
- Environment variables prefixed with `VITE_` for Supabase config
- Use `useTranslation()` hook from react-i18next for all UI text
- RTL support: Arabic locale automatically sets `dir="rtl"` on document

### Security Utilities
Security functions in `src/utils/security.js`:
- `escapeLikeWildcards()` - Prevent SQL LIKE injection
- `sanitizeForCSV()` - Prevent CSV injection in exports
- `sanitizeUUID()` - Validate UUID format
- `createRateLimiter()` - Rate limiting with exponential backoff
- `validateUserRole()` - Secure role validation (never default to privileged roles)
- `logErrorDev()` - Console logging only in development

### Admin Role
There's a third role `admin` for platform-wide administration:
- **Admin routes**: `/admin/*` (platform analytics, user management, global settings)
- Admin pages in `src/pages/admin/`
- Uses separate `AdminLayout` component

### Logging System
Centralized logging via `src/services/logging.service.js`:
- Batched writes to `logs` table for performance
- Context-aware (auto-includes userId, branchId, role)
- Use `loggingService.logAction()` for CRUD operations
- Access via `useLogger()` hook or import directly
