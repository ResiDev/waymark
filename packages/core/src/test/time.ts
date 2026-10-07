import { onTestFinished, vi } from "vitest";

/** Fakes the clock and animation frames for this test. `flush` runs the frames asked for, `ms` later. */
export const fakeFrames = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const flush = (ms = 16) => {
    clock += ms;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(clock);
  };
  /** A frame that sees the Waymark gone, then one after the 200ms it may be gone before it counts as lost. */
  const flushLost = () => {
    flush();
    flush(200);
  };
  return { frames, flush, flushLost };
};

/**
 * Keeps the frame a Run asks for, so a perf test can run it in a tight loop. Put back when the test ends.
 * Swapped by hand, not spied on, so a spy's overhead stays out of the timings.
 */
export const captureFrames = () => {
  let captured: FrameRequestCallback | undefined;
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    captured = cb;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};
  onTestFinished(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
  });
  return () => {
    const cb = captured!;
    captured = undefined;
    cb(performance.now());
  };
};

/** Fakes timers and `Date`, from `now`, until the test ends. */
export const fakeTimers = (now?: number) => {
  vi.useFakeTimers(now === undefined ? {} : { now });
  onTestFinished(() => {
    vi.useRealTimers();
  });
};
