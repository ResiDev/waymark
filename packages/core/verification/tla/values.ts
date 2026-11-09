// TLA+ values, as TLC prints them in a state.

export type Value = string | number | boolean | readonly Value[] | Readonly<{ [field: string]: Value }>;

export function parseValue(text: string): Value {
  let at = 0;
  const skip = () => {
    while (at < text.length && /\s/.test(text.charAt(at))) at++;
  };
  const take = (token: string) => {
    skip();
    if (!text.startsWith(token, at)) throw new Error(`Expected ${token} at ${at} in ${text}`);
    at += token.length;
  };
  const value = (): Value => {
    skip();
    if (text.startsWith("<<", at)) {
      at += 2;
      const items: Value[] = [];
      skip();
      while (!text.startsWith(">>", at)) {
        items.push(value());
        skip();
        if (text.startsWith(",", at)) at++;
        skip();
      }
      at += 2;
      return items;
    }
    if (text.startsWith("[", at)) {
      at++;
      const fields: Record<string, Value> = {};
      for (;;) {
        skip();
        const name = /^\w+/.exec(text.slice(at))?.[0];
        if (name === undefined) throw new Error(`Expected a field at ${at} in ${text}`);
        at += name.length;
        take("|->");
        fields[name] = value();
        skip();
        if (text.startsWith("]", at)) {
          at++;
          return fields;
        }
        take(",");
      }
    }
    if (text.startsWith('"', at)) {
      const end = text.indexOf('"', at + 1);
      const string = text.slice(at + 1, end);
      at = end + 1;
      return string;
    }
    if (text.startsWith("TRUE", at)) {
      at += 4;
      return true;
    }
    if (text.startsWith("FALSE", at)) {
      at += 5;
      return false;
    }
    const digits = /^-?\d+/.exec(text.slice(at))?.[0];
    if (digits === undefined) throw new Error(`Cannot read the value at ${at} in ${text}`);
    at += digits.length;
    return Number(digits);
  };
  return value();
}

/** A state's variables by name, from TLC's `/\ name = value` lines. */
export function variables(label: string): (name: string) => Value {
  const vars = new Map<string, Value>();
  for (const line of label.split(/\n(?=\/\\ )/)) {
    const match = /^\/\\ (\w+) = ([\s\S]*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) vars.set(match[1], parseValue(match[2]));
  }
  return (name) => {
    const value = vars.get(name);
    if (value === undefined) throw new Error(`The state has no ${name}`);
    return value;
  };
}

const isRecord = (value: Value): value is Readonly<{ [field: string]: Value }> => typeof value === "object" && !Array.isArray(value);

export function field(value: Value, name: string): Value {
  if (!isRecord(value) || !(name in value)) throw new Error(`No field ${name} in ${JSON.stringify(value)}`);
  const found = value[name];
  if (found === undefined) throw new Error(`No field ${name}`);
  return found;
}

export const asString = (value: Value): string => {
  if (typeof value !== "string") throw new Error(`Not a string: ${JSON.stringify(value)}`);
  return value;
};

export const asNumber = (value: Value): number => {
  if (typeof value !== "number") throw new Error(`Not a number: ${JSON.stringify(value)}`);
  return value;
};

export const asBoolean = (value: Value): boolean => {
  if (typeof value !== "boolean") throw new Error(`Not a boolean: ${JSON.stringify(value)}`);
  return value;
};

const isList = (value: Value): value is readonly Value[] => Array.isArray(value);

export const asList = (value: Value): readonly Value[] => {
  if (!isList(value)) throw new Error(`Not a sequence: ${JSON.stringify(value)}`);
  return value;
};

/** One of a fixed set of strings, such as a status the model names. */
export function asOneOf<T extends string>(value: Value, allowed: readonly T[]): T {
  const string = asString(value);
  const found = allowed.find((one) => one === string);
  if (found === undefined) throw new Error(`Unknown value ${string}, not one of ${allowed.join(", ")}`);
  return found;
}
