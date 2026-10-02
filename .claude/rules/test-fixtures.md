---
paths:
  - code/**/__tests__/**
  - code/**/*.test.ts
  - code/**/*.test.tsx
tags: [tests, fixtures]
priority: normal
source: hand-written
---

# A shared test fixture changes for all its tests, or not at all

A fixture in `__tests__/fixtures/` or a `*Fixture` module (for example
`session/__tests__/sessionFixture.tsx`,
`lib/__tests__/fixtures/fakeMapLibre.ts`,
`state/__tests__/fixtures/documentWorld.ts`) serves many test files, and
the test headers that say "per test-fixtures.md" point here.

- **Never change a shared fixture to make one test pass.** Make a new
  fixture, or give the test its own mocks.
- **A change to a shared fixture is checked against every consumer.** Find
  them with a grep for the fixture's module name, and run them all.
- A test file that owns its mocks says so in its header. Keep them local;
  do not move them into a shared fixture for one more test.

Verify with `cd code && npx vitest run` over every file that imports the
fixture.
