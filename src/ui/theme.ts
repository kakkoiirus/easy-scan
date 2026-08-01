import { createTheme } from '@mantine/core'

/**
 * Mantine theme for easy-scan. Dark scheme is the default (set on
 * MantineProvider and on <html data-mantine-color-scheme="dark"> to avoid
 * flash). Primary color is Mantine's built-in `blue` (≈ #228be6), close to
 * the app's accent (#4f9dff used in the SVG icon).
 */
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
})
