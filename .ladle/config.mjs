/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: ['packages/ui/**/*.stories.tsx', 'apps/control-center/**/*.stories.tsx'],
  viteConfig: process.cwd() + '/.ladle/vite.config.ts',
  defaultStory: 'design-system--button--default',
  outDir: './ladle-build',
}
