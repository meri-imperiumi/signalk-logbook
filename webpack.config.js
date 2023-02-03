const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

const { ModuleFederationPlugin } = require('webpack').container;
const { WatchIgnorePlugin } = require('webpack');

const packageJson = require('./package.json');

module.exports = {
  entry: './src/index',
  mode: 'development',
  output: {
    path: path.resolve(__dirname, 'public'),
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
  ],
};
