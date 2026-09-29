import { builtinRules } from 'eslint/use-at-your-own-risk'

// ESLint visits imports anywhere in a module, including after Vitest setup.
export default {
  rules: { sort: builtinRules.get('sort-imports') },
}
