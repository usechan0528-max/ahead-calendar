# To J — Forest & Paper

The user-supplied `j-scheduler-ui.html` is a visual reference, not application code or a source of production data. The studio wrapper, mock phone frames, embedded font, sample dates, fake notification actions and in-memory storage are not imported.

## Direction

- Primary forest `#294e3e`, paper `#fbfcf8`, sage `#e8eee0`, ink `#25342e`.
- Category identity is shared through `lib/design-tokens.ts`: anniversary ochre, event slate, travel green, general schedule lavender. Always pair color with a label.
- Korean system fonts; headings 24–28 px, main reading text 16 px, controls/labels 14 px, secondary metadata 12–13 px. The reference artboard's miniature fonts are not production sizes.
- Spacing follows 4/8/12/16/24/32 px; controls use 8 px corners, surfaces 12–16 px. Gold keyboard focus; touch controls are enlarged on mobile.

## Working surfaces

Desktop: persistent left navigation, calendar/overview center, scrollable event detail on the right. At widths under 1200 px, event selection opens a distinct detail screen with a return action. Under 768 px, four bottom destinations replace the sidebar: Today, Calendar, Preparations, Notifications.

- Calendar retains monthly/list views, category filtering, search, date selection and recurring/multi-day occurrences. A preparation prompt and upcoming cards only appear when a current/future occurrence exists.
- Today is the default entry and logo destination. It shows the next incomplete action, today's remaining schedules, opted-in saved preparations, completed schedules and growth. Empty accounts get first-plan entry with an optional sample-calendar link. Sidebar growth is a compact entry point, not a separate progression system.
- Preparations groups existing preparation items by event and opens the correct occurrence for completion/editing. Timing text remains a memo, not an inferred deadline or push notification.
- Notifications summarizes saved reminder offsets; counts do not claim actual delivery. Device consent, reservation status, presets, custom offsets and receipt history remain in real event settings.
- Event detail keeps preparation and reminder tabs, recommendation controls, map/journey tools and occurrence completion. Completion follows preparation rather than dominating the header.

## Preserved invariants

The September 20 journey update uses the existing forest/paper tokens and a light green action surface. Optional editor sections remain mounted when collapsed. New schedules start with an empty checklist; recommendations are explicitly adopted. A post-save card separates saved reminder times from device consent and links to existing controls. See `USER_FLOW.md` for scope and compatibility rules.

No database migration, API identity/auth change, deployment-audience change, notification consent change or growth-rule change. Real Kakao lookup/routing, all recurrence options, all-day/end-time fields, per-occurrence completion and server persistence remain connected. Original favicon and social preview are preserved.

## Validation

Growth uses a deep forest cover, gold earned-title markers and a collapsible 10-chapter collection. Fifty unique level names derive from the original XP curve; cumulative practice-day badges use server records. Reward notices are non-modal, below editors, and respect reduced motion. See `LEVEL_DESIGN.md`.

TypeScript/build and existing calendar, duration and progression checks are required after this presentation refactor. Browser checks cover desktop calendar, responsive bottom navigation, preparation/notification detail entry, input dialog, weekly recurrence controls and no document-level horizontal overflow at a narrow mobile viewport. UI checks do not send push notifications, alter consent or complete/delete existing events.
