// ESLint skips what eslint.config.mjs ignores; --no-warn-ignored keeps a
// staged ignored file from counting as a warning under --max-warnings=0.
// Prettier formats everything, TypeScript included (`yarn test:other`).
module.exports = {
  "*.{js,mjs,cjs,ts,tsx}": [
    "eslint --max-warnings=0 --no-warn-ignored --fix",
    "prettier --write",
  ],
  "*.{css,scss,json,md,html,yml}": ["prettier --write"],
};
