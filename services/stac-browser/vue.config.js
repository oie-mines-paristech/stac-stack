const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

const { properties } = require('./config.schema.json');
const pkgFile = require('./package.json');

const optionsForType = (type) => Object.entries(properties)
  .filter(([_, schema]) => Array.isArray(schema.type) && schema.type.includes(type))
  .map(([key]) => key);
const argv = yargs(hideBin(process.argv))
  .parserConfiguration({'camel-case-expansion': false})
  .env('SB')
  .boolean(optionsForType("boolean"))
  .number(optionsForType("number").concat(optionsForType("integer")))
  .array(optionsForType("array"))
  .option(
    Object.fromEntries(
      optionsForType("object").map((k) => [k, { coerce: JSON.parse }])
    )
  )
  .argv;
// Clean-up arguments
delete argv._;
delete argv.$0;

const configFile = path.resolve(argv.CONFIG ? argv.CONFIG : './config.js');
const configFromFile = require(configFile);
const mergedConfig = Object.assign(configFromFile, argv);

const vueConfig = {
  lintOnSave: process.env.VUE_CLI_LINT === 'false' ? false : process.env.NODE_ENV !== 'production',
  productionSourceMap: !mergedConfig.noSourceMaps,
  publicPath: mergedConfig.pathPrefix,
  chainWebpack: webpackConfig => {
    webpackConfig.plugin('define').tap(args => {
      args[0].STAC_BROWSER_VERSION = JSON.stringify(pkgFile.version);
      args[0].CONFIG_PATH = JSON.stringify(configFile);
      args[0].CONFIG_CLI = JSON.stringify(argv);
      return args;
    });

    webpackConfig.plugin('html').tap(args => {
      args[0].title = mergedConfig.catalogTitle;
      args[0].url = mergedConfig.catalogUrl;
      return args;
    });
  },
  configureWebpack: {
    resolve: {
      fallback: {
        'fs/promises': false
      }
    },
    plugins: [
      new NodePolyfillPlugin({
        includeAliases: ['Buffer', 'path']
      })
    ]
  },
  pluginOptions: {
    i18n: {
      locale: mergedConfig.locale,
      fallbackLocale: mergedConfig.fallbackLocale,
      enableInSFC: false
    }
  }
};

if (process.env.NODE_ENV === 'development') {
  vueConfig.devServer = {
    host: '0.0.0.0',
    port: parseInt(process.env.VUE_DEV_SERVER_PORT || '8080', 10),
    allowedHosts: 'all',
    client: {
      webSocketURL: 'auto://0.0.0.0:0/ws'
    },
    watchFiles: {
      options: {
        // Bind mounts + polling cause endless rebuild loops in Docker on Linux.
        usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
        ignored: [
          '**/node_modules/**',
          '**/public/config.js',
          '**/tmp/**'
        ]
      }
    }
  };
  vueConfig.configureWebpack.watchOptions = {
    ignored: ['**/node_modules/**', '**/public/config.js', '**/tmp/**'],
    aggregateTimeout: 300
  };
}

module.exports = vueConfig;
