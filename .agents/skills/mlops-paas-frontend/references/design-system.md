# Design system

- `web/src/app/styles/tokens.css` is the only frontend color source and follows
  `primitive palette → semantic token → component token`.
- Tailwind CSS v4 exposes those values as semantic utilities.
- Light mode follows the monochrome legacy design; dark mode uses slate surfaces and blue primary actions.
- Light and dark values are authored independently. Do not use `dark:` color
  utilities to invert component colors.
- Use semantic tokens instead of hard-coded palettes, hexadecimal values, or
  functional colors.
- Shared primitives use Radix for accessible behavior and CVA for variants.
- Use TanStack Table through the shared DataTable for structured lists.

## UI rules

- Preserve visible focus, keyboard navigation, labels, and meaningful `aria-*`.
- Status must include text/icon, never color alone.
- Map API statuses to the shared `SemanticTone` values: `neutral`, `info`,
  `success`, `warning`, and `danger`.
- Provide loading, disabled, error, empty, hover, and focus-visible states.
- Form controls keep their surface color and use the dedicated blue
  `input-hover` border. Keep hover visually distinct from the stronger focus
  `ring`, including in dark mode.
- Respect `prefers-reduced-motion`.
- Test light, dark, and system themes.
- Desktop uses the full sidebar, tablet an icon rail, and mobile a drawer.
- Keep technical consoles and syntax palettes intentionally dark and readable.
- Keep chart series ordered through `chart-1` to `chart-6`; use
  `terminal-*`/`syntax-*` component tokens for technical output.
- `pnpm lint` runs `scripts/check-colors.mjs`. A genuine technical exception
  needs a narrow `color-ignore: reason` comment.

Before introducing a new primitive, inspect `shared/components` and extend the
existing API where appropriate. When adding a color, define its primitive and
both theme semantics before consuming it.
