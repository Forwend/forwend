// openapi-typescript needs the TypeScript 5 compiler API; the workspace's TypeScript 7 has none.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "openapi-typescript") {
        delete pkg.peerDependencies.typescript;
        pkg.dependencies.typescript = "5.9.3";
      }
      return pkg;
    },
  },
};
