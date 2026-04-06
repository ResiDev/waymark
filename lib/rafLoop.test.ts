import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTourStore, tourStores } from '../store';
import type { TutorialStep } from '../types';
import type { CallbackArgs } from './storeHelpers';
import { type FrameState, rafLoop, runTourFrame } from './rafLoop';

const TOUR_ID = 'test-tour';

const DEFAULT_TUTORIAL_STEP: TutorialStep = {
  content: 'test step',
};

const DEFAULT_FRAME_STATE: FrameState = {
  isAutoAdvancing: false,
  scrolledIntoViewOnce: false,
  ariaAnnotatedElement: null,
  timeoutId: undefined,
  highlightTargetStatus: 'stable',
};

const DEFAULT_CALLBACK_ARGS: CallbackArgs = {
  tourCallbacks: undefined,
  stepCallbacks: undefined,
  context: { stepIndex: 0, currentStep: DEFAULT_TUTORIAL_STEP, targetSelector: undefined },
};

const originalScrollIntoView = Element.prototype.scrollIntoView;
const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

function setup(overrides: Partial<Parameters<typeof runTourFrame>[0]> = {}) {
  const store = createTourStore(TOUR_ID);
  const updateHighlight = vi.fn();

  const defaults = {
    tourStore: store,
    selector: undefined as string | undefined,
    focused: true,
    currentStep: DEFAULT_TUTORIAL_STEP,
    frameState: { ...DEFAULT_FRAME_STATE },
    queryRoot: document,
    callbackArgs: DEFAULT_CALLBACK_ARGS,
    updateHighlight,
  };

  return {
    store,
    updateHighlight,
    run: (frameOverrides?: Partial<Parameters<typeof runTourFrame>[0]>) =>
      runTourFrame({ ...defaults, ...overrides, ...frameOverrides }),
  };
}

beforeEach(() => {
  scrollIntoViewMock.mockReset();
});

afterEach(() => {
  tourStores.delete(TOUR_ID);
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('runTourFrame', () => {
  describe('target resolution', () => {
    it('runs with no selector and no highlight element', () => {
      const { run, updateHighlight } = setup();
      const result = run();
      expect(updateHighlight).toHaveBeenCalledWith(null);
      expect(result.highlightTargetStatus).toBe('stable');
    });

    it('sets the highlight element when null', () => {
      document.body.innerHTML = '<div data-tour="target">...</div>';
      const selector = '[data-tour=target]';
      const { store, run, updateHighlight } = setup({ selector });

      run();

      expect(store.getHighlightedElement()).toBe(document.querySelector(selector));
      expect(updateHighlight).toHaveBeenCalledWith(document.querySelector(selector));
    });

    it('passes highlight element to check', () => {
      document.body.innerHTML = '<div data-tour="target">...</div>';
      const selector = '[data-tour=target]';
      const checkFn = vi.fn(() => true);
      const { run } = setup({
        selector,
        currentStep: { content: 'some content', advanceWhen: { type: 'state', check: checkFn } },
      });

      run();

      expect(checkFn).toHaveBeenCalledWith(document.querySelector(selector));
    });

    it('passes undefined to check when not found', () => {
      document.body.innerHTML = '<div>...</div>';
      const selector = '[data-tour=target]';
      const checkFn = vi.fn(() => true);
      const { run } = setup({
        selector,
        currentStep: { content: 'some content', advanceWhen: { type: 'state', check: checkFn } },
      });

      run();

      expect(checkFn).toHaveBeenCalledWith(undefined);
    });

    it('disconnected cached query is replaced', () => {
      const el = document.createElement('div');
      el.setAttribute('data-tour', 'target');
      document.body.appendChild(el);

      const selector = '[data-tour=target]';
      const { store, run, updateHighlight } = setup({ selector });

      run();

      expect(store.highlightedElement).toBe(el);
      expect(updateHighlight).toHaveBeenCalledWith(el);

      el.remove();

      const newEl = document.createElement('div');
      newEl.setAttribute('data-tour', 'target');
      document.body.appendChild(newEl);

      run();

      expect(el.isConnected).toBe(false);
      expect(store.highlightedElement).toBe(newEl);
      expect(updateHighlight).toHaveBeenCalledWith(newEl);
    });
  });

  describe('state advancement', () => {
    it('auto advances when currentStep is "state" and check is true', () => {
      let someVal = 0;
      const { store, run } = setup({
        currentStep: { content: 'some content', advanceWhen: { type: 'state', check: () => someVal > 0 } },
      });

      const result1 = run();
      expect(store.step).toBe(0);
      expect(result1.isAutoAdvancing).toBe(false);

      someVal = 1;

      const result2 = run();
      expect(store.step).toBe(1);
      expect(result2.isAutoAdvancing).toBe(true);
      expect(result2.timeoutId).toBe(undefined);
    });

    it('auto-advances only once across repeated frames', () => {
      const check = vi.fn(() => true);
      const { store, run } = setup({
        currentStep: {
          content: 'step',
          advanceWhen: { type: 'state', check },
        },
      });

      const frame1 = run();
      expect(store.step).toBe(1);
      expect(frame1.isAutoAdvancing).toBe(true);

      const frame2 = run({ frameState: frame1 });
      expect(store.step).toBe(1);
      expect(frame2.isAutoAdvancing).toBe(true);

      const frame3 = run({ frameState: frame2 });
      expect(store.step).toBe(1);
      expect(frame3.isAutoAdvancing).toBe(true);
      expect(check).toHaveBeenCalledTimes(3);
    });

    it('auto advances when currentStep is state and check is true with delay', () => {
      vi.useFakeTimers();
      const { store, run } = setup({
        currentStep: { content: 'some content', advanceWhen: { type: 'state', check: () => true, delayMs: 50 } },
      });

      const result = run();

      expect(store.step).toBe(0);
      expect(result.isAutoAdvancing).toBe(true);

      vi.advanceTimersByTime(49);
      expect(store.step).toBe(0);

      vi.advanceTimersByTime(1);
      expect(store.step).toBe(1);
      expect(result.timeoutId).toBeDefined();
    });

    it('gates next until advanced', () => {
      let someVal = 0;
      const { store, run } = setup({
        currentStep: { content: '', advanceWhen: { type: 'state', check: () => someVal > 0, gateNext: true } },
      });

      store.ready = false;
      run();
      expect(store.ready).toBe(false);
      expect(store.step).toBe(0);

      someVal = 1;

      run();
      expect(store.ready).toBe(true);
      expect(store.step).toBe(1);
    });

    it('does not auto advance when disabled', () => {
      let someVal = 0;
      const { store, run } = setup({
        currentStep: { content: '', advanceWhen: { type: 'state', check: () => someVal > 0, disableAutoAdvance: true } },
      });

      store.ready = false;
      run();
      expect(store.step).toBe(0);

      someVal = 1;

      run();
      expect(store.step).toBe(0);
    });

    it('gates and disables auto advance', () => {
      let someVal = 0;
      const { store, run } = setup({
        currentStep: {
          content: '',
          advanceWhen: { type: 'state', check: () => someVal > 0, gateNext: true, disableAutoAdvance: true },
        },
      });

      store.ready = false;
      run();
      expect(store.ready).toBe(false);
      expect(store.step).toBe(0);

      someVal = 1;

      run();
      expect(store.ready).toBe(true);
      expect(store.step).toBe(0);
    });
  });

  describe('target loss and recovery', () => {
    it('maintains focus when highlight is found', () => {
      document.body.innerHTML = '<div data-tour="target">...</div>';
      const selector = '[data-tour=target]';
      const { store, run } = setup({ selector });

      store.focused = true;
      const result = run();

      expect(store.focused).toBe(true);
      expect(result.highlightTargetStatus).toBe('stable');
    });

    it('unfocuses and waits when no highlight element is found, then refocuses when found', () => {
      const selector = '[data-tour=target]';
      const { store, run } = setup({ selector });

      document.body.innerHTML = '<div>...</div>';
      store.focused = true;

      const result1 = run();
      expect(store.focused).toBe(false);
      expect(result1.highlightTargetStatus).toBe('waiting-for-highlight-target');

      document.body.innerHTML = '<div data-tour="target">...</div>';

      const result2 = run({ frameState: result1 });
      expect(store.focused).toBe(true);
      expect(result2.highlightTargetStatus).toBe('stable');
    });

    it('does not refocus when target is found unless it was waiting', () => {
      document.body.innerHTML = '<div data-tour="target">...</div>';
      const selector = '[data-tour=target]';
      const { store, run } = setup({ selector });

      store.focused = false;
      const result = run();

      expect(store.focused).toBe(false);
      expect(result.highlightTargetStatus).toBe('stable');
    });
  });

  describe('accessibility', () => {
    it('adds aria dialog annotations to the highlighted element', () => {
      document.body.innerHTML = '<button data-tour="target">Target</button>';
      const selector = '[data-tour=target]';
      const target = document.querySelector(selector);
      const { run } = setup({ selector });

      const result = run();

      expect(target).toHaveAttribute('aria-haspopup', 'dialog');
      expect(target).toHaveAttribute('aria-expanded', 'true');
      expect(result.ariaAnnotatedElement).toBe(target);
    });

    it('moves aria dialog annotations when the highlighted element changes', () => {
      document.body.innerHTML = '<button data-tour="target">Old</button>';
      const selector = '[data-tour=target]';
      const oldTarget = document.querySelector(selector);
      const { store, run } = setup({ selector });

      const frame1 = run();
      expect(oldTarget).toHaveAttribute('aria-haspopup', 'dialog');
      expect(oldTarget).toHaveAttribute('aria-expanded', 'true');

      oldTarget?.remove();
      document.body.innerHTML = '<button data-tour="target">New</button>';
      const newTarget = document.querySelector(selector);

      const frame2 = run({ frameState: frame1 });

      expect(oldTarget).not.toHaveAttribute('aria-haspopup');
      expect(oldTarget).not.toHaveAttribute('aria-expanded');
      expect(newTarget).toHaveAttribute('aria-haspopup', 'dialog');
      expect(newTarget).toHaveAttribute('aria-expanded', 'true');
      expect(frame2.ariaAnnotatedElement).toBe(newTarget);
    });
  });

  describe('scroll behavior', () => {
    it('scrolls highlighted elements into view when out of view', () => {
      document.body.innerHTML = '<div data-tour="target">Target</div>';
      const selector = '[data-tour=target]';
      const target = document.querySelector(selector);
      const { run } = setup({ selector });

      run();

      expect(scrollIntoViewMock).toHaveBeenCalledOnce();
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
      expect(target?.scrollIntoView).toBe(scrollIntoViewMock);
    });

    it('does not scroll when scrollIntoView is never', () => {
      document.body.innerHTML = '<div data-tour="target">Target</div>';
      const selector = '[data-tour=target]';
      const { run } = setup({
        selector,
        currentStep: { content: 'test step', scrollIntoView: 'never' },
      });

      run();

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('scrolls only once when scrollIntoView is once', () => {
      document.body.innerHTML = '<div data-tour="target">Target</div>';
      const selector = '[data-tour=target]';
      const { run } = setup({
        selector,
        currentStep: { content: 'test step', scrollIntoView: 'once' },
      });

      const frame1 = run();
      const frame2 = run({ frameState: frame1 });

      expect(frame2.scrolledIntoViewOnce).toBe(true);
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });

    it('scrolls every frame when scrollIntoView is always', () => {
      document.body.innerHTML = '<div data-tour="target">Target</div>';
      const selector = '[data-tour=target]';
      const { run } = setup({
        selector,
        currentStep: { content: 'test step', scrollIntoView: 'always' },
      });

      const frame1 = run();
      run({ frameState: frame1 });

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
    });

    it('does not scroll when the tour is not focused', () => {
      document.body.innerHTML = '<div data-tour="target">Target</div>';
      const selector = '[data-tour=target]';
      const { run } = setup({ selector, focused: false });

      run();

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });
  });
});

describe('rafLoop', () => {
  it('clears pending timeouts on cleanup', () => {
    vi.useFakeTimers();

    let nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      setTimeout(() => cb(performance.now()), 0);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const store = createTourStore(TOUR_ID);
    const cleanup = rafLoop({
      tourStore: store,
      selector: undefined,
      focused: true,
      currentStep: {
        content: 'test step',
        advanceWhen: { type: 'state', check: () => true, delayMs: 50 },
      },
      frameState: { ...DEFAULT_FRAME_STATE },
      queryRoot: document,
      callbackArgs: DEFAULT_CALLBACK_ARGS,
      updateHighlight: vi.fn(),
    });

    vi.runOnlyPendingTimers();
    cleanup();
    vi.advanceTimersByTime(50);

    expect(store.step).toBe(0);
  });
});
