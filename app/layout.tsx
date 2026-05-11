import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MonyIA – Tu coach de Clash Royale',
  description: 'Habla con MonyIA, tu coach de IA para Clash Royale. Estrategias, mazos, counters y más.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
