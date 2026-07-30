# MLdrift design system

## Product direction

MLdrift preserves the original product's restrained black-and-white visual language in light mode: white surfaces, gray borders, compact page chrome, and black primary actions. Dark mode is a first-class theme with slate surfaces and blue primary actions, not a page-level color inversion. Cyan remains a restrained brand accent in the MLdrift identity.

## Token layers

Tokens live in `src/app/styles/tokens.css` and follow three layers:

1. Primitive tokens define raw palette values.
2. Semantic tokens describe intent: background, surface, foreground, muted, primary, success, warning, danger, border, input, and focus ring.
3. Component tokens define control heights, semantic radii, shadows, auth glass, and motion duration.

Feature code must use semantic utilities such as `bg-surface`, `text-foreground`, and `border-border`. Fixed dark palettes are reserved for terminals, code samples, syntax highlighting, crop canvases, and modal overlays.

| Intent | Light | Dark |
| --- | --- | --- |
| Primary | `#111827` | `#60A5FA` |
| Primary hover | `#1F2937` | `#93C5FD` |
| Primary active | `#030712` | `#3B82F6` |
| Brand accent | `#0891B2` | `#22D3EE` |
| Background | `#F9FAFB` | `#020617` |
| Surface | `#FFFFFF` | `#0F172A` |
| Surface hover | `#F3F4F6` | `#1E293B` |
| Surface active | `#E5E7EB` | `#334155` |
| Foreground | `#111827` | `#F8FAFC` |
| Border | `#D1D5DB` | `#334155` |
| Focus ring | `#2563EB` | `#60A5FA` |

Status colors expose `default`, `hover`, `active`, `foreground`, `subtle`, and
`border` tokens. API status values must be mapped to the shared
`SemanticTone` union (`neutral`, `info`, `success`, `warning`, or `danger`);
components must not select palette values themselves.

Charts use the stable `chart-1` through `chart-6` order: blue, cyan, violet,
green, amber, and rose. Do not change series order between themes. Technical
consoles use the fixed `terminal-*` and `syntax-*` component tokens in both
themes so runtime output remains legible and predictable.

## Typography and components

- Inter is self-hosted with `@fontsource/inter`.
- Spacing follows a 4 px grid; interaction transitions use 150–200 ms.
- Buttons use 32/40/48 px heights and the 12 px `control` radius.
- Form inputs default to 56 px height and the 12 px `control` radius.
- Page surfaces use the 8 px `surface` radius, a visible neutral border, and no decorative card shadow.
- The auth card uses the original translucent white glass in light mode and a near-opaque semantic surface in dark mode.
- Shared interactions use Tailwind, Radix primitives, CVA, and TanStack Table. Ant Design is forbidden.

## Radius roles

Geometry is theme-independent and uses semantic component tokens instead of
Tailwind size names:

| Role | Size | Usage |
| --- | ---: | --- |
| `compact` | 4 px | Menu items, tree rows, code labels, and small inline controls |
| `surface` | 8 px | Cards, tables, terminals, dropdown shells, dropzones, and icon buttons |
| `control` | 12 px | Buttons, inputs, selects, textareas, switches, tabs, and pickers |
| `overlay` | 16 px | Modals, dialogs, drawers, and the Auth card |
| `full` | Pill/circle | Avatars, badges, status dots, progress tracks, and spinners |

Use only `rounded-compact`, `rounded-surface`, `rounded-control`,
`rounded-overlay`, `rounded-full`, `rounded-none`, and the corresponding
directional semantic variants. Do not override the radius of a shared primitive
from feature code. A genuine graphical exception requires a nearby
`radius-ignore: <specific reason>` comment. `pnpm lint` runs
`scripts/check-radii.mjs` to enforce this contract.

## Application shell

Navigation keeps the original product vocabulary and grouping:

1. Home
2. Drift Monitoring
3. Model Training
4. Model Evolution
5. Management

Notification and Setting form the secondary group. The header keeps the original logo-left, model-selector-center, actions-right composition while retaining searchable model selection, the real theme menu, notifications, and profile access.

- 1280 px and wider: 224 px sidebar, collapsible to a 68 px rail.
- 768–1279 px: 68 px icon rail.
- Below 768 px: drawer navigation with essential actions preserved.

## Accessibility and theme

- Keyboard order follows visual order and every interactive element keeps a visible focus indicator.
- Status includes text or an icon and never relies on color alone.
- Dialog focus is managed by Radix and returns to the trigger.
- Layouts must work at 200% zoom and meet WCAG AA contrast in light and dark themes.
- Global styles honor `prefers-reduced-motion`.
- `ThemeProvider` supports `light`, `dark`, and `system`, persists the preference, and tracks operating-system changes.

## Color authoring rules

- Add raw values only to `src/app/styles/tokens.css`.
- Define separate light and dark semantic values; never use `dark:` color
  utilities to invert a component.
- Feature and shared UI use semantic utilities such as `bg-surface-hover`,
  `text-foreground-subtle`, `border-border-strong`, `bg-success-subtle`,
  `text-info`, `stroke-chart-1`, and `bg-terminal`.
- Form controls keep their surface color and use the blue `input-hover` border;
  focus remains distinct through the stronger `ring` treatment.
- Avoid direct Tailwind palettes, hexadecimal colors, and `rgb()`/`hsl()` in
  application code.
- Approved technical exceptions require a nearby
  `color-ignore: <specific reason>` comment; broad exemptions are forbidden.
- `pnpm lint` runs `scripts/check-colors.mjs` to enforce these rules.

## Localization

English resources are owned by `common`, `auth`, `catalog`, `deploy`, `training`, `registry`, `drift`, `settings`, and `notifications` namespaces. User-visible copy, validation, toast, dialog, tooltip, and accessibility labels belong in those resources. Raw backend error detail remains unchanged. No language selector is exposed until a second locale is available.
