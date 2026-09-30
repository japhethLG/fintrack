/**
 * jsdom gaps that antd, recharts, radix, dnd-kit and react-window trip over.
 * Installed once per test file from `tests/ui/setup.ts`. Every shim is
 * idempotent and only fills a gap; it never overrides something jsdom has.
 */
import { vi } from "vitest";

/**
 * Size reported to ResizeObserver callbacks. recharts' ResponsiveContainer sizes
 * itself from the observer, and jsdom reports 0x0 for every layout property.
 */
export const OBSERVED_SIZE = { width: 800, height: 400 };

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    // Report a non-zero size so ResponsiveContainer renders its chart.
    queueMicrotask(() => {
      const { width, height } = OBSERVED_SIZE;
      const rect = { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height };
      this.callback(
        [
          {
            target,
            contentRect: rect as DOMRectReadOnly,
            borderBoxSize: [{ inlineSize: width, blockSize: height }],
            contentBoxSize: [{ inlineSize: width, blockSize: height }],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    });
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** Treats every observed element as scrolled into view (scroll-reveal hooks). */
class FakeIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      )
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

export function installBrowserShims(): void {
  const w = window as unknown as Record<string, unknown>;

  // --- matchMedia (antd responsive observer, next-themes-style hooks) -------
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  // --- observers -------------------------------------------------------------
  w.ResizeObserver ??= FakeResizeObserver;
  w.IntersectionObserver ??= FakeIntersectionObserver;
  (globalThis as Record<string, unknown>).ResizeObserver ??= FakeResizeObserver;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= FakeIntersectionObserver;

  // --- scrolling -------------------------------------------------------------
  window.scrollTo = vi.fn() as never;
  Element.prototype.scrollTo ??= vi.fn() as never;
  Element.prototype.scrollIntoView ??= vi.fn();

  // --- pointer capture / hit testing (radix Select, dnd-kit) -----------------
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  if (!document.elementFromPoint) document.elementFromPoint = () => null;

  // --- misc APIs jsdom leaves unimplemented ----------------------------------
  // canvas: recharts text measurement / antd; jsdom logs "not implemented".
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.print = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = () => "blob:fake";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};

  // getComputedStyle(el, pseudo) prints "Not implemented" noise in jsdom; the
  // pseudo-element argument is only used by scrollbar measurement.
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((el: Element, pseudo?: string | null) =>
    realGetComputedStyle(el, pseudo ? null : undefined)) as typeof window.getComputedStyle;
}
