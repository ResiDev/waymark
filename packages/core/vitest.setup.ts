import '@testing-library/jest-dom/vitest';

// jsdom has no layout and leaves `scrollIntoView` out; a Run calls it on a far Waymark.
// A server test, in Node's environment, has no Element to give it to.
if (typeof Element !== "undefined") Element.prototype.scrollIntoView = () => {};
