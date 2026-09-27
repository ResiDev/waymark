import '@testing-library/jest-dom/vitest';

// jsdom has no layout and leaves `scrollIntoView` out; a Run calls it on a far Waymark.
Element.prototype.scrollIntoView = () => {};
