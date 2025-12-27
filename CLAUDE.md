# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Barber++ is a barbershop manager dashboard built with React 18 and Vite. It provides role-based interfaces for managers (multi-branch operations) and barbers (personal schedule/bookings). The backend uses Supabase for authentication and PostgreSQL database.

## Commands

```bash
npm run dev      # Start development server (Vite)
npm run build    # Production build
npm run preview  # Preview production build
```

## Architecture

### Tech Stack
- **Frontend**: React 18, React Router v6, Vite 5
- **Backend**: Supabase (Auth + PostgreSQL)
- **Styling**: CSS with custom properties (design system in `src/styles/index.css`)
- **Icons**: lucide-react
- **Dates**: date-fns

### Directory Structure
```
src/
├── components/
│   ├── Forms/      # BarberForm, BranchForm
│   ├── Layout/     # Layout, Sidebar, TopBar (manager & barber variants)
│   └── UI/         # Modal, ConfirmDialog
├── pages/          # Route pages (manager at root, barber at /barber)
├── services/       # API layer (auth, branches, barbers, services, bookings)
├── context/        # AppContext (global state via React Context)
├── lib/            # Supabase client setup
├── constants/      # countries, locations, time slots
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
