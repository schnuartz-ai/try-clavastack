import React from 'react';
import { View } from 'react-native';

function cssColor(color: string | number) {
  if (typeof color !== 'number') return color;
  const alpha = (color >>> 24) & 0xff;
  const red = (color >>> 16) & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = color & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}

export function LinearGradient({
  angle,
  colors = [],
  end,
  locations,
  start,
  style,
  useAngle,
  children,
  ...props
}: any) {
  let direction = Number.isFinite(angle) && useAngle ? `${angle}deg` : '180deg';
  if (!useAngle && start && end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    direction = `${(Math.atan2(dx, -dy) * 180) / Math.PI}deg`;
  }
  const stops = colors.map((color: string | number, index: number) => {
    const location = locations?.[index];
    return `${cssColor(color)}${Number.isFinite(location) ? ` ${location * 100}%` : ''}`;
  });

  return React.createElement(
    View,
    {
      ...props,
      style: [style, { backgroundImage: `linear-gradient(${direction}, ${stops.join(', ')})` }],
    },
    children,
  );
}

export default LinearGradient;
