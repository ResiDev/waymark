export function assertUnreachable(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function capitalize<TValue extends string>(
  value: TValue,
): Capitalize<TValue> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<TValue>;
}
