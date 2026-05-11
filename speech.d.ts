// Declaraciones globales para la Web Speech API
// (no siempre incluida en todas las versiones de TypeScript DOM lib)

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }

  var SpeechRecognition: {
    new (): SpeechRecognition
    prototype: SpeechRecognition
  }

  interface SpeechRecognition extends EventTarget {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    start(): void
    stop(): void
    abort(): void
    onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onend: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    item(index: number): SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    item(index: number): SpeechRecognitionAlternative
    [index: number]: SpeechRecognitionAlternative
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }
}

export {}
