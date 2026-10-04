/** An app without `exactOptionalPropertyTypes` can pass a label as `undefined`; it gets the default, as if left out. */
export function withDefaults<T extends object>(defaults: T, labels: Partial<T> | undefined): T {
  const text = { ...defaults };
  for (const key in labels) {
    const label = labels[key];
    if (label !== undefined) text[key] = label;
  }
  return text;
}
