import '@testing-library/jest-dom';

// BroadcastChannel is not available in jsdom — stub it globally
global.BroadcastChannel = class {
  constructor() {}
  postMessage() {}
  close() {}
  onmessage = null;
};

// scrollIntoView is not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = function () {};
