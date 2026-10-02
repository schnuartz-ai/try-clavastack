import React, { useMemo, useReducer, useRef } from 'react';
import { View } from 'react-native';

export function useSharedValue<T>(initial: T) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const shared = useMemo(() => ({ current: initial, refresh }), []);
  shared.refresh = refresh;
  return Object.defineProperty({}, 'value', {
    get: () => shared.current,
    set: (value: T) => { shared.current = value; shared.refresh(); },
  }) as { value: T };
}

export function useAnimatedStyle<T>(factory: () => T) { return factory(); }
export function withSpring<T>(value: T) { return value; }
export function withTiming<T>(value: T, config?: { duration?: number }, callback?: (finished?: boolean) => void) {
  if (callback) setTimeout(() => callback(true), Math.min(config?.duration ?? 0, 650));
  return value;
}
export function interpolate(value: number, input: number[], output: number[]) {
  if (!input.length || input.length !== output.length) return output[0] ?? 0;
  if (value <= input[0]) return output[0];
  for (let index = 1; index < input.length; index++) {
    if (value <= input[index]) {
      const fraction = (value - input[index - 1]) / (input[index] - input[index - 1]);
      return output[index - 1] + fraction * (output[index] - output[index - 1]);
    }
  }
  return output[output.length - 1];
}
export function runOnJS<T extends (...args: any[]) => any>(callback: T) { return callback; }

// Reanimated's native event wrapper is not needed in the browser. RNGH still
// calls this hook while preparing gestures, so preserve the callback as a
// stable web event handler and refresh it when RNGH requests a rebuild.
export function useEvent<T extends (...args: any[]) => any>(
  handler: T,
  _eventNames: readonly string[] = [],
  rebuild = false,
) {
  const handlerRef = useRef(handler);
  if (rebuild) handlerRef.current = handler;
  return useMemo(() => (...args: Parameters<T>) => handlerRef.current(...args), []);
}

export function setGestureState() {}

const Animated = { View };
export default Animated;
