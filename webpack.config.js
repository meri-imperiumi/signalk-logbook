const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

const { ModuleFederationPlugin } = require('webpack').container;
const { WatchIgnorePlugin } = require('webpack');

const packageJson = require('./package.json');

module.exports = {
  entry: './src/index',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'public'),
    // Sweep chunks from previous builds: chunk names are stable across
    // builds, and leftovers from other eras have caused confusion (and
    // stale-cache chunk soup) in deployed installs
    clean: true,
  },
  resolve: {
    extensions: [
      '.js',
      '.jsx',
    ],
    fallback: {
      querystring: require.resolve('querystring-es3'),
    },
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          presets: ['@babel/preset-react'],
        },
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
        ],
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        loader:
          'file-loader',
        options: {
          name: '[path][name].[ext]',
        },
      },
    ],
  },
  plugins: [
    // Use Plugin
    new ModuleFederationPlugin({
      name: packageJson.name,
      library: { type: 'var', name: packageJson.name.replace(/[-@/]/g, '_') },
      filename: 'remoteEntry.js',
      exposes: {
        './AppPanel': './src/components/AppPanel',
      },
      shared: [
        {
          react: {
            singleton: true,
          },
        },
        'react-dom',
      ],
    }),
    new WatchIgnorePlugin({
      paths: [path.resolve(__dirname, 'public/')],
    }),
    new HtmlWebpackPlugin({
      template: './public_src/index.html',
    }),
    new CopyPlugin({
      patterns: [
        {
          from: 'public_src/*.png',
          to() {
            return Promise.resolve('[name][ext]');
          },
        },
        // MapLibre's tile-parsing workers load as module workers from these
        // files (the worker imports the shared chunk by relative URL), so they
        // must sit next to each other under vendor/ in the built webapp.
        // ChartMap points MapLibre's WORKER_URL at them; webpack cannot
        // bundle them because MapLibre resolves the worker path at runtime.
        {
          from: 'node_modules/maplibre-gl/dist/maplibre-gl-worker-dev.mjs',
          to: 'vendor/',
        },
        {
          from: 'node_modules/maplibre-gl/dist/maplibre-gl-shared-dev.mjs',
          to: 'vendor/',
        },
      ],
    }),
  ],
};
