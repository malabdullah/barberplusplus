# Barber++ logo lockup

Owner-approved rule, 8 November 2026: when the mark and lettering appear together,
the B-shaped mark is the initial **B**, followed by **arber++**. Never compose a
separate mark followed by the full **Barber++** wordmark. Standalone brand text
still reads **Barber++**; standalone symbols, favicons and app icons are unchanged.

Use the shared `BrandLogo` component. The horizontal light/dark SVGs in
`public/brand/` use the same outlined artwork as the native iOS canonical assets.
The 506.2794 × 104 master keeps the original mark and Outfit Bold letter outlines,
with an 8-unit optical gap between the mark and the first a. Monochrome exports
use identical geometry. Scale the complete artwork proportionally.

Keep the combined lockup left-to-right and isolated in Arabic. Announce it once
as “Barber++”, or use the enclosing link’s localized “Barber++ home” label with
decorative artwork. Never expose “arber++” as the accessible brand name.

Small public headers retain the existing symbol-only responsive variant. Full
headers, footers, authentication panels, sidebars, preview panels and static
verification pages use the same updated horizontal masters and follow the theme.
Standalone wordmark assets retain the initial text B because they have no mark.

The old mark-above-full-wordmark arrangement is retired. Legacy
`barber-stacked-*.svg` URLs now alias the canonical inline artwork to avoid
reintroducing the duplicated B. New design-system examples must use this rule.
Historical presentation boards are reference history, not canonical exports.

No database, authentication, app-icon, email-delivery or production configuration
changes are required for this visual update.
