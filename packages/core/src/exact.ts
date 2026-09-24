/**
 * T, with every key that TShape does not name turned into an error. Inferred
 * literals skip TypeScript's own excess property check, so the definition
 * functions apply this to reject a misspelled field.
 */
export type Exactly<T, TShape> = T extends unknown
  ? T & { readonly [K in Exclude<keyof T, keyof TShape>]: never }
  : never;
