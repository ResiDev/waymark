import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTourStore, tourStores } from '../store';
import type { TutorialStep } from '../types';
import type { CallbackArgs } from './storeHelpers';
import { type FrameState, runTourFrame } from './rafLoop';
import { create } from 'domain';

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

afterEach(() => {
  tourStores.delete(TOUR_ID);
  document.body.innerHTML = '';
});

describe('runTourFrame', () => {
  it('runs with no selector and no highlight element', () => {
    const { run, updateHighlight } = setup();
    const result = run();
    expect(updateHighlight).toHaveBeenCalledWith(null);
    expect(result.highlightTargetStatus).toBe('stable');
  });

  it('sets the highlight element when null', () => {
    const target = '<div data-tour="target">...</div>';
    document.body.innerHTML = target;
    const selector = '[data-tour=target]';
    const { store, run, updateHighlight } = setup({ selector });
    run();
    expect(store.getHighlightedElement()).toBe(document.querySelector(selector));
    expect(updateHighlight).toBeCalledWith(document.querySelector(selector));
  });

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

  it('passes highlight element to check', () => {
    const target = '<div data-tour="target">...</div>';
    document.body.innerHTML = target;
    const selector = '[data-tour=target]';
    const checkFn = vi.fn(() => true);

    const { store, run } = setup({
      selector,
      currentStep: { content: 'some content', advanceWhen: { type: 'state', check: checkFn } },
    });
    run();
    expect(checkFn).toBeCalledWith(document.querySelector(selector));
  });

  it('passes undefined to check when not found', () => {
    const target = '<div>...</div>';
    document.body.innerHTML = target;
    const selector = '[data-tour=target]';
    const checkFn = vi.fn(() => true);

    const { store, run } = setup({
      selector,
      currentStep: { content: 'some content', advanceWhen: { type: 'state', check: checkFn } },
    });
    run();
    expect(checkFn).toBeCalledWith(undefined);
  });

  it('auto advances when currentStep is state and check is true with delay', () => {
    const { store, run } = setup({
      currentStep: { content: 'some content', advanceWhen: { type: 'state', check: () => true, delayMs: 50 } },
    });
    vi.useFakeTimers();
    const result = run();

    expect(store.step).toBe(0);
    expect(result.isAutoAdvancing).toBe(true);

    vi.advanceTimersByTime(49);
    expect(store.step).toBe(0);
    expect(result.isAutoAdvancing).toBe(true);

    vi.advanceTimersByTime(1);
    expect(store.step).toBe(1);
    expect(result.isAutoAdvancing).toBe(true);
    expect(!!result.timeoutId).toBeDefined();

    vi.useRealTimers();
  });

  it('it gates next until advanced', () => {
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

  it('it does not auto advanced when that is disabled', () => {
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

  it('it gates AND disableAutoAdvance', () => {
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

  it('maintains focus we highlight is found runs', () => {
    const target = '<div data-tour="target">...</div>';
    document.body.innerHTML = target;
    const selector = '[data-tour=target]';
    const { store, run } = setup({ selector });
    store.focused = true;
    const result = run();
    expect(store.focused).toBe(true);
    expect(result.highlightTargetStatus).toBe('stable');
  });

  it('it unfocuses and sets highlight status to waiting when no highlightElement and there is a selector and then refocuses when found', () => {
    const target = '<div>...</div>';
    const selector = '[data-tour=target]';
    const { store, run } = setup({ selector });
    document.body.innerHTML = target;
    store.focused = true;
    const result1 = run();
    expect(store.focused).toBe(false);
    expect(result1.highlightTargetStatus).toBe('waiting-for-highlight-target');

    document.body.innerHTML = '<div data-tour="target">...</div>';
    const result2 = run({ frameState: result1 });
    expect(store.focused).toBe(true);
    expect(result2.highlightTargetStatus).toBe('stable');
  });

  it('it does refocuses then finding target with selector but not waiting', () => {
    const target = '<div data-tour="target">...</div>';
    const selector = '[data-tour=target]';
    const { store, run } = setup({
      selector,
    });
    document.body.innerHTML = target;
    store.focused = false;
    const result = run();
    expect(store.focused).toBe(false);
    expect(result.highlightTargetStatus).toBe('stable');
  });

  it('disconnected cached query is replaced', () => {
    const el = document.createElement('div');
    el.setAttribute('data-tour', 'target');
    document.body.appendChild(el);
    const selector = '[data-tour=target]';
    const { store, run, updateHighlight } = setup({
      selector,
    });
    run();

    expect(store.highlightedElement).toBe(el);
    expect(updateHighlight).toBeCalledWith(el);
    el.remove();

    const newEl = document.createElement('div');
    newEl.setAttribute('data-tour', 'target');
    document.body.appendChild(newEl);
    run();
    expect(el.isConnected).toBe(false);
    expect(store.highlightedElement).toBe(newEl);
    expect(updateHighlight).toBeCalledWith(newEl);
  });
});
