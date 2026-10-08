/** A listener that ignores the call `subscribe` makes at once, so it hears only changes. */
export const skipFirstCall = (listener: () => void) => {
  let called = false;
  return () => {
    if (called) listener();
    called = true;
  };
};
