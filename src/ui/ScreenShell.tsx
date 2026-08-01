import { Box, Title } from '@mantine/core'
import type { ReactNode } from 'react'

interface ScreenShellProps {
  title: string
  action?: ReactNode
  children: ReactNode
}

/** Common screen chrome: a sticky top bar with title + optional action. */
export function ScreenShell({ title, action, children }: ScreenShellProps) {
  return (
    <div className="screen">
      <div className="topbar">
        <Title order={5} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
          {title}
        </Title>
        {action != null && <div>{action}</div>}
      </div>
      <Box className="content">{children}</Box>
    </div>
  )
}
