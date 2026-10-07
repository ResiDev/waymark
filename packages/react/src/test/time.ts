import { act } from "react";
import { onTestFinished, vi } from "vitest";

/** Holds animation frames until the test runs them with `runFrames`, inside act. */
export const fakeFrames = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const runFrames = async () => {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now());
      await Promise.resolve();
    });
  };
  return { frames, runFrames };
};

/** Animation frames that never run, for a test that renders a Walkthrough but doesn't need it to measure. */
export const freezeFrames = () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
};

/**
 * Fakes timers until the test ends. Call after any frame spy: a spy made over the fake clock is put
 * back over the real one when mocks are restored, leaking the fake into later tests.
 */
export const fakeTimers = () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
};
