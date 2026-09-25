const base = require('./electron-builder.war3.cjs');
module.exports = {
  ...base,
  directories: { output: 'dist-war3-mac' },
  files: [...base.files, 'native/mac/war3-helper', '!src/*.ps1'],
  asarUnpack: ['native/mac/war3-helper', 'docs/**/*'],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    category: 'public.app-category.utilities',
    minimumSystemVersion: '11.0',
    artifactName: 'Warcraft-Chat-Translator-${version}-mac-${arch}.${ext}',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    binaries: ['Contents/Resources/app.asar.unpacked/native/mac/war3-helper'],
  },
  publish: null,
};
