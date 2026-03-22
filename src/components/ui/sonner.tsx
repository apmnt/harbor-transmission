import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="top-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-none border border-border bg-card text-card-foreground shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-sm text-muted-foreground',
          actionButton:
            'rounded-none bg-primary text-primary-foreground hover:bg-primary/90',
          cancelButton:
            'rounded-none bg-secondary text-secondary-foreground hover:bg-secondary/80',
        },
      }}
      {...props}
    />
  )
}
