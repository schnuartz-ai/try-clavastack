import React from 'react';
import { Image } from 'react-native';

const FastImage = (props: any) => <Image {...props} />;
(FastImage as any).priority = { low: 'low', normal: 'normal', high: 'high' };
(FastImage as any).resizeMode = { contain: 'contain', cover: 'cover', stretch: 'stretch', center: 'center' };
export default FastImage;
