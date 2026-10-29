# J에게 (To J)

Plan, prepare and follow through. A web-first scheduler with a shared TypeScript core for future iOS and Android apps.

## Current product slice

- Monthly calendar, searchable full list, date and category filtering
- Editable preparation checklists with durable completion state
- Actual background Web Push with individual reminder editing/deletion
- Custom recurrence, acknowledgement, snooze and device-level consent
- Rule-based preparation recommendations
- Kakao place search, saved address/coordinates, expandable maps and directions
- Saved origin and up to five intermediate places; car/transit/walk route geometry and estimates, explicitly approximate stop-order suggestions
- Important-date creation flow
- All-day and multi-day events, optional end time, and configurable all-day alarm base
- User-owned event persistence
- Responsive web layout for desktop and mobile
- Per-occurrence event and preparation completion, server-owned XP and daily goals
- 50-level P → J progression: 12,000 XP, daily cap 60, cumulative practice-day badges

The existing private hosting address and notification protocol identifiers remain unchanged for compatibility. Native apps, public account authentication and offline sync are not implemented yet.

## Product documentation

See [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) for the MVP definition, core flows, data concepts, and launch principles.
See [`docs/TO_J_ARCHITECTURE.md`](docs/TO_J_ARCHITECTURE.md) for progression rules, API boundaries and mobile next steps.
See [`docs/KAKAO_MAPS.md`](docs/KAKAO_MAPS.md) for the JavaScript key, domain setup and map integration tests.
See [`docs/ROUTING.md`](docs/ROUTING.md) for route behavior, REST-key setup, safety limits and tests.
