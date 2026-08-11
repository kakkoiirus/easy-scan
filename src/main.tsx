import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { theme } from './ui/theme'
import { UpdatePrompt } from './update-prompt/useUpdatePrompt'
import './ui/styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {/* Top-center clears the sticky top bar's title/actions and the bottom
          capture controls, so scanning isn't obstructed (app-update spec). */}
      <Notifications position="top-center" />
      {/* Mounts the service-worker update prompt once, at the App root, inside
          the notifications context. Renders nothing itself. */}
      <UpdatePrompt />
      <App />
    </MantineProvider>
  </StrictMode>,
)
