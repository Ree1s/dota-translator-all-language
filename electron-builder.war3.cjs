const { build: base } = require('./package.json');
module.exports = {
  ...base,
  appId: 'com.ree1s.warcraft-chat-translator',
  productName: 'Warcraft Chat Translator',
  extraMetadata: { name: 'warcraft-chat-translator', productName: 'Warcraft Chat Translator', defaultGame: 'war3' },
  directories: { output: 'dist-war3' },
  win: { ...base.win, artifactName: 'Warcraft-Chat-Translator-${version}-Setup.${ext}' },
  nsis: { ...base.nsis, shortcutName: 'Warcraft Chat Translator', runAfterFinish: false },
  publish: null,
};
