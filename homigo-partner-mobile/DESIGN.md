# Partner app — design and build rules

Read this before touching a screen.

## Who it is for

A professional on a job: outdoors, one hand free, in a hurry, often on a mid-range Android phone in
sunlight, reading English as a second language. The app's job is to say what to do next, show what
is owed, and never surprise them.

## The system (use it; do not restyle it)

- Tokens: `src/theme/tokens.ts` — `color`, `space` (4-pt grid), `radius` (control 12 / card 18 /
  sheet 28 / pill), `touch.min` 48, `type` (display 30, title 22, heading 17, body 15, small 13,
  caption 12), `tabular`, `elevation.card` / `.float`, `tone` (neutral, leaf, success, warning,
  danger, info).
- Building blocks: `src/components/ui` — `T` (all text), `Button` (primary / secondary / quiet /
  danger; `loading`, `hint`), `Card`, `Section`, `Pill`, `Banner`, `ListRow`, `KeyValue`, `Field`,
  `Skeleton`, `SkeletonCard`, `EmptyState`, `Sheet`, `StageRail`, `formatRupees`.
- Frame: `PartnerScreen` — title, optional back, `headerAction`, pull-to-refresh
  (`refreshing` / `onRefresh`), and a docked `footer` for the screen's primary action.
- Legacy helpers in `HqUi.tsx` (`HqCard`, `StatRow`, `LoadingBlock`, `ErrorBlock` with `onRetry`, …)
  are already on the tokens; prefer the `ui` kit in new code.
- No hard-coded colours, font sizes, radii or spacing in a screen. No new dependencies.

## Look

- Paper background, white cards, one deep leaf green that always means "your next step".
  Marigold is for money and for things that need attention; red only for errors and destructive
  actions.
- One primary button per screen, docked at the bottom where the thumb is. Everything else is
  secondary or quiet.
- Radius follows hierarchy (controls tighter than cards, sheets softest). Two elevations only.
- Money, times and counts use `numeric` (tabular figures) and are right-aligned in rows.
- Sentence case everywhere. No all-caps labels, no decorative eyebrows, no "→" in buttons, no
  emoji as icons (icons are `lucide-react-native`).
- Motion only answers an action (a sheet rising, a state changing). Respect reduced motion.

## Words

- Plain verbs, sentence case, the partner's vocabulary ("job", "customer", "earning").
- A button says what happens ("Mark arrived", "Add door photo", "Report customer not available")
  and keeps that name through the flow.
- Errors say what happened and what to do. Where the server wrote the sentence, show the server's
  sentence, unchanged.
- Empty states say what will appear here and the one thing to do about it.

## Truth (non-negotiable)

- The backend is the truth. Never invent, estimate or default a number, a rating, a status, a
  label or a policy on the device. A value the server did not send is not shown ("—" at most).
- A feature the server does not have is not offered. Say "Coming soon" only for something that is
  genuinely planned and visibly inert; otherwise leave it out.
- Types in `src/types/partner.ts` mirror the backend; they do not import it. Check a field against
  the backend code before relying on it.
- The partner is never shown the customer's refund or anything the privacy projection withholds.
  `amount` / `finalAmount` on a booking are the customer's price, not the partner's earning.

## Every data screen has

- Loading with the shape of the content (`Skeleton`), an empty state, an error state with the
  server's sentence and "Try again", pull-to-refresh, and it never reads `query.data!` unguarded.
- A network failure (`isNetworkError`) is told apart from a refusal: "You're offline. Check your
  connection and try again."

## Accessibility

- Every pressable: `accessibilityRole`, a label that names the action, `accessibilityState` when
  busy or disabled, and at least 48 pt of height.
- Every input has a visible label. Errors are announced (`accessibilityRole="alert"`).
- Headings use `accessibilityRole="header"`. Text scales with the system font size; nothing clips
  at 320 pt width.

## Tests that read the screen

- The device scripts in `e2e/native-android-*.ts` find things by visible words and `testID`s.
  Before renaming a visible string or removing a `testID`, grep `e2e/` for it and keep it.
- Pure logic lives in `src/lib/*` with tests in `src/lib/__tests__` (`npm run test:unit`); it must
  not import React Native.
