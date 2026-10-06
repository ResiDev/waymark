/**
 * Where an app would call its analytics SDK. The demo has none, so events go
 * to `window.track` when the recording has put one there, for the edit to show.
 */
export type TrackedEvent = Readonly<{ name: string; detail: string }>;

declare global {
  interface Window {
    track?: (event: TrackedEvent) => void;
  }
}

export function track(name: string, detail: string) {
  window.track?.({ name, detail });
}
