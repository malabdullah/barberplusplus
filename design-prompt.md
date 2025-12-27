Project Name

Barber++ — Manager Dashboard (Design Phase)

1. Objective (Design Only)

Create a complete design specification for a web-based barbershop manager dashboard.

⚠️ Do NOT generate code
⚠️ Do NOT generate APIs or database migrations

The output must be:

UI/UX structure

Screen hierarchy

User flows

Component breakdowns

Data models (conceptual, not technical)

System boundaries

This design will later be used to implement the system.

2. Product Goal

Enable barbershop managers to easily manage branches, services, barbers, and bookings from a single web dashboard, in preparation for WhatsApp-based booking automation.

Design for:

Speed

Clarity

Low cognitive load

Non-technical users

3. User Roles (Design Context)
Manager (Primary)

Owns one or more branches

Controls all data within those branches

Barber (Secondary – Limited)

Belongs to one branch

Manages own profile & bookings only

4. Information Architecture (Required Output)

Design and clearly document:

A. Navigation Structure

Sidebar menu items

Top bar actions

Global vs branch-scoped navigation

Example (conceptual):

Dashboard

Branches

Services

Barbers

Bookings

Settings

B. Screen List (All Required Screens)

For each screen, describe:

Purpose

Primary actions

Secondary actions

Key data displayed

Mandatory Screens

Login / Auth

Dashboard Home

Branch List

Branch Details

Service Management

Barber Management

Booking Calendar

Booking Create / Edit

Manager Profile & Settings

5. Screen-by-Screen UX Design

For each screen, define:

Layout (cards, tables, calendar, forms)

Empty states

Error states

Confirmation dialogs

Primary CTA

User intent

⚠️ Avoid visual mockups — describe structure instead.

6. Booking Design (Critical Section)

Design how manual booking works:

Calendar interaction

Time-slot selection

Conflict handling

Availability indicators

Editing vs canceling bookings

Visual signals for:

Busy slots

Available slots

Time off / vacation

7. Branch-Centric Design Rules

Explicitly define:

How managers switch between branches

What data is global vs branch-specific

How the UI prevents cross-branch mistakes

8. Component Design (Conceptual)

List reusable components such as:

Branch selector

Barber card

Service list item

Booking modal

Availability editor

Confirmation dialogs

Explain:

Purpose

Where it’s used

What data it consumes

9. Data Model (Conceptual – No SQL)

Describe entities and relationships in plain language:

Manager

Branch

Barber

Service

Booking

Focus on:

Ownership

Constraints

Real-world logic

10. User Flows (Text-Based)

Define step-by-step flows for:

Creating a new branch

Adding a barber

Creating a booking

Editing a booking

Handling conflicts

Use bullet steps, not diagrams.

11. UX Principles (Must Follow)

One main action per screen

No hidden critical actions

Safe defaults

Clear destructive action warnings

Minimal typing

12. Future Readiness (Design-Level)

Design must allow future:

WhatsApp booking automation

Customer entity

Subscription plans

Multi-language support

But do not design these now — just ensure no blockers.

13. Output Format (Important)

Claude Code must output:

Sectioned design document

Clear headings

No code blocks

No technical implementation

No assumptions outside scope

Final Instruction to Claude Code

Act as a senior product designer and UX architect.
Produce a clear, structured design specification that a development team can implement without confusion.