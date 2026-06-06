module.exports = {
  env: { browser: true, es2020: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.0' } },
  rules: { 'react/react-in-jsx-scope': 'off', 'react/prop-types': 'off' },
}
