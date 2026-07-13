# MLdrift design system

## Product direction

MLdrift uses a light-first enterprise technical style with moderate information density. Blue communicates primary action and cyan is a restrained brand accent. Dark mode is a first-class theme, not a color inversion applied at page level.

## Token layers

Tokens live in `src/app/styles/tokens.css` and follow three layers:

1. Primitive tokens define raw palette values.
2. Semantic tokens describe intent: background, surface, foreground, muted, primary, success, warning, danger, border, input, and focus ring.
3. Component tokens define control heights, radii, shadows, and motion duration.

New page and feature code should use Tailwind semantic utilities such as `bg-surface`, `text-foreground`, and `border-border`, or the corresponding CSS variable when an arbitrary value is required. Do not introduce new hexadecimal color values in a page.

Core palette:

| Intent | Light value |
| --- | --- |
| Primary | `#2563EB` |
| Primary hover | `#1D4ED8` |
| Brand accent | `#06B6D4` |
| Background | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Foreground | `#0F172A` |
| Success | `#16A34A` |
| Warning | `#D97706` |
| Danger | `#DC2626` |

## Typography, spacing, and motion

- Inter is self-hosted with `@fontsource/inter`.
- Spacing follows a 4 px grid.
- Standard radii are 8 px and 12 px; large overlays may use 16 px.
- Interaction transitions are 150–200 ms.
- Global styles honor `prefers-reduced-motion`.

## Shared primitives

Use components in `src/shared/ui` for:

- buttons and icon buttons
- inputs and text areas
- cards, badges, skeletons, empty/error states
- dialogs, confirmation dialogs, toast notifications, and tooltips
- data tables
- lazy code editing and runtime-log viewing

Domain components may combine primitives, but should not clone their interaction behavior. Every primitive must cover default, hover, focus-visible, active, loading, disabled, and error states where applicable.

## Application shell

Navigation follows the model lifecycle:

1. Overview
2. Build & Deploy
3. Training
4. Registry
5. Monitoring

Notifications and Settings form the secondary group. The header contains page context, model selection, create action, theme, notifications, and profile access.

Responsive behavior:

- 1280 px and wider: 256 px sidebar, collapsible to a 72 px rail.
- 768–1279 px: 72 px icon rail.
- Below 768 px: drawer navigation with essential status and actions preserved.

## Page anatomy

A standard page uses:

1. Breadcrumb or clear lifecycle context
2. Title and short description
3. One primary action
4. Summary/status content
5. Task-oriented sections
6. Contextual actions near the data they affect

Use skeletons for initial loading. Empty states explain why no data exists and offer the next useful action. Recoverable API errors include retry or corrective guidance.

## Accessibility

- Keyboard order follows visual order.
- Focus indicators remain visible on every interactive element.
- Icon-only buttons have an accessible label and usually a tooltip.
- Status includes text or an icon and never relies on color alone.
- Dialog focus is trapped by Radix primitives and returns to the trigger when closed.
- Validate layouts at 200% zoom and common responsive breakpoints.
- Maintain WCAG AA contrast in light and dark themes.

## Theme and copy

`ThemeProvider` supports `light`, `dark`, and `system`, persists the preference, and tracks operating-system changes while in system mode.

The current product language is English. Copy is separated into `common`, `auth`, `catalog`, `buildDeploy`, `training`, `registry`, `drift`, and `settings` namespaces so localization can be added without another component migration.
