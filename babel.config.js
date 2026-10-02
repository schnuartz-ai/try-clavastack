const path = require('node:path');
const upstream = path.resolve(__dirname, 'upstream', 'bitcoin-keeper');

module.exports = function configureKeeperWebBabel(api) {
  api.cache(true);
  return {
    presets: [require.resolve('@react-native/babel-preset', { paths: [upstream] })],
    plugins: [
      [
        require.resolve('babel-plugin-module-resolver', { paths: [upstream] }),
        { root: [upstream] },
      ],
      require.resolve('@babel/plugin-transform-class-static-block', { paths: [upstream] }),
      require.resolve('react-native-reanimated/plugin', { paths: [upstream] }),
    ],
  };
};
