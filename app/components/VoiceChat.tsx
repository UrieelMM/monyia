'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { AIMessage } from '../api/chat/route'

interface Message {
  id: string
  role: 'user' | 'model'
  text: string
}

type AppState = 'idle' | 'listening' | 'loading' | 'speaking'

const MicIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
  </svg>
)

const StopIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

const SpeakerIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
)

const BotIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A1.5 1.5 0 0 0 6 14.5 1.5 1.5 0 0 0 7.5 16 1.5 1.5 0 0 0 9 14.5 1.5 1.5 0 0 0 7.5 13m9 0A1.5 1.5 0 0 0 15 14.5a1.5 1.5 0 0 0 1.5 1.5 1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 16.5 13M22 14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v1h-2v-1H5v1H3v-1H2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h1v-1h2v1h14v-1h2v1h1z" />
  </svg>
)

export default function VoiceChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [appState, setAppState] = useState<AppState>('idle')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [error, setError] = useState('')
  const [inputText, setInputText] = useState('')
  const [speechSupported, setSpeechSupported] = useState(true)

  // Refs para evitar closures estales
  const messagesRef = useRef<Message[]>([])
  const appStateRef = useRef<AppState>('idle')
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Mantener refs sincronizados con el state
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  useEffect(() => {
    const SR =
      window.SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition })
        .webkitSpeechRecognition
    if (!SR) setSpeechSupported(false)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, appState])

  // Speak usa ref de state para no quedar desactualizado
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-ES'
    utterance.rate = 1.05
    utterance.pitch = 1.0

    const trySetVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      const esVoice = voices.find(
        (v) => v.lang.startsWith('es') && !v.name.toLowerCase().includes('compact')
      )
      if (esVoice) utterance.voice = esVoice
    }

    trySetVoice()
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = trySetVoice
    }

    utterance.onend = () => setAppState('idle')
    utterance.onerror = () => setAppState('idle')

    setAppState('speaking')
    window.speechSynthesis.speak(utterance)
  }, [])

  // sendMessage lee messagesRef para no capturar closures estales
  const sendMessage = useCallback(
    async (userText: string) => {
      const text = userText.trim()
      if (!text) return

      setError('')
      setLiveTranscript('')

      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text,
      }

      // Leer historial ANTES de agregar el nuevo mensaje
      const historySnapshot: AIMessage[] = messagesRef.current.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }))

      // Agregar el mensaje del usuario al estado
      setMessages((prev) => {
        const next = [...prev, userMsg]
        messagesRef.current = next
        return next
      })

      setAppState('loading')
      appStateRef.current = 'loading'

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: historySnapshot }),
        })

        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Error desconocido')

        const botMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: data.reply,
        }

        setMessages((prev) => {
          const next = [...prev, botMsg]
          messagesRef.current = next
          return next
        })

        speak(data.reply)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al conectar')
        setAppState('idle')
        appStateRef.current = 'idle'
      }
    },
    [speak]
  )

  const startListening = useCallback(() => {
    if (appStateRef.current !== 'idle') return

    const SR =
      window.SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition: typeof SpeechRecognition })
        .webkitSpeechRecognition

    if (!SR) {
      setError('Tu navegador no soporta reconocimiento de voz. Usa Chrome.')
      return
    }

    window.speechSynthesis.cancel()
    setLiveTranscript('')
    setError('')

    const recognition = new SR()
    recognition.lang = 'es-ES'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // Ref para guardar el transcript final sin depender de state
    let finalText = ''

    recognition.onstart = () => {
      setAppState('listening')
      appStateRef.current = 'listening'
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) final += t
        else interim += t
      }
      if (final) finalText = final
      setLiveTranscript(final || interim)
    }

    recognition.onend = () => {
      // Usar finalText (variable local, nunca stale) en lugar del state
      if (finalText.trim()) {
        sendMessage(finalText)
      } else {
        setAppState('idle')
        appStateRef.current = 'idle'
        setLiveTranscript('')
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`Error de micrófono: ${event.error}`)
      }
      setAppState('idle')
      appStateRef.current = 'idle'
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [sendMessage])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel()
    setAppState('idle')
  }, [])

  const handleMainButton = () => {
    if (appState === 'idle') startListening()
    else if (appState === 'listening') stopListening()
    else if (appState === 'speaking') stopSpeaking()
  }

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputText.trim() && appState === 'idle') {
      sendMessage(inputText)
      setInputText('')
    }
  }

  const stateConfig = {
    idle: {
      label: 'Toca para hablar',
      buttonClass: 'bg-cr-gold hover:bg-yellow-400 shadow-cr-gold/50',
      icon: <MicIcon className="w-10 h-10" />,
      ringClass: '',
    },
    listening: {
      label: 'Escuchando… toca para detener',
      buttonClass: 'bg-red-600 hover:bg-red-500 shadow-red-500/50',
      icon: <StopIcon className="w-10 h-10" />,
      ringClass: 'bg-red-500/30 animate-ping',
    },
    loading: {
      label: 'CoachRoyal está pensando…',
      buttonClass: 'bg-cr-purple cursor-wait shadow-purple-500/50',
      icon: (
        <svg className="w-10 h-10 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ),
      ringClass: '',
    },
    speaking: {
      label: 'CoachRoyal está hablando — toca para detener',
      buttonClass: 'bg-green-600 hover:bg-green-500 shadow-green-500/50',
      icon: <SpeakerIcon className="w-10 h-10" />,
      ringClass: 'bg-green-500/30 animate-ping',
    },
  }

  const current = stateConfig[appState]

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4 border-b border-cr-gold/30">
        <div className="relative">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cr-purple to-cr-blue flex items-center justify-center shadow-lg shadow-cr-purple/40">
            <BotIcon className="w-7 h-7 text-cr-gold" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-cr-darkblue" />
        </div>
        <div>
          <h1 className="text-cr-gold font-bold text-xl tracking-wide">CoachRoyal</h1>
          <p className="text-gray-400 text-xs">Tu entrenador de Clash Royale con IA</p>
        </div>
        <div className="ml-auto flex gap-1">
          {['👑', '⚔️', '🏆'].map((e) => (
            <span key={e} className="text-lg">{e}</span>
          ))}
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <div className="text-6xl">👑</div>
            <h2 className="text-cr-gold text-2xl font-bold">¡Bienvenido al campo de batalla!</h2>
            <p className="text-gray-400 max-w-sm">
              Soy <span className="text-cr-gold font-semibold">CoachRoyal</span>, tu experto en Clash Royale.
              Pregúntame sobre mazos, estrategias, counters o cómo subir trofeos.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-2">
              {[
                '¿Cuál es el mejor mazo meta ahora?',
                '¿Cómo counterseo al Golem?',
                '¿Qué mazo de ciclo me recomiendas?',
                'Dame tips para subir trofeos',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => appState === 'idle' && sendMessage(s)}
                  className="text-xs text-left bg-cr-darkpurple/50 border border-cr-purple/40 rounded-lg p-2 text-gray-300 hover:border-cr-gold/60 hover:text-cr-gold transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div
              className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold ${
                msg.role === 'user'
                  ? 'bg-cr-blue text-white'
                  : 'bg-gradient-to-br from-cr-purple to-cr-blue text-cr-gold'
              }`}
            >
              {msg.role === 'user' ? '⚔️' : <BotIcon className="w-5 h-5" />}
            </div>
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-cr-blue text-white rounded-tr-sm'
                  : 'bg-gradient-to-br from-cr-darkpurple to-gray-900 text-gray-100 border border-cr-purple/30 rounded-tl-sm'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {appState === 'loading' && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cr-purple to-cr-blue flex items-center justify-center">
              <BotIcon className="w-5 h-5 text-cr-gold" />
            </div>
            <div className="bg-gradient-to-br from-cr-darkpurple to-gray-900 border border-cr-purple/30 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-cr-gold rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-cr-gold rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-cr-gold rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-2 px-4 py-2 bg-red-900/40 border border-red-500/50 rounded-xl text-red-300 text-sm flex justify-between items-center">
          <span>⚠️ {error}</span>
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}

      {/* Transcript en tiempo real */}
      {liveTranscript && (
        <div className="mb-2 px-4 py-2 bg-cr-blue/20 border border-cr-blue/40 rounded-xl text-blue-200 text-sm italic">
          🎙️ &ldquo;{liveTranscript}&rdquo;
        </div>
      )}

      {/* Controles */}
      <div className="py-4 space-y-3">
        {speechSupported && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              {current.ringClass && (
                <span className={`absolute inset-0 rounded-full ${current.ringClass}`} />
              )}
              <button
                onClick={handleMainButton}
                disabled={appState === 'loading'}
                className={`relative w-20 h-20 rounded-full text-white shadow-xl transition-all duration-200 flex items-center justify-center ${current.buttonClass} disabled:opacity-60 disabled:cursor-not-allowed transform hover:scale-105 active:scale-95`}
              >
                {current.icon}
              </button>
            </div>
            <span className="text-gray-400 text-xs text-center">{current.label}</span>
          </div>
        )}

        <form onSubmit={handleTextSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="O escribe tu pregunta aquí…"
            disabled={appState !== 'idle'}
            className="flex-1 bg-gray-900/80 border border-gray-700 focus:border-cr-gold/60 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || appState !== 'idle'}
            className="px-4 py-2.5 bg-cr-gold text-gray-900 rounded-xl font-bold text-sm hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ➤
          </button>
        </form>

        {!speechSupported && (
          <p className="text-center text-yellow-500/80 text-xs">
            ⚠️ Tu navegador no soporta voz. Usa Chrome para el micrófono.
          </p>
        )}
      </div>
    </div>
  )
}
