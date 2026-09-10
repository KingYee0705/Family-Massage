# Family Massage — local booking demo

This workspace contains a local-only scheduling prototype. It uses sample therapists, illustrated demo portraits, and test appointments. It is not connected to the public website and must not be used for real customer data yet.

## Start the demo on macOS

1. Double-click `scripts/start-demo.command` in Finder.
2. Keep the Terminal window open while testing.
3. Open the customer demo at <http://127.0.0.1:3000>.
4. Open the staff dashboard at <http://127.0.0.1:3000/staff>.
5. Open the boss dashboard at <http://127.0.0.1:3000/boss> and use the owner account below.

If Node.js is available in Terminal, `npm run demo` starts the same two local services. Closing the Terminal window stops the local website; GitHub does not run this demo.

## Demo staff accounts

- Owner: `owner@serene.demo`
- Receptionist: `receptionist@serene.demo`
- Sample therapists: `s01@serene.demo` through `s06@serene.demo`
- Password for every demo account: `SereneDemo!`

The owner can edit sample therapist profiles and skills. The receptionist can manage bookings, shifts, and leave. The front desk can see every therapist's current-day earnings breakdown; each therapist account sees only its own completed work and earnings for today. Past earnings are not available in this workspace. Use **Reset demo** from the owner dashboard to restore the original sample data.

The staff earnings tab shows the combined listed value of completed treatments only. The separate boss dashboard shows monthly commissions and deductions. Receptionist and therapist accounts cannot access its financial endpoints.

For extras bought at the counter or during treatment, open the booking in the staff dashboard and use **Add extras** under the relevant guest. Select the extras and sale location, then save. The bill updates immediately; completed-treatment earnings include these sales once. The system preserves the assigned therapist and bed/chair, checks any extra treatment and cleaning time against existing bookings, and records who entered the sale. An extra already selected or included in a package cannot be charged again. Finish recording extras before marking the visit completed.

The boss dashboard calculates 50% of each therapist's full treatment and add-on sales total, then subtracts that therapist's room rental and electricity deductions. The notebook's red amounts represent full extra sales, not an additional commission payment. Commission is rounded to the nearest sen once per therapist per month. Shop share is sales minus commission before operating expenses; it is not net profit. A negative therapist balance is shown explicitly without assuming a debt or carry-forward policy.

## Boss monthly statements

- Browse current or previous months, select a therapist, and expand a day to see the completed visits. Booking extras and later counter/service extras are separated and included exactly once.
- Rental and electricity start with clearly labelled sample values for each therapist. Edit a month's amounts and optionally use them as defaults going forward. Earlier months retain their prior effective settings.
- Current-month figures update as demo bookings are completed. Use **Print** for a draft at any time, or save the final statement after the month ends.
- Saved statements freeze their sales, deductions, names and totals. Reopening requires a correction reason, keeps the earlier saved version, and records the change in the boss-only history. Saving or printing a statement does not send money.
- The local SQLite database keeps finance data in a separate table. **Reset demo** restores sample appointments but does not erase saved financial statements or deduction settings.

## Suggested test journey

1. Select a treatment for one guest.
2. Submit a simple one-person booking; it confirms immediately when capacity is available.
3. Select a specific available therapist; it also confirms immediately.
4. Add a group booking; the whole group confirms together when every required therapist and resource is available.
5. Open the staff dashboard and find the confirmed booking.
6. Add overlapping two-hour appointments to see later start times become unavailable.
7. Add Thai balm at the counter, or an eligible timed extra during service, using **Add extras** under a guest. Verify the bill and timeline update together.
8. Complete a treatment, then open **Today’s earnings** to see the combined completed-service value, including the later extras.
9. Sign in at **Boss dashboard** as the owner. Check that the same completed visit appears in that therapist's monthly ledger and contributes 50% of its value to commission before deductions.

The local SQLite file is stored under `.demo-data/` and is ignored by Git. No payment is collected and no WhatsApp message is sent automatically.

## Before production

Replace all sample therapist details and portraits, confirm their treatment capabilities and shifts, choose production hosting and a managed database, secure real staff accounts, define data retention and privacy policies, and connect payments or the official WhatsApp API only after approval.
