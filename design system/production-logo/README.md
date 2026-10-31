# Barber++ production logo assets

Approved direction: option 2, selected 31 October 2026. The editable SVG masters
faithfully reconstruct the selected two-part B as flat artwork. The upper half is
amber (#D4A853); the lower half and lettering are charcoal (#151A20) on light
surfaces, white on dark surfaces. Both plus apertures and the waist gap are true
transparent cutouts. There is no fold or corner tab.

## Files

`barber-{horizontal,stacked,symbol,wordmark}-{light,dark,mono-dark,mono-white}`
are supplied as SVG and transparent PNG. `compact-header` uses the horizontal
master at a responsive size. Monochrome means `mono-dark` or `mono-white`.
PNGs are 1600 px wide; SVGs scale without loss. App-icon masters have a square,
opaque background and are 1024×1024. Let the target platform apply its own mask.

The favicon SVG adapts to the browser's light/dark preference. PNG fallbacks are
16, 32 and 48 px. Apple touch icon is 180 px; web app icons are 192 and 512 px.
The app-icon artwork has enough safe padding for a maskable manifest icon.

The wordmark is outlined from Outfit Bold (weight 700), using the official
Google Fonts source. No installed font or external request is needed to render
the logo. [OFL-Outfit.txt](OFL-Outfit.txt) includes its license. Source:
https://github.com/google/fonts/tree/main/ofl/outfit

## Use

- Use light artwork on light surfaces, dark artwork on charcoal/dark surfaces.
- Preserve the logo's LTR orientation in Arabic; never mirror the B or wordmark.
- Keep clear space of at least one plus-arm thickness around the symbol.
- Use `BrandLogo` in the application rather than separate text or a scissors icon.
- Booking/account headers explicitly use light artwork because their surface is
  light independently of the staff/marketing theme.
- Use symbol-only artwork for small icons. Never squeeze an entire lockup into a favicon.

Runtime copies are in `public/brand/`, with browser icons in `public/`. These
SVG masters are the source of truth; presentation boards are visual references.
The `Barber++-production-logo-assets.zip` archive contains this export package.

Validation includes transparent-pixel checks for all four symbol treatments,
required project checks, and hosted theme/locale/responsive browser checks.
