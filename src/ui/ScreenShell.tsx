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
      <header className="topbar">
        <h1 className="topbar__title">{title}</h1>
        {action != null && <div className="topbar__action">{action}</div>}
      </header>
      <main className="content">{children}</main>
    </div>
  )
}
