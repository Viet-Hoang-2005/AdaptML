# MLdrift design system

## Product direction

MLdrift preserves the original product's restrained black-and-white visual language in light mode: white surfaces, gray borders, compact page chrome, and black primary actions. Dark mode is a first-class theme with slate surfaces and blue primary actions, not a page-level color inversion. Cyan remains a restrained brand accent in the MLdrift identity.

## Token layers

Tokens live in `src/app/styles/tokens.css` and follow three layers:

1. Primitive tokens define raw palette values.
2. Semantic tokens describe intent: background, surface, foreground, muted, primary, success, warning, danger, border, input, and focus ring.
3. Component tokens define control heights, radii, shadows, auth glass, and motion duration.

Feature code must use semantic utilities such as `bg-surface`, `text-foreground`, and `border-border`. Fixed dark palettes are reserved for terminals, code samples, syntax highlighting, crop canvases, and modal overlays.

| Intent | Light | Dark |
| --- | --- | --- |
| Primary | `#000000` | `#60A5FA` |
| Primary hover | `#374151` | `#93C5FD` |
| Brand accent | `#06B6D4` | `#22D3EE` |
| Background | `#F9FAFB` | `#020617` |
| Surface | `#FFFFFF` | `#0F172A` |
| Foreground | `#111827` | `#F8FAFC` |
| Border | `#D1D5DB` | `#334155` |

## Typography and components

- Inter is self-hosted with `@fontsource/inter`.
- Spacing follows a 4 px grid; interaction transitions use 150–200 ms.
- Buttons use 32/40/48 px heights and 12/16 px radii.
- Form inputs default to 56 px height and 16 px radius.
- Page surfaces use an 8 px radius, a visible neutral border, and no decorative card shadow.
- The auth card uses the original translucent white glass in light mode and a near-opaque semantic surface in dark mode.
- Shared interactions use Tailwind, Radix primitives, CVA, and TanStack Table. Ant Design is forbidden.

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

## Localization

English resources are owned by `common`, `auth`, `catalog`, `buildDeploy`, `training`, `registry`, `drift`, `settings`, and `notifications` namespaces. User-visible copy, validation, toast, dialog, tooltip, and accessibility labels belong in those resources. Raw backend error detail remains unchanged. No language selector is exposed until a second locale is available.
