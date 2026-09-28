// Inferred literals skip TypeScript's excess property check, so without this a
// misspelled field would compile.
export type Exactly<T, TShape> = T extends unknown
  ? T & { readonly [K in Exclude<keyof T, keyof TShape>]: never }
  : never;
