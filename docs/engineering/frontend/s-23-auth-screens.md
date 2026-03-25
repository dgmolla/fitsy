# S-23: Auth Screens — Login, Register, and Auth Guard

## Overview

This document specifies the mobile auth screens for Fitsy: a login screen, a
registration screen, and an auth guard that checks for a stored JWT on app start
and redirects accordingly.

The auth backend (`POST /api/auth/register`, `POST /api/auth/login`) was
implemented in S-22. These screens are the mobile-side counterpart.

---

## Auth Flow

```mermaid
flowchart TD
    A[App Start] --> B{JWT in SecureStore?}
    B -- Yes --> C[Redirect to /tabs/search]
    B -- No --> D[Redirect to /auth/login]

    D --> E[Login Screen]
    E -- "Tap 'Create account'" --> F[Register Screen]
    F -- "Tap 'Log in'" --> E

    E -- Submit credentials --> G[POST /api/auth/login]
    G -- 200 OK --> H[Store JWT in SecureStore]
    H --> C
    G -- 4xx/5xx --> I[Show inline error]

    F -- Submit form --> J[POST /api/auth/register]
    J -- 201 Created --> K[Store JWT in SecureStore]
    K --> C
    J -- 4xx/5xx --> L[Show inline error]
```

---

## File Map

| File | Purpose |
|------|---------|
| `apps/mobile/app/_layout.tsx` | Root layout — mounts `AuthProvider`, drives initial redirect |
| `apps/mobile/app/auth/_layout.tsx` | Auth stack layout (no tab bar) |
| `apps/mobile/app/auth/login.tsx` | Login form screen |
| `apps/mobile/app/auth/register.tsx` | Registration form screen |
| `apps/mobile/lib/authClient.ts` | `login()` / `register()` API calls + SecureStore helpers |
| `apps/mobile/lib/apiClient.ts` | Updated to attach `Authorization: Bearer <token>` header |

---

## Token Storage

JWTs are stored in `expo-secure-store` (encrypted, hardware-backed on device) under
the key `fitsy:authToken`. `AsyncStorage` is **not** used for tokens — it is
unencrypted and unsuitable for credentials.

---

## API Contract

Both endpoints are defined in S-22. Expected shapes:

### POST /api/auth/register
```json
// Request
{ "name": "Jane Doe", "email": "jane@example.com", "password": "s3cure!" }
// 201 Response
{ "token": "<jwt>", "user": { "id": "...", "email": "...", "name": "..." } }
```

### POST /api/auth/login
```json
// Request
{ "email": "jane@example.com", "password": "s3cure!" }
// 200 Response
{ "token": "<jwt>", "user": { "id": "...", "email": "...", "name": "..." } }
// Error (4xx)
{ "error": "Invalid credentials" }
```

---

## Screen Specs

### Login Screen (`/auth/login`)

- Fields: Email (keyboard type `email-address`, `autoCapitalize="none"`), Password (`secureTextEntry`)
- Primary CTA: "Log in" button — disabled while loading
- Secondary link: "Don't have an account? Create one"
- Error state: red banner below form showing `error` message from API
- On success: store JWT, replace stack with `/(tabs)/search`

### Register Screen (`/auth/register`)

- Fields: Name, Email, Password
- Primary CTA: "Create account" button — disabled while loading
- Secondary link: "Already have an account? Log in"
- Error state: same red banner pattern as login
- On success: store JWT, replace stack with `/(tabs)/search`

### Auth Guard (root `_layout.tsx`)

- On mount, read `fitsy:authToken` from SecureStore
- If token present → `router.replace('/(tabs)/search')`
- If absent → `router.replace('/auth/login')`
- Render `null` (or a spinner) while the check is in flight to avoid flash

---

## Accessibility

- All form inputs have `accessibilityLabel` props
- Touch targets are at minimum 44x44pt
- Error messages are announced via `accessibilityLiveRegion="polite"` on the error container
- Loading state disables the submit button and updates its `accessibilityLabel`

---

## Design Tokens (from existing codebase)

| Token | Value |
|-------|-------|
| Primary green | `#2D7D46` |
| Background | `#F9FAFB` |
| Text muted | `#6B7280` |
| Error red | `#DC2626` |
| Error background | `#FEE2E2` |
| Border | `#D1D5DB` |
