import { useCallback, useLayoutEffect, useRef } from 'react';

// Local stand-in for React's useEffectEvent, which only became stable in React
// 19.2 — we support React 18. Same contract: a stable identity whose body always
// sees the latest render's props and state, so effects can call it without
// listing it as a dependency. Delete this and import from 'react' if the peer
// range ever moves to >=19.2.
//
// Difference from the real hook: React's version throws if you call it during
// render. This one cannot detect that, so keep calls inside effects and handlers.
export function useEffectEvent<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}
