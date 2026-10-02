import React from 'react';

type RefLike = {
  current?: unknown;
  viewTag?: unknown;
  elementRef?: { current?: unknown };
  _listRef?: { _scrollRef?: { firstChild?: unknown } };
  getNativeScrollRef?: () => unknown;
};

function describe(value: unknown) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return { type: typeof value, value: String(value) };
  }
  return {
    constructor: (value as { constructor?: { name?: string } }).constructor?.name,
    keys: Object.keys(value).slice(0, 12),
    currentType: typeof (value as RefLike).current,
    currentConstructor: (value as RefLike).current
      ? ((value as RefLike).current as { constructor?: { name?: string } }).constructor?.name
      : null,
    viewTag: (value as RefLike).viewTag,
  };
}

function diagnose(input: unknown, output: unknown) {
  const isDom = typeof Element !== 'undefined' && output instanceof Element;
  if (!isDom && !(output instanceof React.Component)) {
    const details = ((globalThis as any).__keeperGestureRefDebug ??= []);
    details.push({ input: describe(input), output: describe(output) });
  }
}

function resolveElement(value: unknown): unknown {
  if (!value) return value;
  if (typeof Element !== 'undefined' && value instanceof Element) {
    let element = value as HTMLElement;
    while (element.style?.display === 'contents') {
      // Use the first element child so text nodes and React placeholders do
      // not make RNGH attach to a non-DOM value during a browser commit.
      element = element.firstElementChild as HTMLElement;
      if (!element) return value;
    }
    return element;
  }
  if (value instanceof React.Component) return value;
  return value;
}

export default function findNodeHandle(viewRef: unknown): unknown {
  if (!viewRef) return null;
  const ref = viewRef as RefLike;

  if (ref.viewTag !== undefined) {
    const output = findNodeHandle(ref.viewTag);
    diagnose(viewRef, output);
    return output;
  }

  const scrollRef = ref._listRef?._scrollRef;
  if (scrollRef?.firstChild) return resolveElement(scrollRef.firstChild);

  const svgElement = ref.elementRef?.current;
  if (svgElement) return resolveElement(svgElement);

  const nativeScrollRef = ref.getNativeScrollRef?.();
  if (nativeScrollRef) return resolveElement(nativeScrollRef);

  const output = resolveElement(ref.current ?? viewRef);
  diagnose(viewRef, output);
  return output;
}
