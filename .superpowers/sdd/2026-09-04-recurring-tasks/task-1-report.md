# Task 1 Report

## Status
- DONE

## Files Changed
- `src/domain/recurrence/calculate.ts`
- `src/domain/recurrence/materialize.ts`
- `tests/recurrence-calculate.test.ts`
- `tests/recurrence-materialize.test.ts`

## Decisions
- Implemented recurrence math as pure TypeScript with explicit timezone handling through `Intl.DateTimeFormat`.
- Kept cadence generation calendar-based instead of millisecond-day arithmetic.
- Supported daily, weekly, monthly, and yearly cadence with month-end clamping.
- Enforced `OCCURRENCE_HORIZON_DAYS = 90` and `MAX_PENDING_OCCURRENCES = 50`.
- Used deterministic occurrence IDs in the form `occurrence:${seriesId}:${ordinal}`.
- Preserved completed history and avoided duplicate creation on repeated materialization runs.

## Tests
- `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts`

## Output
- 7 tests passed, 0 failed.

## Concerns
- The timezone conversion helpers rely on the runtime `Intl` implementation for IANA timezone support.
- The materialization loop searches up to a bounded step count to preserve the 90-day window and cap behavior; if future cadence shapes expand, this search bound may need review.

## Fix Review
- Corrected fixed materialization to derive the 90-day calendar horizon from `now` in the series timezone.
- Removed the materialization horizon from pure next-occurrence calculations.
- Added a separate after-completion materializer that creates only the initial occurrence or one successor after a completed occurrence.
- Added coverage for Jan 31 -> Feb 28, DST crossover, end-on/end-after, now-relative horizon, history preservation, and idempotency.

## Fix Verification
- Command: `node --test --experimental-strip-types tests/recurrence-calculate.test.ts tests/recurrence-materialize.test.ts`
- Output: 10 tests passed, 0 failed.
