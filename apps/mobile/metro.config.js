// Metro config for the Expo app (monorepo watch folders come from Expo's defaults).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The workspace writes ESM-style relative imports with a ".js" suffix
// (e.g. `./enums.js`) so the Node server's NodeNext resolution is happy, but the
// files on disk are .ts/.tsx. Metro doesn't map these, so try the suffix-less
// path first and fall back to the original request.
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the literal .js request
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
