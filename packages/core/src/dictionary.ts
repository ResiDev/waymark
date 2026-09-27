/**
 * An empty object with no prototype, so every string is an ordinary key
 * (`toString` and `__proto__` included) and a missing one reads undefined.
 */
export const dictionary = <T>(): Record<string, T> => {
  // oxlint-disable-next-line typescript/no-unsafe-return -- lib.d.ts types Object.create as returning any.
  return Object.create(null);
};
