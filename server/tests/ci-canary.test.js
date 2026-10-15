// TEMPORARY (P1-17): proves CI fails on a failing test. Reverted in the next commit.
test('ci canary fails on purpose', () => {
  expect(1).toBe(2);
});
