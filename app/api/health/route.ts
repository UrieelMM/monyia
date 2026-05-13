// Endpoint mínimo para healthcheck de Railway / cualquier balanceador.
// Devuelve 200 inmediatamente, sin tocar Next.js rendering ni dependencias externas.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
  return new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}
