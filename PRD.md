# Barber++ Product Requirements Document

| **Document Info** | |
|-------------------|---|
| **Product Name** | Barber++ |
| **Version** | 1.0.0 |
| **Last Updated** | December 2024 |
| **Status** | Production |
| **Platform** | Web Application (React SPA) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [User Personas](#3-user-personas)
4. [Functional Requirements](#4-functional-requirements)
5. [Barber-Specific Features](#5-barber-specific-features)
6. [Data Models](#6-data-models)
7. [UI/UX Specifications](#7-uiux-specifications)
8. [Technical Architecture](#8-technical-architecture)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Routes & Navigation](#10-routes--navigation)
11. [Business Logic Constants](#11-business-logic-constants)
12. [Internationalization](#12-internationalization)

---

## 1. Executive Summary

### 1.1 Product Overview

**Barber++** is a comprehensive barbershop management dashboard designed for the GCC region (Kuwait, Saudi Arabia, UAE, Bahrain, Qatar, and Oman). The application provides role-based interfaces for barbershop managers and individual barbers, enabling efficient multi-branch operations, appointment scheduling, staff management, and business analytics.

### 1.2 Problem Statement

Barbershop owners and managers face significant challenges in:
- Managing multiple branch locations with scattered data
- Coordinating staff schedules across locations
- Preventing double-bookings and scheduling conflicts
- Tracking revenue and business performance metrics
- Providing barbers with self-service schedule management
- Supporting bilingual operations (English/Arabic) with RTL layouts

### 1.3 Solution

Barber++ addresses these challenges through:
- **Role-based access control** separating manager and barber interfaces
- **Multi-branch architecture** with branch-scoped data filtering
- **Real-time booking management** with conflict detection
- **Comprehensive dashboards** with KPIs and analytics
- **Self-service barber portal** for availability and profile management
- **Full Arabic support** with RTL layout and localization

### 1.4 Target Users

| User Type | Description | Primary Use Cases |
|-----------|-------------|-------------------|
| **Barbershop Manager** | Owner or manager of one or more barbershop locations | Branch management, staff oversight, booking management, revenue tracking |
| **Barber** | Individual barber staff member | Personal schedule, availability management, booking status updates |

---

## 2. Product Vision & Goals

### 2.1 Vision Statement

To be the premier barbershop management solution for the GCC region, empowering barbershop businesses with intuitive, culturally-aware tools that streamline operations and enhance the customer experience.

### 2.2 Business Objectives

1. **Operational Efficiency**: Reduce manual scheduling and administrative overhead by 50%
2. **Revenue Visibility**: Provide real-time insights into daily, weekly, and monthly revenue
3. **Staff Empowerment**: Enable barbers to manage their own schedules and availability
4. **Multi-Branch Scalability**: Support businesses growing from single to multiple locations
5. **Regional Fit**: Native Arabic support with GCC-specific location and phone formats

### 2.3 Success Metrics (Tracked in Dashboard)

**Manager KPIs:**
- Today's Bookings (total, completed, upcoming)
- Weekly Revenue (with growth trend indicator)
- Active Barbers count
- Services Offered count

**Barber KPIs:**
- Today's Appointments (total, completed, upcoming)
- Weekly Booking Total
- Weekly Earnings
- Completion Rate percentage

### 2.4 Target Market

| Country | Code | Phone Prefix | Currency |
|---------|------|--------------|----------|
| Kuwait | KW | +965 | KWD |
| Saudi Arabia | SA | +966 | SAR |
| United Arab Emirates | AE | +971 | AED |
| Bahrain | BH | +973 | BHD |
| Qatar | QA | +974 | QAR |
| Oman | OM | +968 | OMR |

---

## 3. User Personas

### 3.1 Manager Persona

**Profile: Ahmed Al-Rashid**
- **Role**: Barbershop Owner/Manager
- **Age**: 35-50
- **Tech Savvy**: Moderate
- **Branches**: 1-5 locations

**Goals:**
- Monitor all branches from a single dashboard
- Track daily bookings and weekly revenue
- Manage barber schedules and invitations
- Maintain service catalog with pricing
- Review activity logs for accountability

**Pain Points Solved:**
- No more scattered spreadsheets and manual booking logs
- Real-time visibility into branch performance
- Automated conflict detection for bookings
- Centralized staff management with invite system

**Key Workflows:**
1. Morning check: Review today's bookings across branches
2. Staff management: Invite new barbers, monitor availability
3. Weekly review: Analyze revenue and booking trends
4. Branch operations: Update services, operating hours

### 3.2 Barber Persona

**Profile: Mohammed Hassan**
- **Role**: Professional Barber
- **Age**: 22-40
- **Tech Savvy**: High (mobile-first)
- **Employment**: Single branch assignment

**Goals:**
- View personal daily schedule
- Manage working hours and time-offs
- Request vacation time
- Update profile and service offerings
- Track personal earnings

**Pain Points Solved:**
- No more unclear schedules from paper calendars
- Self-service availability updates
- Prevention of double-bookings
- Mobile-friendly interface for on-the-go access

**Key Workflows:**
1. Daily routine: Check today's appointments, mark completions
2. Weekly planning: Update availability schedule
3. Time-off requests: Add recurring or one-time unavailability
4. Profile updates: Modify services and contact info

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization

| Feature | Description | Priority | Route |
|---------|-------------|----------|-------|
| Email/Password Login | Standard authentication via Supabase Auth | P0 | `/login` |
| Account Registration | New manager signup with email verification | P0 | `/signup` |
| Password Recovery | Forgot password with email reset link | P0 | `/forgot-password` |
| Password Reset | Set new password from email link | P0 | `/reset-password` |
| Barber Invitation | Manager invites barbers via email | P0 | Edge Function |
| Accept Invite | Barbers accept invitation and set password | P0 | `/accept-invite` |
| Session Management | Active sessions, logout functionality | P1 | Settings |
| Role-Based Access | Manager vs Barber route protection | P0 | `ProtectedRoute` |

**Authentication Flow:**
```
Manager Signup → Email Verification → Login → Dashboard
Manager Creates Barber → Invite Email Sent → Barber Accepts → Barber Login
```

**Role Assignment:**
- Default role on signup: `manager`
- Barbers created by managers receive role: `barber`
- Role stored in Supabase user metadata

---

### 4.2 Manager Dashboard

**Route:** `/`

**KPI Metric Cards:**

| Metric | Description | Display |
|--------|-------------|---------|
| Today's Bookings | Total bookings for current day | Count + completed/upcoming breakdown |
| Week Revenue | Total revenue from completed bookings this week | Amount + 12% growth indicator |
| Active Barbers | Number of active barbers | Count + "on schedule" label |
| Services Offered | Total active services | Count |

**Dashboard Sections:**

1. **Welcome Section**
   - Time-based greeting (Good Morning/Afternoon/Evening)
   - Current branch name context
   - Today's date with day of week

2. **Today's Schedule**
   - First 6 upcoming bookings displayed
   - Each booking shows: time, customer name, service, barber, status
   - Status badges with color coding
   - "View All Bookings" link
   - Empty state with CTA to create first booking

3. **Quick Actions**
   - New Booking button
   - Add Barber button
   - Add Service button
   - View Schedule button

4. **Active Barbers Overview**
   - First 4 barbers displayed as mini cards
   - Shows: initials/avatar, name, today's booking count
   - Status indicator (active/busy)
   - "Manage Team" link

---

### 4.3 Branch Management

**Routes:** `/branches`, `/branches/new`, `/branches/:branchId`, `/branches/:branchId/edit`

#### 4.3.1 Branch List View

| Element | Description |
|---------|-------------|
| Page Header | "Branches" title with count badge |
| Add Button | "Add Branch" primary action |
| Branch Cards | Card-based layout with branch info |
| Empty State | Icon + message + CTA when no branches |

**Branch Card Content:**
- Branch name with status badge (active/inactive)
- Location: Area, Governorate
- Contact: Phone number, Email
- Stats: Barber count, Service count
- Today's operating hours
- Action buttons: Edit, View Details, Delete

#### 4.3.2 Create/Edit Branch Form

**Basic Information Section:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Branch Name (English) | Text | Yes | Min 2 characters |
| Branch Name (Arabic) | Text | No | - |
| Governorate | Select (cascading) | Yes | From locations data |
| Area | Select (cascading) | Yes | Depends on governorate |
| Location URL | URL | No | Valid URL format |
| Phone | Phone input | Yes | Country-specific format |
| Email | Email | No | Valid email format |
| Number of Barbers | Number | No | Min 0 |
| Branch Image | File upload | No | JPEG/PNG/WebP, max 5MB |

**Operating Hours Section:**

| Day | Fields | Options |
|-----|--------|---------|
| Sunday - Saturday | Open/Closed toggle, Start time, End time | 6:00 AM - 11:30 PM (30-min intervals) |

**Features:**
- "Copy to all days" button for quick setup
- Visual indicators for open (green) vs closed (red) days
- IP-based geolocation for default country code

#### 4.3.3 Branch Details View

**Sections:**
1. **Header**: Name, location, phone, email, status badge
2. **Stats Cards**: Team members, Services, Today's bookings
3. **Team Members**: First 4 barbers with avatar, name, specialties
4. **Services Offered**: First 5 services with name, duration, price
5. **Operating Hours**: Full week grid with today highlighted
6. **Actions**: Edit Branch, Delete Branch (with confirmation)

---

### 4.4 Barber Management

**Routes:** `/barbers`, `/barbers/new`, `/barbers/:barberId/edit`

#### 4.4.1 Barber List View

| Element | Description |
|---------|-------------|
| Search Bar | Filter by name or specialties |
| Add Button | "Add Barber" primary action |
| Barber Cards | Profile cards with barber info |
| Empty State | Icon + message + CTA |

**Barber Card Content:**
- Profile picture or initials avatar
- Name with status badge (active/away)
- Bio snippet (if available)
- Specialties (up to 3, with +N indicator)
- Contact: Phone, Email
- Today's booking count
- Invite status badge: pending, expired, not invited

**Card Actions:**
- Resend Invite (if not accepted) - with loading spinner
- Edit Profile
- View Schedule
- Delete (with confirmation dialog)

#### 4.4.2 Create/Edit Barber Form

**Profile Section:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Profile Picture | File upload | No | JPEG/PNG/WebP/GIF, max 5MB |
| Active Status | Toggle | No | Default: active |
| Full Name (English) | Text | Yes | Min 2 characters |
| Name (Arabic) | Text | No | - |
| Email | Email | Yes | Valid email, unique |
| Country Code | Select | Yes | GCC countries |
| Phone | Text | Yes | Country-specific validation |
| Bio | Textarea | No | - |

**Services Section:**
- Multi-select checkboxes
- Shows service name, duration, price
- Services filtered by current branch

**Branch Assignment:**
- Auto-assigned to current selected branch

#### 4.4.3 Invitation System

**Invite Flow:**
1. Manager creates barber with email
2. System sends invitation email via Edge Function
3. Barber receives email with accept link
4. Barber clicks link → `/accept-invite` page
5. Barber sets password → account activated

**Invite Tracking Fields:**
- `invite_status`: pending, accepted, expired
- `invite_sent_at`: timestamp
- `invite_accepted_at`: timestamp

**Resend Invite Options:**
- Simple resend to same email
- Resend with user deletion + fresh invite (for email changes)

---

### 4.5 Service Management

**Route:** `/services`

#### 4.5.1 Service List View

| Element | Description |
|---------|-------------|
| Search Bar | Filter services by name |
| Count Display | "X services" count |
| Add Button | "Add Service" primary action |
| Service Cards | Card-based layout with service info |
| Empty States | No services / No search results |

**Service Card Content:**
- Service icon
- Service name
- Description (if available)
- Duration (in minutes)
- Price (with currency)
- Action buttons: Edit, Delete

#### 4.5.2 Create/Edit Service (Modal)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Service Name | Text | Yes | Min 2 characters |
| Description | Textarea | No | - |
| Duration | Number (minutes) | Yes | Min 5 minutes |
| Price | Number | Yes | Min 0 |

**Modal Features:**
- Inline modal (no page navigation)
- Form validation with error display
- Success notification on save
- Branch auto-assignment

---

### 4.6 Booking Management

**Route:** `/bookings`

#### 4.6.1 Calendar Views

**Week View (Default):**
- 7-day grid layout (Monday - Sunday)
- Day headers with day name + date number
- Today's date highlighted with accent color
- Bookings displayed as cards within day cells
- Click day to switch to day view

**Day View:**
- Single day detail view
- Selected date header
- Chronological booking list
- Same booking card format as week view

**Navigation Controls:**
- Previous/Next buttons for week/day navigation
- "Today" button to return to current date
- Date range display (e.g., "Dec 23 - Dec 29, 2024")

#### 4.6.2 Booking Cards

**Card Content:**
- Time slot (e.g., "10:00 AM")
- Customer name
- Service name(s)
- Assigned barber
- Status badge with color

**Status Color Coding:**

| Status | Color | CSS Variable |
|--------|-------|--------------|
| Confirmed | Green | `--status-success` |
| Pending | Amber | `--status-warning` |
| Completed | Blue | `--status-info` |
| Cancelled | Red | `--status-error` |
| No-Show | Red | `--status-error` |

#### 4.6.3 Create Booking (Modal - Large)

**Customer Information Section:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Customer Name | Text | Yes | Min 2 characters |
| Country Code | Select | Yes | GCC countries |
| Phone | Text | Yes | Country-specific format |

**Booking Details Section:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Barber | Select | Yes | Active barbers only |
| Services | Multi-select cards | Yes | Min 1 service |
| Date | Date picker | Yes | Today or future |
| Time | Select | Yes | From TIME_SLOTS |
| Notes | Textarea | No | - |

**Dynamic Calculations:**
- Total Duration: Sum of selected service durations
- Total Price: Sum of selected service prices
- Conflict Detection: Prevents overlapping bookings

**Conflict Detection Logic:**
```
For proposed booking:
  - Check all existing bookings for same barber on same date
  - Calculate time ranges (start to start + duration)
  - If any overlap, display error message
  - Block form submission until resolved
```

#### 4.6.4 Booking Details Sidebar

**Trigger:** Click on booking card

**Sidebar Content:**
- Customer name and phone (with country code)
- Service name(s) with duration
- Assigned barber
- Date and time with duration
- Total price
- Notes (if any)
- Status dropdown for changes
- Close button

**Status Change Operations:**
- Pending → Confirmed, Cancelled
- Confirmed → Completed, Cancelled, No-Show
- Completed → (no changes allowed)
- Cancelled → (no changes allowed)
- No-Show → (no changes allowed)

#### 4.6.5 Booking Status Workflow

```
┌─────────┐     ┌───────────┐     ┌───────────┐
│ Pending │────►│ Confirmed │────►│ Completed │
└─────────┘     └───────────┘     └───────────┘
     │               │
     │               ├────────────►┌───────────┐
     │               │             │ Cancelled │
     │               │             └───────────┘
     │               │
     │               └────────────►┌───────────┐
     │                             │  No-Show  │
     └─────────────────────────────►───────────┘
```

---

### 4.7 Activity Logs

**Route:** `/logs`

#### 4.7.1 Log Dashboard

**Stats Cards:**

| Metric | Icon | Color |
|--------|------|-------|
| Error Count | AlertCircle | Red |
| Warning Count | AlertTriangle | Amber |
| Info Count | Info | Blue |
| Total Logs | FileText | Gray |

#### 4.7.2 Search & Filtering

| Filter | Type | Options |
|--------|------|---------|
| Search | Text input | Full-text search on message |
| Log Level | Multi-select | error, warning, info, debug |
| Log Type | Multi-select | system, booking, barber, auth, navigation |
| Branch | Select | All branches |
| Start Date | Date picker | - |
| End Date | Date picker | - |
| Clear Filters | Button | Reset all filters |

#### 4.7.3 Log Entry Display

**List View:**
- Timestamp
- Level badge (error/warning/info/debug)
- Type badge (system/action/navigation/auth)
- Message summary
- Entity type indicator

**Expanded View (Click to expand):**
- User ID and Role
- Branch ID
- Action performed
- Page URL
- Full timestamp
- Metadata (JSON formatted)
- Stack trace (for errors)

#### 4.7.4 Log Actions

- **Refresh**: Reload logs with current filters
- **Export as JSON**: Download filtered logs as JSON file

---

### 4.8 Notifications System

**Route:** `/notifications`

#### 4.8.1 Notification Display

**TopBar Bell Icon:**
- Bell icon with unread count badge
- Click to navigate to notifications page

**Notifications Page:**
- Filter tabs: All, Unread, Read
- Unread count badge on filter
- Total notifications count

**Notification Item:**
- Title (bold)
- Message body
- Relative timestamp (e.g., "5 minutes ago")
- Unread indicator dot
- "Mark as read" button

#### 4.8.2 Notification Types

| Type | Trigger | Recipients |
|------|---------|------------|
| `booking_created` | New booking made | Manager |
| `booking_reminder` | Upcoming booking | Manager, Barber |
| `booking_status_changed` | Status updated | Manager, Barber |
| `booking_completed` | Booking marked complete | Manager |
| `booking_cancelled` | Booking cancelled | Manager, Barber |
| `barber_profile_updated` | Barber updates profile | Manager |
| `barber_availability_updated` | Availability changed | Manager |
| `barber_invite_accepted` | Barber accepts invite | Manager |
| `system_alert` | System notifications | Both |
| `low_availability_warning` | Low availability | Manager |

#### 4.8.3 Notification Operations

- Mark individual as read
- Mark all as read (batch operation)
- Real-time delivery via Supabase Realtime subscriptions

---

### 4.9 Settings

**Route:** `/settings`

#### 4.9.1 Profile Section (Manager)

| Field | Type | Editable |
|-------|------|----------|
| Avatar | Image upload | Yes |
| Full Name | Text | Yes |
| Email | Email | Yes |
| Phone | Phone with country code | Yes |

#### 4.9.2 Notification Preferences

| Preference | Default | Description |
|------------|---------|-------------|
| New Bookings | On | Notify on new booking creation |
| Booking Updates | On | Notify on status changes |
| Cancellations | On | Notify on booking cancellations |
| Barber Updates | On | Notify on barber profile changes |
| Team Invites | On | Notify on invite acceptances |
| System Alerts | On | System maintenance, warnings |

#### 4.9.3 Appearance Section

**Theme Selector:**
- Dark (Default)
- Light
- System (follows OS preference)

**Language Selector:**
- English
- Arabic (العربية)

#### 4.9.4 Security Section

| Action | Description |
|--------|-------------|
| Change Password | Navigate to password change flow |
| Two-Factor Authentication | Future: Enable 2FA |
| Active Sessions | Future: View/revoke sessions |

#### 4.9.5 Help & Support Section

| Link | Description |
|------|-------------|
| Help Center | Documentation and FAQs |
| Contact Support | Email or chat support |
| Feature Requests | Submit feature ideas |

#### 4.9.6 Danger Zone

- Sign Out Card with warning styling
- Confirmation before sign out

---

## 5. Barber-Specific Features

### 5.1 Barber Dashboard

**Route:** `/barber`

#### 5.1.1 KPI Metric Cards

| Metric | Description | Display |
|--------|-------------|---------|
| Today's Appointments | Total for today | Count + completed/upcoming |
| This Week Total | All bookings this week | Count |
| My Earnings This Week | Revenue from completed | Amount + 8% trend |
| Completion Rate | Completed vs total | Percentage |

#### 5.1.2 Dashboard Sections

1. **Welcome Section**
   - Time-based greeting with first name
   - Branch context display
   - Current date with day of week

2. **Today's Schedule**
   - First 6 bookings for today
   - Booking cards with: time, duration, customer, service, status
   - Action buttons (confirmed/pending only):
     - "Mark Complete" button
     - "Cancel" button
   - "View All My Bookings" link
   - Empty state with calendar CTA

3. **Quick Actions**
   - My Bookings
   - Update Hours
   - My Profile
   - Settings

4. **Completed Today**
   - First 4 completed bookings
   - Shows: customer name, service, price, time
   - Empty state message

---

### 5.2 My Bookings

**Route:** `/barber/bookings`

#### 5.2.1 Calendar View

**Week View Features:**
- 7-day grid (Monday start)
- Date navigation: prev/next week, today button
- Date picker for quick jump
- Week range display

**Calendar Grid:**
- Day headers with day name + date
- Today highlighted with accent
- Bookings sorted chronologically
- Unavailability blocks displayed

#### 5.2.2 Unavailability Visualization

| Block Type | Display | Color |
|------------|---------|-------|
| Day Off | Full day block | Light gray |
| Vacation | Full day block | Blue tint |
| Recurring Time-Off | Partial block with times | Amber tint |
| One-Time Time-Off | Partial block with times | Amber tint |

**Block Content:**
- Type label (Day Off, Vacation, Time Off)
- Time range (for partial blocks)
- Reason (if provided)

#### 5.2.3 Barber Booking Operations

**Create Booking:**
- Same form as manager but:
  - Barber auto-assigned (self)
  - Services filtered to barber's service_ids

**View/Edit Booking:**
- Same sidebar as manager
- Can change status of own bookings

#### 5.2.4 Legend

- Booking status colors explained
- Unavailability type indicators

---

### 5.3 My Availability

**Route:** `/barber/availability`

#### 5.3.1 Tab Navigation

| Tab | Badge | Description |
|-----|-------|-------------|
| Weekly Schedule | - | Set working hours per day |
| Time Off | Count | Manage recurring/one-time time-offs |
| Vacations | Count | Manage vacation periods |

#### 5.3.2 Weekly Schedule Tab

**Summary Cards:**

| Card | Value |
|------|-------|
| Working Days | Count of enabled days |
| Hours Per Week | Total calculated hours |
| Time Offs | Count of active time-offs |
| Upcoming Vacations | Count of future vacations |

**Day Schedule Grid:**

| Element | Description |
|---------|-------------|
| Day Label | Sunday - Saturday |
| Working Toggle | Switch between working/day-off |
| Start Time | Time selector (when working) |
| End Time | Time selector (when working) |
| Hours Display | Calculated hours for day |
| Copy Button | "Copy to all days" |

**Actions:**
- Save button (commits changes)
- Reset button (reverts to saved state)
- Success/error notifications

#### 5.3.3 Time Off Tab

**Add Time Off Form:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Type | Radio | Yes | Recurring Weekly / One-Time Only |
| Day (Recurring) | Select | Conditional | Sunday - Saturday |
| Date (One-Time) | Date picker | Conditional | Future dates only |
| Start Time | Time select | Yes | - |
| End Time | Time select | Yes | Must be after start |
| Reason | Text | No | - |

**Validation Rules:**
- End time must be after start time
- Cannot create time-off on a day-off
- Cannot create one-time on a day-off
- Past dates blocked for one-time

**Time Off Display:**
- Separated sections: Recurring vs One-Time
- Each item shows:
  - Day label (recurring) or Date (one-time)
  - Time range with icon
  - Reason (if provided)
  - Delete button
- Empty states for each section

#### 5.3.4 Vacation Tab

**Add Vacation Form:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Start Date | Date picker | Yes | Today or future |
| End Date | Date picker | Yes | After start date |
| Reason | Text | No | - |

**Vacation Display:**
- Sorted: Upcoming first, then past
- Each item shows:
  - Date range formatted
  - Duration in days
  - Reason (if provided)
  - Status badge: Upcoming (green) / Past (gray)
  - Delete button (upcoming only)
- Empty state with encouraging message

#### 5.3.5 Tips Section

Context-sensitive tips based on active tab:
- Weekly Schedule: How to set up hours
- Time Off: Recurring vs one-time explanation
- Vacations: How vacation blocking works

---

### 5.4 My Profile

**Route:** `/barber/profile`

#### 5.4.1 Profile Card

| Element | Description |
|---------|-------------|
| Large Avatar | Profile picture with edit overlay |
| Name | Current name display |
| Role | "Barber" label |
| Branch | Branch location |

#### 5.4.2 Basic Information Section

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Full Name (English) | Text | Yes | Min 2 characters |
| Name (Arabic) | Text | No | - |

#### 5.4.3 Contact Information Section

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Email | Email | Yes | Valid email format |
| Country Code | Select | Yes | GCC countries |
| Phone | Text | Yes | Country-specific |

#### 5.4.4 Services Section

| Element | Description |
|---------|-------------|
| Services Grid | All services available at barber's branch |
| Checkbox Selection | Multi-select enabled |
| Service Details | Duration and price per service |
| Selected Highlight | Visual emphasis on selected |
| Empty State | Message if no services at branch |

#### 5.4.5 Profile Actions

- Save Changes button (disabled if no changes)
- Loading state during submission
- Success/error notifications
- Profile picture upload with preview

---

## 6. Data Models

### 6.1 Users (Supabase Auth)

```
id: UUID (Primary Key, auto-generated)
email: string (unique, required)
encrypted_password: string (managed by Supabase)
user_metadata: {
  name: string
  phone: string
  role: "manager" | "barber"
}
created_at: timestamp
updated_at: timestamp
```

**Role-Based Access:**
- `manager`: Full access to manager routes
- `barber`: Limited to barber routes, filtered to assigned branch

---

### 6.2 Branches

```sql
id: UUID (Primary Key)
manager_id: UUID (Foreign Key → auth.users)
name: string (required)
name_ar: string (nullable)
address: string (nullable)
city: string (nullable)
country: string (nullable)
governorate_id: integer (Foreign Key → governorates)
area_id: integer (Foreign Key → areas)
location_url: string (nullable, Google Maps URL)
country_code: string (e.g., 'KW', 'SA')
phone: string (required)
email: string (nullable)
number_of_barbers: integer (default: 0)
status: string ('active' | 'inactive')
working_hours: JSONB {
  sunday: { enabled: boolean, start: string, end: string }
  monday: { enabled: boolean, start: string, end: string }
  // ... through saturday
}
image_url: string (nullable, Supabase Storage URL)
created_at: timestamp (auto)
updated_at: timestamp (auto)
```

**Relationships:**
- One manager → Many branches
- One branch → Many barbers
- One branch → Many services
- One branch → Many bookings

---

### 6.3 Barbers

```sql
id: UUID (Primary Key)
user_id: UUID (Foreign Key → auth.users, nullable until invite accepted)
branch_id: UUID (Foreign Key → branches, required)
name: string (required)
name_ar: string (nullable)
email: string (required, unique)
country_code: string (e.g., '+965')
phone: string (required)
status: string ('active' | 'inactive')
avatar_url: string (nullable, Supabase Storage URL)
service_ids: UUID[] (array of service IDs)
availability: JSONB {
  sunday: { enabled: boolean, start: string, end: string }
  monday: { enabled: boolean, start: string, end: string }
  // ... through saturday
}
time_offs: JSONB[] [
  {
    id: string,
    type: 'recurring' | 'one-time',
    day: string (for recurring),
    date: string (for one-time),
    startTime: string,
    endTime: string,
    reason: string (nullable)
  }
]
vacations: JSONB[] [
  {
    id: string,
    startDate: string,
    endDate: string,
    reason: string (nullable)
  }
]
invite_status: string ('pending' | 'accepted' | 'expired')
invite_sent_at: timestamp (nullable)
invite_accepted_at: timestamp (nullable)
created_at: timestamp (auto)
updated_at: timestamp (auto)
```

**Relationships:**
- Many barbers → One branch
- One barber → Many bookings
- Barber services reference services table via service_ids array

---

### 6.4 Services

```sql
id: UUID (Primary Key)
branch_id: UUID (Foreign Key → branches, required)
name: string (required)
description: string (nullable)
duration: integer (minutes, required, min 5)
price: decimal (required, min 0)
status: string ('active' | 'inactive')
created_at: timestamp (auto)
updated_at: timestamp (auto)
```

**Relationships:**
- Many services → One branch
- Referenced by barbers.service_ids
- Referenced by bookings.service_ids

---

### 6.5 Bookings

```sql
id: UUID (Primary Key)
branch_id: UUID (Foreign Key → branches, required)
barber_id: UUID (Foreign Key → barbers, required)
service_ids: UUID[] (array, min 1 required)
customer_name: string (required)
customer_country_code: string (e.g., '+965')
customer_phone: string (required)
date: date (YYYY-MM-DD format, required)
time: string (HH:MM 24-hour format, required)
duration: integer (minutes, calculated from services)
price: decimal (calculated from services)
status: string ('pending' | 'confirmed' | 'completed' | 'cancelled' | 'no-show')
notes: string (nullable)
created_at: timestamp (auto)
updated_at: timestamp (auto)
```

**Relationships:**
- Many bookings → One branch
- Many bookings → One barber
- Booking references multiple services via service_ids

**Indexes:**
- `(branch_id, date)` for daily queries
- `(barber_id, date)` for barber schedule
- `(status)` for filtering

---

### 6.6 Notifications

```sql
id: UUID (Primary Key)
recipient_user_id: UUID (Foreign Key → auth.users, for barbers)
recipient_branch_id: UUID (Foreign Key → branches, for managers)
recipient_role: string ('manager' | 'barber')
type: string (notification type enum)
title: string (required)
message: string (required)
entity_type: string ('booking' | 'barber' | 'branch' | 'service', nullable)
entity_id: UUID (nullable, reference to related entity)
is_read: boolean (default: false)
read_at: timestamp (nullable)
metadata: JSONB (additional context, nullable)
created_at: timestamp (auto)
```

**Notification Type Enum:**
```
booking_created, booking_reminder, booking_status_changed,
booking_completed, booking_cancelled, barber_profile_updated,
barber_availability_updated, barber_invite_accepted,
system_alert, low_availability_warning
```

---

### 6.7 Logs

```sql
id: UUID (Primary Key)
level: string ('error' | 'warning' | 'info' | 'debug')
log_type: string ('error' | 'action' | 'navigation' | 'system' | 'auth')
user_id: UUID (Foreign Key → auth.users, nullable)
user_role: string ('manager' | 'barber', nullable)
branch_id: UUID (Foreign Key → branches, nullable)
barber_id: UUID (Foreign Key → barbers, nullable)
entity_type: string ('branch' | 'barber' | 'service' | 'booking', nullable)
entity_id: UUID (nullable)
action: string ('create' | 'update' | 'delete' | 'view' | 'login' | 'logout' | 'signup' | 'navigate')
message: string (required)
stack_trace: string (nullable, for errors)
metadata: JSONB (additional context, nullable)
user_agent: string (browser info)
page_url: string (current page)
created_at: timestamp (auto)
```

**Log Processing:**
- Batch queue: 10 items per batch, 5-second flush interval
- Automatic console logging in development mode
- Context preservation across log calls

---

### 6.8 User Notification Preferences

```sql
id: UUID (Primary Key)
user_id: UUID (Foreign Key → auth.users, unique)
new_bookings: boolean (default: true)
booking_updates: boolean (default: true)
cancellations: boolean (default: true)
barber_updates: boolean (default: true)
team_invites: boolean (default: true)
system_alerts: boolean (default: true)
new_bookings_enabled_at: timestamp (nullable)
booking_updates_enabled_at: timestamp (nullable)
cancellations_enabled_at: timestamp (nullable)
system_alerts_enabled_at: timestamp (nullable)
created_at: timestamp (auto)
updated_at: timestamp (auto)
```

**Preference Mapping:**

| Notification Type | Preference Key |
|-------------------|----------------|
| booking_created, booking_reminder | new_bookings |
| booking_status_changed, booking_completed | booking_updates |
| booking_cancelled | cancellations |
| barber_profile_updated, barber_availability_updated | barber_updates |
| barber_invite_accepted | team_invites |
| system_alert, low_availability_warning | system_alerts |

---

### 6.9 Locations (Reference Data)

**Governorates:**
```sql
id: integer (Primary Key)
name_en: string
name_ar: string
code: string
```

**Areas:**
```sql
id: integer (Primary Key)
governorate_id: integer (Foreign Key → governorates)
name_en: string
name_ar: string
```

**Pre-populated Data:**
- 6 Kuwait governorates
- 115+ areas across all governorates

---

### 6.10 Entity Relationship Diagram

```
┌─────────────┐
│    Users    │
│  (Supabase) │
└──────┬──────┘
       │
       ├──────────────────────────────────────┐
       │ (manager_id)                         │ (user_id)
       ▼                                      ▼
┌─────────────┐    (branch_id)         ┌─────────────┐
│   Branches  │◄───────────────────────│   Barbers   │
└──────┬──────┘                        └──────┬──────┘
       │                                      │
       │ (branch_id)              (barber_id) │
       ▼                                      ▼
┌─────────────┐                        ┌─────────────┐
│   Services  │◄───────────────────────│   Bookings  │
└─────────────┘    (service_ids[])     └─────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│Notifications│    │    Logs     │    │ Preferences │
└─────────────┘    └─────────────┘    └─────────────┘
```

---

## 7. UI/UX Specifications

### 7.1 Design System

#### 7.1.1 Color Palette

**Dark Theme (Default):**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | #0D0B09 | Main background |
| `--bg-secondary` | #161311 | Card backgrounds |
| `--bg-tertiary` | #1E1A17 | Elevated surfaces |
| `--bg-elevated` | #252119 | Modals, dropdowns |
| `--text-primary` | #F5F0E8 | Primary text |
| `--text-secondary` | #A8A095 | Muted text |
| `--text-muted` | #6B6560 | Placeholder text |
| `--accent-primary` | #D4A853 | Primary brand color (Amber) |
| `--accent-secondary` | #B8923F | Hover states |

**Light Theme:**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | #FAF8F5 | Main background |
| `--bg-secondary` | #F5F2ED | Card backgrounds |
| `--bg-tertiary` | #EFEBE5 | Elevated surfaces |
| `--bg-elevated` | #FFFFFF | Modals, dropdowns |
| `--text-primary` | #1A1714 | Primary text |
| `--text-secondary` | #5C574F | Muted text |

**Status Colors:**

| Token | Value | Usage |
|-------|-------|-------|
| `--status-success` | #5BA858 | Confirmed, active, completed |
| `--status-warning` | #D4A853 | Pending, attention needed |
| `--status-error` | #C75A5A | Cancelled, errors, no-show |
| `--status-info` | #5A8AC7 | Informational |

**Booking Slot Colors:**

| Token | Value | Usage |
|-------|-------|-------|
| `--slot-available` | #3D5A3D | Available time slots |
| `--slot-busy` | #5A3D3D | Booked time slots |
| `--slot-vacation` | #3D4A5A | Vacation/time-off |

#### 7.1.2 Typography

**Font Families:**
- **Display Font**: Cormorant Garamond (serif) - Headings, brand elements
- **Body Font**: Outfit (sans-serif) - All body text, UI elements

**Font Scale:**

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| h1 | 2.5rem (40px) | 600 | 1.2 |
| h2 | 2rem (32px) | 600 | 1.25 |
| h3 | 1.5rem (24px) | 600 | 1.3 |
| h4 | 1.25rem (20px) | 500 | 1.35 |
| Body | 1rem (16px) | 400 | 1.6 |
| Small | 0.875rem (14px) | 400 | 1.5 |
| Caption | 0.75rem (12px) | 400 | 1.4 |

**Mobile Scaling:**
- h1: 1.5rem on mobile
- h2: 1.25rem on mobile

#### 7.1.3 Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | Tight spacing, icon gaps |
| `--space-sm` | 8px | Small element margins |
| `--space-md` | 16px | Default spacing |
| `--space-lg` | 24px | Section spacing |
| `--space-xl` | 32px | Large gaps |
| `--space-2xl` | 48px | Major sections |
| `--space-3xl` | 64px | Page-level spacing |

#### 7.1.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px | Small elements, badges |
| `--radius-md` | 8px | Buttons, inputs |
| `--radius-lg` | 12px | Cards, dropdowns |
| `--radius-xl` | 16px | Modals, large containers |
| `--radius-full` | 9999px | Circles, pills |

#### 7.1.5 Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, dropdowns |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.15)` | Modals, popovers |
| `--accent-glow` | `0 0 20px rgba(212,168,83,0.3)` | Accent highlights |

---

### 7.2 Component Library

#### 7.2.1 Modal Component

**Props:**
- `isOpen`: boolean - Control visibility
- `onClose`: function - Close handler
- `title`: string - Modal header
- `size`: 'default' | 'large' | 'xlarge'
- `children`: ReactNode - Modal content

**Sizes:**

| Size | Width | Use Case |
|------|-------|----------|
| default | 500px | Simple forms, confirmations |
| large | 720px | Complex forms (booking) |
| xlarge | 900px | Data-heavy views |

**Features:**
- Closes on ESC key press
- Prevents body scroll when open
- Backdrop blur effect (`backdrop-filter: blur(4px)`)
- Mobile: Slides up from bottom, full-height on <380px
- Drag handle indicator on mobile

#### 7.2.2 ConfirmDialog Component

**Props:**
- `isOpen`: boolean
- `onClose`: function
- `onConfirm`: function
- `title`: string
- `message`: string
- `confirmText`: string (default: "Confirm")
- `variant`: 'danger' | 'warning' | 'info'

**Variants:**

| Variant | Icon | Color | Use Case |
|---------|------|-------|----------|
| danger | AlertTriangle | Red | Delete operations |
| warning | AlertCircle | Amber | Irreversible actions |
| info | Info | Blue | General confirmations |

#### 7.2.3 NotificationToast Component

**Props:**
- `message`: string
- `title`: string (optional)
- `type`: 'success' | 'error' | 'warning' | 'info'
- `duration`: number (default: 5000ms)
- `onClose`: function

**Styling:**
- Position: Fixed top-right (80px from top, 24px from right)
- Width: 350px max (responsive on mobile)
- Border accent color on left (3px)
- Slide-in/out animations
- Auto-dismisses after duration

#### 7.2.4 ThemeSelector Component

**Options:**
- Dark theme (moon icon)
- Light theme (sun icon)
- System preference (monitor icon)

**Behavior:**
- Dropdown select interface
- Immediate application
- Persistence to localStorage + database

#### 7.2.5 LanguageSelector Component

**Options:**
- English (flag + "English")
- Arabic (flag + "العربية")

**Behavior:**
- Dropdown select interface
- Immediate application
- RTL layout trigger for Arabic
- Persistence to localStorage

---

### 7.3 Form Specifications

#### 7.3.1 BarberForm

**Sections:**

1. **Profile Picture Section**
   - Circular image preview (120x120px)
   - Initials fallback (2 letters)
   - Click to upload overlay
   - Supported: JPEG, PNG, WebP, GIF
   - Max size: 5MB

2. **Status Toggle**
   - Checkbox with "Active" label
   - Default: checked

3. **Basic Information**
   - Full Name (English) - required
   - Name (Arabic) - optional
   - Email - required, validated
   - Country Code + Phone - required, validated

4. **Services Assignment**
   - Multi-select checkboxes
   - Grid layout
   - Shows: name, duration, price per service

#### 7.3.2 BranchForm

**Sections:**

1. **Branch Image**
   - Landscape ratio container
   - Building2 icon placeholder
   - Click to upload

2. **Basic Information**
   - Name (English/Arabic)
   - Location URL
   - Governorate → Area (cascading)
   - Country Code + Phone

3. **Operating Hours**
   - 7-day grid
   - Toggle + time inputs per day
   - Copy to all utility

#### 7.3.3 BookingForm

**Sections:**

1. **Customer Information**
   - Customer Name - required
   - Country Code + Phone - required, validated

2. **Booking Details**
   - Barber Selection (manager view only)
   - Services (multi-select cards with checkmarks)
   - Date picker
   - Time slot selector
   - Notes (optional textarea)

3. **Summary (Read-only)**
   - Total Duration
   - Total Price
   - Conflict Warning (if applicable)

---

### 7.4 Responsive Breakpoints

| Breakpoint | Width | Description |
|------------|-------|-------------|
| Desktop | > 1024px | Full layout, sidebar visible |
| Tablet | 768px - 1024px | Collapsed sidebar, adjusted grid |
| Mobile | 480px - 768px | Single column, bottom navigation |
| Small | < 480px | Compact UI, stacked elements |
| Very Small | < 380px | Full-height modals, minimal padding |

**Layout Adaptations:**

| Element | Desktop | Mobile |
|---------|---------|--------|
| Sidebar | 260px visible | Hidden, toggle menu |
| TopBar | 72px height | 64px height |
| Cards | 3-4 column grid | 1-2 column |
| Modals | Centered overlay | Bottom sheet |
| Tables | Horizontal scroll | Card layout |

---

### 7.5 Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Touch Targets | Minimum 44x44px |
| Focus States | 2px outline with accent color |
| Keyboard Navigation | Tab order, ESC to close |
| Screen Readers | Semantic HTML, ARIA labels |
| Color Contrast | WCAG AA compliance |
| Safe Areas | iOS notch/home indicator support |
| Font Sizing | 16px minimum for inputs (iOS zoom prevention) |

---

### 7.6 Animations

**Keyframe Animations:**

| Animation | Description | Duration |
|-----------|-------------|----------|
| fadeIn | Opacity 0 → 1 | 150ms |
| fadeInUp | Opacity + translateY(10px → 0) | 250ms |
| fadeInDown | Opacity + translateY(-10px → 0) | 250ms |
| scaleIn | Scale 0.95 → 1 + opacity | 200ms |
| slideInRight | translateX(100% → 0) | 300ms |
| shimmer | Background gradient slide | 1.5s infinite |
| pulse | Opacity 1 → 0.5 → 1 | 2s infinite |
| glow | Box-shadow pulse | 2s infinite |

**Transition Speeds:**
- Fast: 150ms (micro-interactions)
- Base: 250ms (standard transitions)
- Slow: 400ms (complex animations)

**Stagger Classes:**
- `.stagger-1` through `.stagger-6` for cascading reveals

---

## 8. Technical Architecture

### 8.1 Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend Framework | React | 18.2.0 |
| Build Tool | Vite | 5.0.0 |
| Router | React Router | 6.20.0 |
| Backend | Supabase | 2.89.0 |
| Styling | CSS Custom Properties | - |
| i18n | i18next + react-i18next | 25.7.3 / 16.5.0 |
| Icons | lucide-react | 0.294.0 |
| Dates | date-fns | 2.30.0 |

### 8.2 Supabase Services

| Service | Usage |
|---------|-------|
| Auth | User authentication, role management |
| Database | PostgreSQL for all data |
| Realtime | Notification subscriptions |
| Storage | Avatar and image uploads (`avatars` bucket) |
| Edge Functions | Barber invitation emails |

### 8.3 State Management

**AppContext (React Context):**

```javascript
{
  // Authentication
  user: User | null,
  userRole: 'manager' | 'barber',
  barberProfile: Barber | null,

  // Domain Data
  branches: Branch[],
  barbers: Barber[],
  services: Service[],
  bookings: Booking[],
  notifications: Notification[],

  // UI State
  selectedBranchId: string | null,
  theme: 'dark' | 'light' | 'system',
  language: 'en' | 'ar',

  // Loading States
  loading: boolean,

  // Actions
  refreshData: () => void,
  setSelectedBranchId: (id: string) => void,
  setTheme: (theme: string) => void,
  setLanguage: (lang: string) => void,
}
```

**Access:**
```javascript
const { user, branches, selectedBranchId } = useApp();
```

### 8.4 Service Layer Pattern

**Structure:**
```
src/services/
├── auth.service.js
├── branches.service.js
├── barbers.service.js
├── services.service.js
├── bookings.service.js
├── notifications.service.js
├── notificationPreferences.service.js
├── logging.service.js
├── locations.service.js
├── storage.service.js
└── index.js
```

**Service Pattern:**
```javascript
// Case conversion: snake_case (DB) ↔ camelCase (frontend)
const toFrontend = (dbRecord) => ({
  id: dbRecord.id,
  branchId: dbRecord.branch_id,
  customerName: dbRecord.customer_name,
  // ...
});

const toDatabase = (frontendData) => ({
  branch_id: frontendData.branchId,
  customer_name: frontendData.customerName,
  // ...
});

export const entityService = {
  getAll: async (filters) => { /* ... */ },
  getById: async (id) => { /* ... */ },
  create: async (data) => { /* ... */ },
  update: async (id, data) => { /* ... */ },
  delete: async (id) => { /* ... */ },
};
```

### 8.5 File Upload (Storage Service)

**Configuration:**
- Bucket: `avatars`
- Allowed MIME Types: image/jpeg, image/png, image/webp, image/gif
- Max Size: 5MB
- Security: MIME validation, extension matching, path traversal prevention

**Operations:**
```javascript
storageService.uploadImage(file, path);    // Upload new
storageService.deleteImage(url);           // Delete existing
storageService.replaceImage(oldUrl, file, path); // Replace
```

---

## 9. Non-Functional Requirements

### 9.1 Performance

| Requirement | Implementation |
|-------------|----------------|
| Component Memoization | `useMemo`, `useCallback` for expensive computations |
| Batch Operations | Log queue (10 items, 5s flush) |
| Data Filtering | Branch-scoped queries reduce payload |
| Lazy Loading | Future: Route-based code splitting |
| Image Optimization | Max 5MB, appropriate formats |

### 9.2 Security

| Requirement | Implementation |
|-------------|----------------|
| Authentication | Supabase Auth with JWT |
| Authorization | Role-based route protection |
| Input Validation | Email format, phone by country, file type |
| File Upload | MIME validation, size limits, path sanitization |
| Data Isolation | Branch-scoped queries, row-level security |
| Session Management | Supabase session handling |

### 9.3 Localization

| Requirement | Implementation |
|-------------|----------------|
| Languages | English (en), Arabic (ar) |
| RTL Support | `dir="rtl"` on document, CSS adjustments |
| Date Formatting | date-fns with locale-aware formatting |
| Number Formatting | Locale-aware currency display |
| Translation Keys | 714 keys across all features |
| Persistence | localStorage for preference |

### 9.4 Mobile Responsiveness

| Requirement | Implementation |
|-------------|----------------|
| Breakpoints | 1024px, 768px, 480px, 380px |
| Touch Targets | 44px minimum |
| Safe Areas | iOS notch, home indicator |
| Bottom Sheets | Modals as sheets on mobile |
| Touch Feedback | Active state transforms |
| Input Zoom Prevention | 16px font on inputs |

### 9.5 Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |
| iOS Safari | 14+ |
| Chrome Android | 90+ |

---

## 10. Routes & Navigation

### 10.1 Public Routes

| Route | Component | Description |
|-------|-----------|-------------|
| `/login` | Login | User authentication |
| `/signup` | Signup | Manager registration |
| `/forgot-password` | ForgotPassword | Password recovery |
| `/reset-password` | ResetPassword | Set new password |
| `/accept-invite` | AcceptInvite | Barber invitation acceptance |

### 10.2 Manager Routes (Protected)

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Dashboard | Manager dashboard |
| `/branches` | Branches | Branch list |
| `/branches/new` | AddBranch | Create branch |
| `/branches/:branchId` | BranchDetails | View branch |
| `/branches/:branchId/edit` | EditBranch | Edit branch |
| `/services` | Services | Service management |
| `/barbers` | Barbers | Barber list |
| `/barbers/new` | AddBarber | Create barber |
| `/barbers/:barberId/edit` | EditBarber | Edit barber |
| `/bookings` | Bookings | Booking calendar |
| `/logs` | Logs | Activity logs |
| `/notifications` | Notifications | Notification center |
| `/settings` | Settings | User settings |

### 10.3 Barber Routes (Protected)

| Route | Component | Description |
|-------|-----------|-------------|
| `/barber` | BarberDashboard | Barber dashboard |
| `/barber/bookings` | MyBookings | Personal bookings |
| `/barber/availability` | MyAvailability | Schedule management |
| `/barber/profile` | MyProfile | Profile editing |
| `/barber/logs` | MyLogs | Personal activity |
| `/barber/notifications` | Notifications | Notifications |
| `/barber/settings` | Settings | User settings |

### 10.4 Route Protection

**ProtectedRoute Component:**
```jsx
<ProtectedRoute allowedRole="manager">
  <ManagerRoutes />
</ProtectedRoute>

<ProtectedRoute allowedRole="barber">
  <BarberRoutes />
</ProtectedRoute>
```

**Behavior:**
- Unauthenticated → Redirect to `/login`
- Wrong role → Redirect to role-appropriate dashboard
- Authenticated + correct role → Render children

---

## 11. Business Logic Constants

### 11.1 Booking Statuses

```javascript
BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show'
}
```

**Status Configuration:**

| Status | Icon | Label | Color |
|--------|------|-------|-------|
| confirmed | CheckCircle | Confirmed | success |
| pending | AlertCircle | Pending | warning |
| completed | CheckCircle | Completed | info |
| cancelled | XCircle | Cancelled | error |
| no-show | XCircle | No Show | error |

### 11.2 Time Configuration

**Time Slots (Booking):**
- Range: 7:00 AM - 8:30 PM
- Interval: 30 minutes
- Format: "HH:MM" (24-hour) with display label

**Time Options (Availability):**
- Range: 6:00 AM - 11:30 PM
- Interval: 30 minutes

**Default Schedules:**

| Day | Branch Default | Barber Default |
|-----|----------------|----------------|
| Sunday | Closed | Disabled |
| Monday-Friday | 9:00 AM - 6:00 PM | 9:00 AM - 6:00 PM |
| Saturday | 9:00 AM - 4:00 PM | 9:00 AM - 4:00 PM |

### 11.3 GCC Countries

| Country | Code | Phone Code | Phone Length | Format |
|---------|------|------------|--------------|--------|
| Kuwait | KW | +965 | 8 | XXXX XXXX |
| Saudi Arabia | SA | +966 | 9 | 5X XXX XXXX |
| UAE | AE | +971 | 9 | 5X XXX XXXX |
| Bahrain | BH | +973 | 8 | XXXX XXXX |
| Qatar | QA | +974 | 8 | XXXX XXXX |
| Oman | OM | +968 | 8 | XXXX XXXX |

### 11.4 Log Configuration

**Log Levels:**
- `error` - Application errors with stack traces
- `warning` - Potential issues, degraded functionality
- `info` - General information, user actions
- `debug` - Development debugging (filtered in production)

**Log Types:**
- `error` - Exception handling
- `action` - CRUD operations
- `navigation` - Page transitions
- `system` - System events
- `auth` - Login, logout, signup

**Actions:**
- `create`, `update`, `delete`, `view`
- `login`, `logout`, `signup`, `navigate`

---

## 12. Internationalization

### 12.1 Supported Languages

| Language | Code | Direction | Status |
|----------|------|-----------|--------|
| English | en | LTR | Complete |
| Arabic | ar | RTL | Complete |

### 12.2 Translation Structure

```
src/i18n/
├── index.js           # i18next configuration
└── locales/
    ├── en.json        # English translations (714 keys)
    └── ar.json        # Arabic translations (714 keys)
```

### 12.3 Translation Categories

| Category | Key Count | Coverage |
|----------|-----------|----------|
| common | 67 | Buttons, labels, status |
| nav | 12 | Navigation items |
| auth | 57 | Login, signup, password |
| dashboard | 29 | Dashboard elements |
| branches | 43 | Branch management |
| barbers | 47 | Barber management |
| services | 20 | Service management |
| bookings | 62 | Booking system |
| settings | 54 | Settings page |
| logs | 44 | Activity logs |
| availability | 72 | Barber availability |
| profile | 15 | Profile management |
| notifications | 16 | Notification system |
| validation | 24 | Form validation |
| days | 7 | Day names |
| months | 12 | Month names |
| countries | 6 | GCC country names |

### 12.4 RTL Implementation

**Document Level:**
```javascript
document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
```

**CSS Adaptations:**
- Sidebar position flips (left ↔ right)
- Layout margins reversed
- Dropdown menus repositioned
- Directional icons flipped (chevrons)
- Modal close button repositioned
- Table text alignment reversed
- Brand name locked to LTR

### 12.5 Usage Pattern

```javascript
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation();

  return (
    <h1>{t('dashboard.welcome')}</h1>
    <button>{t('common.save')}</button>
  );
}
```

---

## Appendix A: File Structure

```
src/
├── components/
│   ├── Forms/
│   │   ├── BarberForm.jsx
│   │   ├── BranchForm.jsx
│   │   └── BookingForm.jsx
│   ├── Layout/
│   │   ├── Layout.jsx
│   │   ├── BarberLayout.jsx
│   │   ├── Sidebar.jsx
│   │   ├── BarberSidebar.jsx
│   │   └── TopBar.jsx
│   ├── UI/
│   │   ├── Modal.jsx
│   │   ├── ConfirmDialog.jsx
│   │   ├── NotificationToast.jsx
│   │   ├── ThemeSelector.jsx
│   │   ├── LanguageSelector.jsx
│   │   └── SignOutCard.jsx
│   └── ErrorBoundary.jsx
├── pages/
│   ├── Dashboard.jsx
│   ├── Branches.jsx
│   ├── AddBranch.jsx
│   ├── EditBranch.jsx
│   ├── BranchDetails.jsx
│   ├── Barbers.jsx
│   ├── AddBarber.jsx
│   ├── EditBarber.jsx
│   ├── Services.jsx
│   ├── Bookings.jsx
│   ├── Logs.jsx
│   ├── Notifications.jsx
│   ├── Settings.jsx
│   ├── Login.jsx
│   ├── Signup.jsx
│   ├── ForgotPassword.jsx
│   ├── ResetPassword.jsx
│   ├── AcceptInvite.jsx
│   └── barber/
│       ├── BarberDashboard.jsx
│       ├── MyBookings.jsx
│       ├── MyAvailability.jsx
│       ├── MyProfile.jsx
│       └── MyLogs.jsx
├── services/
│   ├── auth.service.js
│   ├── branches.service.js
│   ├── barbers.service.js
│   ├── services.service.js
│   ├── bookings.service.js
│   ├── notifications.service.js
│   ├── notificationPreferences.service.js
│   ├── logging.service.js
│   ├── locations.service.js
│   ├── storage.service.js
│   └── index.js
├── context/
│   └── AppContext.jsx
├── hooks/
│   ├── useGeoLocation.js
│   └── useLogger.js
├── utils/
│   ├── validation.js
│   ├── caseConverter.js
│   ├── bookingConflicts.js
│   ├── logger.js
│   └── globalErrorHandler.js
├── constants/
│   ├── bookingStatuses.js
│   ├── countries.js
│   ├── locations.js
│   ├── logTypes.js
│   └── time.js
├── i18n/
│   ├── index.js
│   └── locales/
│       ├── en.json
│       └── ar.json
├── lib/
│   └── supabase.js
├── styles/
│   └── index.css
├── App.jsx
└── main.jsx
```

---

## Appendix B: Environment Variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| Branch | A physical barbershop location |
| Barber | A staff member who provides services |
| Booking | An appointment between customer and barber |
| Service | A type of service offered (haircut, beard, etc.) |
| Availability | Barber's weekly working schedule |
| Time-Off | Temporary unavailability (recurring or one-time) |
| Vacation | Extended unavailability period |
| Manager | User role with full administrative access |
| GCC | Gulf Cooperation Council (Kuwait, Saudi, UAE, Bahrain, Qatar, Oman) |
| RTL | Right-to-Left text direction (Arabic) |
| KPI | Key Performance Indicator |

---

*Document generated from Barber++ codebase analysis*
*Version 1.0.0 | December 2024*
