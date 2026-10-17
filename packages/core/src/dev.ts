// Bundlers replace `process.env.NODE_ENV`. A page that loads Waymark without
// one has no `process` at all, and counts as development.
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** Checks that catch an app's mistakes, too costly or too strict for production. */
export const inDevelopment = (): boolean => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
};
