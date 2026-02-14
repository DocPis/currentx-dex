import "@testing-library/jest-dom/vitest";

class MockIntersectionObserver {
  root: Element | Document | null;
  rootMargin: string;
  thresholds: ReadonlyArray<number>;

  constructor() {
    this.root = null;
    this.rootMargin = "0px";
    this.thresholds = [0];
  }

  disconnect() {}

  observe() {}

  takeRecords() {
    return [];
  }

  unobserve() {}
}

if (typeof window !== "undefined" && !window.IntersectionObserver) {
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
}
