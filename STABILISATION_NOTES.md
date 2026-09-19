# Local booking stabilisation — progress and decisions

Date: 19 September 2026.
Starting Git revision: `6207d022cc416aff3536d32149e9f522b79b8eed`.
Initial worktree: only the untracked `PROJECT_AUDIT_FOR_CHATGPT.md`; preserved unchanged.

Scope: local demo only. No deployment, migration, dependency installation, AI implementation or WhatsApp API integration.

## Verified baseline

- Existing suite: 69 passed, 0 failed, 0 skipped.
- TypeScript (`--noEmit --incremental false`): passed.
- ESLint: one existing navigation-rule error in `app/booking-wizard.tsx`.
- Phone validation counted separators toward length rather than checking digit count.
- `blockingAssignments` in `app/demo-booking.ts` releases scheduled capacity after stored cleanup time even if the treatment remains in service. `roomSchedule` warns about an overrun but does not change that allocation.
- Receptionists can retrieve historical booking totals, snapshots and operational audit text through `/api/demo/staff/state`. Mutation results also return complete bookings. Today's earnings restrictions alone do not close those paths.

## Focused implementation plan and current status

| Area | Files | Expected behaviour | Status |
|---|---|---|---|
| Phone validation | `app/order.ts`, `app/staff/page.tsx` | Shared digit-based validation for customer UI, staff UI and the existing server validator; preserve local/international formatting. | Implemented |
| Phone regressions | `app/order.test.ts`, `scripts/demo-server.test.ts` | Reject separators/too few digits; test valid formats and both booking endpoints without changing invalid-request state. | Implemented |
| Navigation lint | `app/booking-wizard.tsx` | Preserve native full-page home navigation; narrowly scope the existing local Vinext navigation workaround. | Implemented |
| Overruns | `app/demo-booking.ts`, `scripts/demo-server.ts`, `app/room-schedule.ts`, `app/room-board.tsx`, `app/staff/page.tsx`, regression tests | Consistent conservative blocking, explicit completion and cleaning, manual conflict resolution. | Implemented following approval |
| Historical financial access | `scripts/staff-access.ts`, server response boundaries, shared operational response types, staff consumers, regression tests | Historical operational access without stored monetary fields or financial audit prose; owner finance unchanged. | Implemented following approval |

## Implemented behaviour

The shared phone validator accepts 8–15 digits, optional leading plus, spaces, parentheses and hyphens. A plus-prefixed international number cannot start with country-code digit zero. Other characters, embedded plus signs, separator-only strings, and insufficient/excessive digit counts fail. This checks format, not phone ownership or whether a number is assigned. Existing form/server field-length limits remain unchanged.

Customer booking already uses the shared validator. Staff creation now checks it before submission; both server creation paths already call it through `validateInput`. Pricing, reservation transactions and idempotency are unchanged.

The wizard retains its native home anchor. One justified inline ESLint exception uses the same full-page navigation strategy as existing staff/boss pages, avoiding an unrelated routing change. This is a scoped compatibility exception, not conversion to client-side routing.

## Approved B/C policies and implementation

### B. Overdue treatment resolution

Approved: an overdue `in_service` assignment occupies its therapist and all assigned beds/chairs indefinitely, including after closing and on later dates, until staff explicitly completes the visit. A forgotten completion therefore blocks future allocations, not just today's slots. No automatic cancellation/completion/reassignment policy was added.

`occupancyWindow` calculates absolute Malaysia-time intervals. `blockingAssignments` projects them onto each requested day and is reused by regular availability, final transactional scheduling, staff rescheduling/reassignment, and add-on extensions. Completing a visit records `completedAt`; actual completion plus five minutes determines release. Fractional-minute release is conservatively rounded up for minute-based scheduling. Original scheduled assignments are retained, so finance durations and historical schedule records are not rewritten. Legacy completed records with no completion timestamp retain their existing scheduled-cleanup behavior; no actual finish is invented or backfilled.

`overrunWarnings` identifies unresolved work and affected confirmed/checked-in bookings by shared therapist or resource. It also warns when late-completion cleaning conflicts with an existing appointment. Staff see warnings across workspace tabs; room cards, capacity and timeline occupancy use the same effective intervals. Previous-day unresolved work is labelled and does not inflate the selected day's customer/booking count. Staff must review conflicts manually. Existing bookings are never moved or cancelled automatically. Status remains booking-wide for groups, as before.

### C. Receptionist historical records

Approved: preserve historical appointment operations and treatment names; omit historical stored financial amounts. Historical means appointment date before today's Malaysia date, determined on the server, not by a client query.

`staffBooking` uses an allowlist for historical response fields. Totals, snapshot item/add-on prices, snapshot subtotals and add-on sale prices are absent, not set to zero. Names and operational add-on metadata remain. `staffState` sanitizes audit descriptions because generated add-on audit prose contains amounts. Receipt capabilities are omitted from all receptionist booking responses, including today's, to avoid providing a route to historical financial data later. Projection covers state, creation/idempotent retries and every booking mutation; authenticated receptionist use of customer receipt/public-create responses is projected too. Owner records remain complete; current/future booking money and existing therapist own-today earnings permissions are unchanged.

`StaffBooking`/`StaffState` model omitted prices explicitly. Staff summary cards, booking details, add-on total previews and manually prepared WhatsApp text do not fall back to catalogue prices when `financialsHidden` is set. No WhatsApp API was added.

Operational free-text appointment notes remain visible as requested; they are not a secure place to record financial figures. This restriction covers structured financial fields and system-generated financial audit descriptions, not automatic semantic classification of arbitrary text. Public catalogue prices can still be inferred from treatment names. Already viewed/downloaded information cannot be recalled. Customer-held receipt capabilities keep their existing behavior when used as a customer; previously distributed capabilities are not revoked by this local change.

## Validation after implemented A/D changes

- Full suite: **71 passed, 0 failed, 0 skipped**, including two new regression tests.
- TypeScript: passed, exit 0.
- ESLint: passed, exit 0.
- Local Vinext build: passed, exit 0; emitted its existing static-analysis route-classification notice. Nothing was deployed.
- An initial sandboxed post-change test run could not start loopback test servers (`EPERM`). The complete suite was rerun with local-listener permission and passed; this was an execution-environment failure, not a suppressed assertion failure.
- Tests used in-memory/temporary databases only. No real records were read or modified. No browser interaction or visual testing was performed.

## AI readiness

Phone input handling is more reliable; the existing authoritative booking transaction and idempotency remain intact. Overrun scheduling and role-scoped operational projections now provide a safer base for future tools. Agents must reuse the transactional APIs and authenticated role projections, never write bookings or read finance directly. No chatbot work has started. Production authentication, capability/credential lifecycle, canonical hosted/local source alignment, privacy review of free text, and the other audit gaps remain separate future work.

## B/C change inventory

### Final B/C validation

- Complete existing suite plus regressions: **76 tests, 76 passed, 0 failed, 0 skipped, 0 cancelled** (exit 0).
- TypeScript `--noEmit --incremental false`: passed, exit 0.
- ESLint (excluding generated `dist`/`.next`): passed, exit 0.
- Local Vinext build: passed, exit 0. Existing informational notice remains: static analysis cannot classify `/`, `/staff`, `/boss`; this did not fail the build.
- `git diff --check`: passed.
- Intermediate runs caught two old fixture assumptions (receptionist receipt capability and auto-released seed treatment), plus two new fixture mistakes (an incompatible foot therapist and a seeded occupied slot). These were corrected without weakening the price, finance or concurrency assertions; final results above include all tests.
- API tests used temporary/in-memory databases and loopback listeners. No real booking data or browser interactions were used. No dependencies installed, migrations, push, publication, AI or WhatsApp integration.

### Files

- `app/demo-booking.ts`: optional actual completion metadata, shared occupancy windows/blocking, typed staff projections and client response types.
- `scripts/demo-server.ts`: records actual completion and projects public occupancy; applies receptionist projection to response boundaries without changing reservation transactions or idempotency.
- `scripts/staff-access.ts` (new): pure response-only historical allowlist, receipt capability removal, audit sanitization.
- `app/room-schedule.ts`: effective room/staff occupancy across dates and explicit conflict detection.
- `app/room-board.tsx`: bilingual warning details and effective cleaning/overrun occupancy in cards/timelines.
- `app/staff/page.tsx`: global manual-resolution warnings, consistent occupancy, actual cleaning display and no historical price reconstruction. Existing A phone validation retained.
- `app/room-schedule.test.ts`: mixed-resource/group carry-over, cleaning release and existing-conflict regressions.
- `scripts/demo-server.test.ts`: all-channel overrun blocking, atomic group failure, overnight/manual release, public availability parity, history/receipt/retry/mutation authorization regressions. Existing receipt test now obtains its customer capability through owner access. Existing in-service extras test explicitly completes the earlier sample treatment and includes that completed sample in expected daily earnings.
- `STABILISATION_NOTES.md`: policy, implementation, limitations and validation record.

Existing A/D-only files (`app/order.ts`, `app/order.test.ts`, `app/booking-wizard.tsx`) were not edited again. The untracked audit report was preserved. Starting/current Git revision remains `6207d022cc416aff3536d32149e9f522b79b8eed`; no commit or deployment was made.
