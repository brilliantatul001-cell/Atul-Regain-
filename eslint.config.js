import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'www/**/*', 'node_modules/**/*', 'src/**/*', 'server/**/*', 'scripts/**/*', 'server.ts', '*.ts', '*.mjs'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
