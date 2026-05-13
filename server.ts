/**
 * Custom Next.js server con WebSocket proxy para Gemini Live API.
 * El browser se conecta a ws://localhost:3000/api/live
 * Este servidor hace proxy bidireccional a Gemini, manteniendo la API key segura.
 */

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

// Cargar .env.local manualmente (tsx no lo hace automáticamente)
try {
  const env = require('fs').readFileSync('.env.local', 'utf-8')
  env.split('\n').forEach((line: string) => {
    const [key, ...rest] = line.replace(/^#.*/, '').split('=')
    if (key?.trim()) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '')
    }
  })
} catch {}

const dev = process.env.NODE_ENV !== 'production'
// En Railway / Docker hay que escuchar en 0.0.0.0, no en localhost,
// porque Next usa este hostname también para callbacks internos.
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT ?? '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres MonyIA. Coach de Clash Royale. Sin filtros. Sin paciencia. Sin tiempo para pendejadas.

═══ QUIÉN TE HABLA ═══
Mony. MonyWTF. Streamer mexicana, YouTube desde 2014, Twitch, Instagram. Lleva años jugando Clash Royale, Fortnite, Free Fire y lo que se le ponga enfrente. No es principiante — trátala como alguien que sabe, pero eso no significa que no se merezca un regaño cuando diga algo malo.

═══ CÓMO CONSTRUYES CADA RESPUESTA — OBLIGATORIO ═══
Esto no es opcional. CADA respuesta que des debe seguir este patrón sin excepción:

PASO 1 — ATACA PRIMERO.
Antes de dar cualquier información, suelta un golpe. Un comentario ácido, sarcástico o agresivo sobre lo que dijo. Ejemplos reales de cómo hablas:
- "No manches, ¿en serio me estás preguntando eso?"
- "Ay cabrón... ¿cuánto llevas jugando, tres días?"
- "Dios mío de mi vida, ese mazo es un crimen contra la humanidad"
- "Wow. WOW. No, en serio, WOW. ¿Quién te dijo que eso era buena idea?"
- "Mira, te lo digo con todo el amor del mundo: eso que hiciste estuvo horrible"
- "¿Estás bromeando? Dime que estás bromeando."
- "Ese mazo no es un mazo, es una declaración de rendición anticipada"
- "Literalmente cualquier bot random te gana con eso, ¿sabes?"

PASO 2 — HUMILLA LA JUGADA/IDEA (si aplica).
Si mencionó un mazo malo, una jugada pésima o una pregunta obvia — exagera lo malo con comparaciones ridículas:
- "Tu Golem llegando solo es como mandar un tanque sin gasolina a la guerra"
- "Eso que describes ni en arena 1 funciona, y en arena 1 juegan niños de 6 años"
- "Usar esa carta en este meta es como llevar paraguas al desierto"

PASO 3 — DA EL CONSEJO CORRECTO.
Ahora sí, dale lo que necesita. Claro, directo, preciso. Tú sabes TODO de Clash Royale: cartas, estadísticas, sinergias, meta actual, counters, elixir, timing, split push, bridge spam, LavaLoon, ciclo 2.6, log bait, siege, beatdown, control. TODO.

PASO 4 — CIERRA CON ACTITUD.
Termina con una frase corta que mantenga el tono. Algo como:
- "De nada, crack. Ya aprende."
- "Ahora sí ve a ganar, que ya me diste cringe suficiente."
- "¿Entendiste o te lo tatúo?"
- "No me falles, ¿sí? Ya di mucho de mí."

═══ VOCABULARIO QUE USAS — siempre ═══
ay cabrón / no manches / chale / híjole / dios mío / pinche / qué oso / me cae / a webo / órale / nel / simón / nel pastel / chido / neta / wey/güey / chamba

═══ REGLAS DE VOZ — no negociables ═══
- Respuestas CORTAS. 20-40 segundos hablados máximo. Nada de listas infinitas.
- Los mazos los dices hablado, natural: "log bait clásico: barril, princesa, caballero, pandilla, spirit de hielo, tronco, cohete y torre infernal, 3.3 promedio"
- Haz una pregunta al final para que la conversación siga viva
- SIEMPRE en español. Tono mexicano. Cero formalidades. Cero "estimado usuario".`

// ─── Mensaje de config inicial para Gemini Live (según docs oficiales) ───────
// Estructura mínima de https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
// Si Gemini rechaza con campos extra (speechConfig, transcriptions, etc.) los
// vamos agregando uno a uno luego de confirmar que el mínimo funciona.
// La API real de Bidi rechaza `config` como key raíz ("Unknown name 'config'").
// La key correcta es `setup` (la doc del cliente JS/Python de google-genai usa
// `config` como atajo de la SDK, pero a nivel WebSocket protobuf se llama `setup`).
//
// Modelo: gemini-2.0-flash-live-001 — half-cascade Live, el más estable y
// mejor documentado. Acepta el formato canónico `realtimeInput.mediaChunks`
// que enviamos desde el cliente.
const buildGeminiSetup = () =>
  JSON.stringify({
    setup: {
      model: 'models/gemini-3.1-flash-live-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  })

// ─── Rate limiting ────────────────────────────────────────────────────────────
const MAX_CONCURRENT   = 5   // sesiones simultáneas máximas en total
const MAX_PER_IP       = 2   // sesiones simultáneas máximas por IP
const MAX_PER_MINUTE   = 8   // conexiones nuevas por IP por minuto

interface IpRecord { active: number; timestamps: number[] }
const ipMap = new Map<string, IpRecord>()
let totalActive = 0

function getIp( req: import('http').IncomingMessage ): string {
  const forwarded = req.headers['x-forwarded-for']
  if ( typeof forwarded === 'string' ) return forwarded.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function checkRateLimit( ip: string ): string | null {
  if ( totalActive >= MAX_CONCURRENT ) return 'Demasiadas sesiones activas. Intenta en un momento.'
  const now   = Date.now()
  const entry = ipMap.get(ip) ?? { active: 0, timestamps: [] }
  // Limpiar timestamps fuera de la ventana de 1 min
  entry.timestamps = entry.timestamps.filter( t => now - t < 60_000 )
  if ( entry.active >= MAX_PER_IP ) return 'Ya tienes una sesión activa.'
  if ( entry.timestamps.length >= MAX_PER_MINUTE ) return 'Demasiadas conexiones recientes. Espera un momento.'
  return null
}

function trackConnect( ip: string ) {
  totalActive++
  const entry = ipMap.get(ip) ?? { active: 0, timestamps: [] }
  entry.active++
  entry.timestamps.push( Date.now() )
  ipMap.set(ip, entry)
}

function trackDisconnect( ip: string ) {
  totalActive = Math.max(0, totalActive - 1)
  const entry = ipMap.get(ip)
  if ( entry ) {
    entry.active = Math.max(0, entry.active - 1)
    if ( entry.active === 0 && entry.timestamps.length === 0 ) ipMap.delete(ip)
    else ipMap.set(ip, entry)
  }
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url!, true)
    await handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextUpgradeHandler = (app as any).getUpgradeHandler?.()

  server.on('upgrade', async (request, socket, head) => {
    const { pathname } = parse(request.url ?? '/')
    if (pathname === '/api/live') {
      wss.handleUpgrade(request, socket as never, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else if (nextUpgradeHandler) {
      await nextUpgradeHandler(request, socket, head)
    }
  })

  wss.on('connection', (clientWs, request) => {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      clientWs.send(JSON.stringify({ error: 'API_KEY no está configurada en .env.local' }))
      clientWs.close()
      return
    }

    // ── Rate limiting ──────────────────────────────────────────────────────
    const ip = getIp(request)
    const limitError = checkRateLimit(ip)
    if (limitError) {
      clientWs.send(JSON.stringify({ error: limitError }))
      clientWs.close()
      return
    }
    trackConnect(ip)

    const geminiUrl =
      `wss://generativelanguage.googleapis.com/ws/` +
      `google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` +
      `?key=${apiKey}`

    const geminiWs = new WebSocket(geminiUrl, {
      headers: { 'Content-Type': 'application/json' },
    })

    geminiWs.on('open', () => {
      geminiWs.send(buildGeminiSetup())
    })

    geminiWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString())
      }
    })

    clientWs.on('message', (data) => {
      const text = data.toString()
      // ── Ping/pong: responder directamente sin reenviar a la IA ────────────
      try {
        const parsed = JSON.parse(text)
        if (parsed?.ping !== undefined) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ pong: parsed.ping }))
          }
          return
        }
      } catch { /* no era JSON */ }

      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(text)
      }
    })

    const cleanup = () => {
      trackDisconnect(ip)
      if (geminiWs.readyState < WebSocket.CLOSING) geminiWs.close()
      if (clientWs.readyState < WebSocket.CLOSING) clientWs.close()
    }

    clientWs.on('close', cleanup)
    geminiWs.on('close', cleanup)
    clientWs.on('error', cleanup)
    geminiWs.on('error', cleanup)
  })

  server.listen(port, '0.0.0.0', () => {
    console.log(`MonyIA lista en http://0.0.0.0:${port}`)
  })
}).catch(() => process.exit(1))
