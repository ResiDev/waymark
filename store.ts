export const tutorialStore = {
  step: 0,
  focused: true,
  listeners: new Set<() => void>(),
  getStep: () => tutorialStore.step,
  getFocused: () => tutorialStore.focused,
  subscribe: (callback: () => void) => {
    tutorialStore.listeners.add(callback);
    return () => tutorialStore.listeners.delete(callback);
  },
  focus: () => {
    tutorialStore.focused = true;
    tutorialStore.listeners.forEach((callback) => callback());
  },
  unfocus: () => {
    tutorialStore.focused = false;
    tutorialStore.listeners.forEach((callback) => callback());
  },
  prev: () => {
    if (tutorialStore.step > 0) {
      tutorialStore.step -= 1;
      tutorialStore.focused = true;
      tutorialStore.listeners.forEach((callback) => callback());
    }
  },
  advance: () => {
    tutorialStore.step += 1;
    tutorialStore.focused = true;
    tutorialStore.listeners.forEach((callback) => callback());
  },
  reset: () => {
    tutorialStore.step = 0;
    tutorialStore.focused = true;
    tutorialStore.listeners.forEach((callback) => callback());
  },
};
