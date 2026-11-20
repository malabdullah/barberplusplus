# Offline redirect matcher check

Uses the exact glob version and separators from the production Auth v2.189.0 source:
- https://github.com/supabase/auth/blob/v2.189.0/go.mod
- https://github.com/supabase/auth/blob/v2.189.0/internal/conf/configuration.go

Run from this directory with Go 1.24+:

    go run . ../../../docs/release-review/android-live-2026-11-20/configuration-manifest.json

No provider call, server, credential or configuration write is made. The check compiles the five proposed URL allowlist patterns and verifies positive and malformed/foreign/suffixed inputs. This validates matcher compatibility, not a real OAuth/email-provider round trip.
