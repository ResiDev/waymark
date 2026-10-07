import { beforeEach, expect, onTestFinished } from "vitest";

// A setup file, not a test's setup: it fails any test that leaves something on the page or in
// localStorage, which every helper should have undone. Registered first, so it runs after their cleanups.
beforeEach(() =>
  onTestFinished(() => {
    expect([...document.body.children].map((element) => element.outerHTML), "left on the page").toEqual([]);
    expect(Object.keys(localStorage), "left in localStorage").toEqual([]);
  }),
);
