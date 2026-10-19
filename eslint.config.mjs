import prettier from 'eslint-config-prettier';

import apify from '@apify/eslint-config/js.js';

// eslint-disable-next-line import-x/no-default-export
export default [{ ignores: ['**/dist', '.backup-before-v0.4/**'] }, ...apify, prettier];
