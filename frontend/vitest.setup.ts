import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom doesn't implement HTMLDialogElement methods
HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || (() => {});
HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || (() => {});
