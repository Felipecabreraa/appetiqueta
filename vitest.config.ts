import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/components/labelFormValues.ts'],
      reporter: ['text', 'html'],
    },
  },
})
