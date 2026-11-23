# AURA Drive — Design System Specification (`DESIGN.md`)

> **Aesthetic Direction:** Linear / Vercel-inspired high-craft dark mode.
> **Core Principle:** Quiet technical instrumentation — crisp off-white typography over layered obsidian/zinc surfaces, 1px hairline borders, tight negative tracking, disciplined tabular metrics, and generous whitespace.

---

## 1. Color Tokens

All UI components MUST consume CSS custom properties defined in `The-Hyper-Optimism/src/globals.css`. Do NOT introduce arbitrary hex/rgba literals in component styles.

| Role | Token | Hex / Value | HSL | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas Background** | `--background` | `#09090B` | `hsl(240 10% 3.9%)` | Root viewport, full-screen study backdrop, dashboard shell |
| **Primary Surface** | `--card` | `#111114` | `hsl(240 8% 7%)` | Cards, study containers, calibration panels, tables |
| **Elevated Surface** | `--popover` / `--surface-elevated` | `#18181B` | `hsl(240 6% 10%)` | Modals, inputs, hover surfaces, active rows, floating HUD docks |
| **Secondary Surface** | `--secondary` | `#1F1F23` | `hsl(240 5% 13%)` | Secondary buttons, segmented tracks, keyboard keycaps |
| **Hairline Border** | `--border` | `rgba(255, 255, 255, 0.08)` | — | All card, panel, divider, and table rules (`1px solid`) |
| **Strong / Hover Border** | `--border-strong` | `rgba(255, 255, 255, 0.14)` | — | Focused inputs, hovered interactive surfaces, active tabs |
| **Primary Text** | `--foreground` | `#FAFAFA` | `hsl(0 0% 98%)` | Headings, primary labels, numeric readouts |
| **Muted Text** | `--muted-foreground` | `#A1A1AA` | `hsl(240 5% 65%)` | Body copy, descriptions, secondary labels |
| **Tertiary Text** | `--text-tertiary` | `#71717A` | `hsl(240 4% 46%)` | Axis ticks, timestamps, subtle keyboard hints |
| **Primary CTA Surface** | `--primary` / `--primary-foreground` | `#FAFAFA` / `#09090B` | `hsl(0 0% 98%)` / `hsl(240 10% 3.9%)` | Single primary action button per viewport |
| **Restrained Accent** | `--brand-accent` | `#38BDF8` | `hsl(199 89% 60%)` | Active selection markers, focus rings, spatial audio highlight |
| **Accent Tint / Border** | `--brand-tint` / `--brand-border` | `rgba(56, 189, 248, 0.12)` / `rgba(56, 189, 248, 0.28)` | — | Subtle focus backing & active spatial indicator border |

### Semantic Status Tokens (Strictly Functional, Never Decorative)
| Status | Token | Hex | HSL | Permitted Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Success / Verified** | `--status-success` | `#34D399` | `hsl(160 64% 52%)` | Calibration check passed, face locked, gaze verified, AWS synced |
| **Warning / Attention** | `--status-warning` | `#FBBF24` | `hsl(43 96% 56%)` | Low FPS warning, local-only fallback, active response window prompt |
| **Destructive / Fault** | `--status-danger` | `#F87171` | `hsl(0 91% 71%)` | Permission denied, sync error, collision impact, validation error |

---

## 2. Typography

### Font Pairing
- **Display & Headings (`--font-heading`):** `'Geist', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
- **Body & UI Copy (`--font-sans`):** `'Inter', 'Geist', -apple-system, BlinkMacSystemFont, sans-serif`
- **Metrics, Telemetry & Keycaps (`--font-mono`):** `'Geist Mono', ui-monospace, SFMono-Regular, monospace` (`font-variant-numeric: tabular-nums`)

### Strict Type Scale
| Role | Token / Class | Size | Line Height | Letter Spacing | Weight |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display / H1** | `text-2xl` / `text-[2rem]` | `24px–32px` | `1.15` | `-0.03em` | `600` |
| **Section Title / H2** | `text-xl` (`20px–22px`) | `20px–22px` | `1.25` | `-0.025em` | `600` |
| **Card / Group Title / H3** | `text-base` | `16px` | `1.35` | `-0.015em` | `500`–`600` |
| **Body Copy** | `text-sm` | `14px` | `1.60` | `-0.01em` | `400` |
| **Caption / Helper** | `text-[13px]` | `13px` | `1.50` | `0em` | `400` |
| **Micro / Eyebrow Label** | `font-mono text-[11px] uppercase` | `11px` | `1.20` | `+0.08em` | `500` |
| **KPI / Telemetry Readout** | `font-mono tabular-nums text-2xl` | `24px–28px` | `1.10` | `-0.02em` | `600` |

---

## 3. Spacing, Radii & Layout System

### 8px Spatial Grid
- Base unit: `8px` (`4px` micro-gaps permitted inside compact controls/badges).
- Allowed spacing scale: `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`, `96px`, `128px`.
- **Page & Section Rhythm:**
  - Full-page / analytics sections: `py-24` (`96px`) to `py-32` (`128px`) vertical breathing room.
  - Primary page container: `max-w-6xl` (`1152px`), centered (`mx-auto px-6`).
  - Calibration / Survey containers: `max-w-3xl` (`768px`), centered.
  - Focused transition / confirmation briefings: `max-w-xl` (`576px`), centered.
  - Card & modal internal padding: `24px` (`p-6`) minimum, `32px` (`p-8`) for primary stages; grid gaps `16px` (`gap-4`) or `24px` (`gap-6`).

### Asymmetric Bento & Grid Rules
- Prefer asymmetric splits (`grid-cols-1 lg:grid-cols-12` with `lg:col-span-7` + `lg:col-span-5`, or `8/4`) over uniform 3-column rows.
- Every section must prioritize scannable visual hierarchy with at least 30% open negative space around headers and primary actions.

### Strict Border Radii
| Element | Token | Radius |
| :--- | :--- | :--- |
| Buttons, Inputs, Badges, Keycaps | `--radius-sm` | `6px` (`rounded-md`) |
| Cards, Panels, Telemetry Tiles | `--radius` | `10px` (`rounded-[10px]`) |
| Dialogs, Modals, Full Overlays | `--radius-lg` | `14px` (`rounded-[14px]`) |
| Status Dots & Live Telemetry Pills ONLY | `rounded-full` | `9999px` |

---

## 4. Motion Rules (`framer-motion`)

- **Duration:** `0.2s–0.4s` (`200ms–400ms`) for all state, modal, and layout transitions.
- **Physics & Curves:**
  - Interactive springs: `{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }` (critically damped, zero overshoot/bounce).
  - Deceleration curve: `[0.16, 1, 0.3, 1]` (quintic ease-out).
- **Allowed Transitions:** Subtle opacity fade (`0 → 1`) paired with small `4px–8px` translate or `0.98 → 1` scale on mount/step change, plus shared-element `layoutId` tab indicators.
- **Accessibility:** Respect `prefers-reduced-motion: reduce` (skip translational animations).

---

## 5. Strict Anti-Patterns (NEVER DO)

1. **NO AI/SaaS Gradients:** Never use purple/blue/pink gradients, rainbow borders, or gradient button fills.
2. **NO Heavy Drop Shadows or Neon Glows:** Never put `box-shadow: 0 0 25px ...` or large blurred glow halos on dark cards. Use `1px solid var(--border)` and a single step of surface elevation (`#09090B` -> `#111114` -> `#18181B`).
3. **NO Generic 3-Column Icon-Box Grids:** Never create cookie-cutter 3-column marketing/feature cards with centered icon boxes and filler copy.
4. **NO Cluttered Navbars or Competing CTAs:** Never place more than one primary high-contrast CTA (`variant="default"`) in a single viewport. Secondary actions must use `outline` or `ghost`.
5. **NO Emoji UI Icons:** Never use Unicode emojis (`🎮`, `⚡`, `📡`, `🔊`, `💥`, `⚠`, `✓`) as UI chrome; use `lucide-react` icons sized `14px–16px` (`strokeWidth={1.75}`).
6. **NO Ad-Hoc Tokens:** Never invent unapproved colors, font sizes, spacing increments, or border radii outside this specification.
