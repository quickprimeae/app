// src/lib/theme.ts
// SINGLE SOURCE OF COLOR TRUTH. Deliveroo light theme. Every component imports
// its palette from here — change a value once and it cascades everywhere.
//
// Brand teal #00CCBC is LIGHT: white text on it FAILS contrast, so text that
// sits on a teal/colored fill uses dark slate (#1B2B2B). Teal is for fills,
// borders, accents and active-state tints; readable teal *text* uses a darker
// teal (tealText). Status colors are tuned to read on their light chips.
//
// Two shapes exist because the components were written against two key sets:
//   T  — the (formerly dark) dashboard components: bg/bgCard/white/dim/teal*…
//   LT — the (already light) onboarding/bulk/import components: surface/ink/…
// Both now resolve to the same Deliveroo light identity.

// Shared Deliveroo values
const TEAL = '#00CCBC'        // brand
const TEAL_HOVER = '#00B3A6'  // darker teal (hover/depth)
const TEAL_TEXT = '#00857B'   // readable teal text/links on white
const TEAL_TINT = '#E6FAF8'   // active-state / faint teal background
const SLATE = '#1B2B2B'       // primary text ("Outer Space")
const SLATE_MID = '#46585A'   // secondary text
const MUTED = '#5E7373'       // muted text (still readable)
const FAINT = '#8A9A9A'       // faint icons / placeholders / disabled
const SURFACE = '#F6F8F8'     // light page surface
const WHITE = '#FFFFFF'
const BORDER = '#E3E8E8'
const BORDER_MID = '#D2DADA'

// Status (readable as text on their light chips AND on white)
const GREEN = '#15803D', GREEN_BG = '#DCFCE7'
const AMBER = '#B45309', AMBER_BG = '#FEF3C7'
const RED = '#DC2626', RED_BG = '#FEE2E2'
const BLUE = '#0E7490', BLUE_BG = '#E0F2FE'
const PURPLE = '#7C3AED', PURPLE_BG = '#EDE9FE'

// ── T: formerly-dark dashboard components (key names are legacy; values are now
//    light). `white` = primary text, `bg` = page background, etc. ─────────────
export const T = {
  bg: SURFACE,
  bgCard: WHITE,
  bgHover: '#EEF3F3',
  bgSubtle: SURFACE,
  border: BORDER,
  borderMid: BORDER_MID,
  tealDark: TEAL_HOVER,
  teal: TEAL,
  tealMid: TEAL,
  tealBright: TEAL_TEXT, // used as accent values/dots AND small text -> keep readable
  tealText: TEAL_TEXT,
  tealFaint: TEAL_TINT,
  green: GREEN, greenBg: GREEN_BG,
  amber: AMBER, amberBg: AMBER_BG,
  red: RED, redBg: RED_BG,
  blue: BLUE, blueBg: BLUE_BG,
  purple: PURPLE, purpleBg: PURPLE_BG,
  white: SLATE,      // PRIMARY TEXT (legacy name)
  whiteMid: SLATE_MID,
  dim: MUTED,
  dimMid: FAINT,
}

// ── LT: already-light onboarding / bulk / import components ──────────────────
export const LT = {
  tealDark: TEAL_TEXT, // used as accent text + (kept-dark) panels
  teal: TEAL,
  tealMid: TEAL,
  tealLight: TEAL_TINT,
  tealBorder: '#9DEEE6',
  tealText: TEAL_TEXT,
  ink: SLATE,
  inkMid: SLATE_MID,
  inkLight: MUTED,
  surface: SURFACE,
  white: WHITE,
  border: BORDER,
  amber: AMBER, amberBg: AMBER_BG, amberLight: AMBER_BG, amberBorder: '#FCD34D',
  red: RED, redBg: RED_BG, redLight: RED_BG, redBorder: '#FCA5A5',
  green: GREEN, greenBg: GREEN_BG,
}

// ── Picker (employee clock-in) page constants ───────────────────────────────
// Semantics match how the page uses them: TEAL = readable teal *text*,
// TEAL_MID = brand *fill* (buttons/dots/rings; pair with slate text),
// TEAL_LIGHT = faint tint background, TEAL_DARK = deep teal for the header
// panel (white text on it) and large numerals.
export const PICKER = {
  TEAL: TEAL_TEXT,      // #00857B — teal text on white/tint
  TEAL_MID: TEAL,       // #00CCBC — brand fill
  TEAL_LIGHT: TEAL_TINT,
  TEAL_DARK: '#00756B', // deep teal — header bg (white text ~6:1) + big clock
}
