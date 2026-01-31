import antfu from '@antfu/eslint-config'

export default antfu({
  vue: true,
  typescript: true,
  ignores: [
    '.claude/**',
    '.github/skills/**',
    'docs/**/*.md',
    'BLOG_POST.md',
  ],
  rules: {
    'no-console': 'off',
  },
})
