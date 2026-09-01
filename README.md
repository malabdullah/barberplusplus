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

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/malabdullah/barberplusplus.git
   cd barberplusplus
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with the self-hosted Supabase public URL and publishable key:
   ```env
   VITE_SUPABASE_URL=https://supabase.malabdullah.cloud
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key-here
   ```

   Retrieve the browser-safe key from the Supabase host. Modern
   `sb_publishable_` keys and legacy self-hosted `anon` JWTs are supported.
   Never place the secret or service-role key in a Vite environment variable
   because Vite embeds it in the browser bundle.

4. **Set up database**

   Run the migrations in `supabase/migrations/` in your Supabase SQL editor.

5. **Start development server**
   ```bash
   npm run dev
   ```

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run preview  # Preview production build
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
- Role validation (no privilege escalation)

## License

MIT

## Author

Built by [@malabdullah](https://github.com/malabdullah)
