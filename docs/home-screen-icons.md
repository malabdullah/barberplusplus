# Home Screen icons

The website uses the approved Barber++ symbol, with a square white background,
for its iPhone touch icon and manifest icons. These PNGs are opaque RGB exports;
removing the unused alpha channel preserves every RGB pixel. The SVG logo
artwork and the application's light/dark theme behavior are unchanged.

`index.html` references `/apple-touch-icon-v2.png` and a versioned manifest.
The existing touch-icon filename remains available for compatibility. iOS caches
installed icons separately from the website: use a fresh Safari **Add to Home
Screen** installation when checking an updated icon.

## Private Cloud Test installation

The iOS installer can fetch icons without Safari's Test access cookie. Cloud
Test therefore allows unauthenticated GET/HEAD for exactly these branding files:

- `/apple-touch-icon.png`
- `/apple-touch-icon-v2.png`
- `/icon-192.png`
- `/icon-512.png`
- `/site.webmanifest`

All pages, JavaScript, runtime configuration, API routes and the inbox retain the
existing gate. The branding responses issue no access cookie and forward no
credentials. Missing branding must return an error, never the SPA HTML fallback.
The gateway unit tests and hosted branding check cover these boundaries.

## Appearance verification

iPhone Home Screen icon appearance is separate from the website's theme toggle.
Check Home Screen **Edit → Customize**, including its automatic appearance
setting, and switch the device appearance in both directions after installation.
Do not infer installed-icon behavior from desktop `prefers-color-scheme` tests.

Automatic appearance treatment is performed by iOS; a site can receive that
treatment even when it supplies only one PNG. Separate icon variants are not a
prerequisite for system-generated treatment. Record the actual iOS version and
installation method when checking behavior, rather than generalizing a result
from another device or version.
