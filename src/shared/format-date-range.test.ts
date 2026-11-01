import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDateRange } from "./format-date-range.ts";

// `pnpm test` runs in a timezone west of UTC, where a date parsed as UTC midnight
// would slip to the previous month if the formatter used local time.
test("formats a closed range", () => {
  assert.equal(
    formatDateRange("2024-12-01", "2025-07-01"),
    "Dec 2024 – Jul 2025",
  );
});

test("a null end reads as Present", () => {
  assert.equal(formatDateRange("2025-01-01", null), "Jan 2025 – Present");
});
