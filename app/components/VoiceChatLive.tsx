'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Status = 'disconnected' | 'connecting' | 'ready' | 'listening' | 'speaking';

interface AIServerMessage {
  error?: string | { message?: string; code?: number; status?: string; };
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: {
      parts: Array<{
        text?: string;
        inlineData?: { data: string; mimeType: string; };
      }>;
    };
    inputTranscription?: { text: string; };
    outputTranscription?: { text: string; };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
}

// ─── Audio utils ──────────────────────────────────────────────────────────────

function float32ToBase64Pcm( float32: Float32Array ): string {
  const int16 = new Int16Array( float32.length );
  for ( let i = 0; i < float32.length; i++ ) {
    const s = Math.max( -1, Math.min( 1, float32[ i ] ) );
    int16[ i ] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array( int16.buffer );
  let binary = '';
  for ( let i = 0; i < bytes.byteLength; i++ ) binary += String.fromCharCode( bytes[ i ] );
  return btoa( binary );
}

function base64PcmToFloat32( base64: string ): Float32Array {
  const binary = atob( base64 );
  const bytes = new Uint8Array( binary.length );
  for ( let i = 0; i < binary.length; i++ ) bytes[ i ] = binary.charCodeAt( i );
  const int16 = new Int16Array( bytes.buffer );
  const float32 = new Float32Array( int16.length );
  for ( let i = 0; i < int16.length; i++ ) {
    float32[ i ] = int16[ i ] / ( int16[ i ] < 0 ? 0x8000 : 0x7fff );
  }
  return float32;
}

// ─── Íconos ───────────────────────────────────────────────────────────────────

const MicIcon = ( { className }: { className?: string; } ) => (
  <svg className={ className } viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
  </svg>
);

const StopIcon = ( { className }: { className?: string; } ) => (
  <svg className={ className } viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const BotIcon = ( { className }: { className?: string; } ) => (
  <svg className={ className } viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A1.5 1.5 0 0 0 6 14.5 1.5 1.5 0 0 0 7.5 16 1.5 1.5 0 0 0 9 14.5 1.5 1.5 0 0 0 7.5 13m9 0A1.5 1.5 0 0 0 15 14.5a1.5 1.5 0 0 0 1.5 1.5 1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 16.5 13M22 14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v1h-2v-1H5v1H3v-1H2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h1v-1h2v1h14v-1h2v1h1z" />
  </svg>
);

// Barras de onda animadas
function AudioBars( { active, color }: { active: boolean; color: string; } ) {
  return (
    <div className="flex items-end gap-[3px] h-7">
      { [ 0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.9 ].map( ( h, i ) => (
        <div
          key={ i }
          className={ `w-1 rounded-full ${ color } transition-all` }
          style={ {
            height: active ? `${ h * 100 }%` : '20%',
            animation: active ? `wave 0.9s ease-in-out infinite` : 'none',
            animationDelay: `${ i * 0.1 }s`,
          } }
        />
      ) ) }
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function VoiceChatLive() {
  const [ status, setStatus ] = useState<Status>( 'disconnected' );
  const [ error, setError ] = useState( '' );
  const [ waveTick, setWaveTick ] = useState( 0 );
  const [ pipActive, setPipActive ] = useState( false );
  const [ pingMs, setPingMs ] = useState<number | null>( null );        // calidad conexión
  const [ reconnectAttempt, setReconnectAttempt ] = useState( 0 );      // intento auto-reconexión

  const wsRef = useRef<WebSocket | null>( null );
  const inputCtxRef = useRef<AudioContext | null>( null );
  const outputCtxRef = useRef<AudioContext | null>( null );
  const processorRef = useRef<ScriptProcessorNode | null>( null );
  const streamRef = useRef<MediaStream | null>( null );
  const nextPlayRef = useRef( 0 );
  const isListeningRef = useRef( false );
  const statusRef = useRef<Status>( 'disconnected' );
  // Todos los AudioBufferSourceNodes activos — para pararlos en interrupt
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>( [] );
  // Auto-reconexión
  const isManualDisconnectRef = useRef( false );
  const reconnectCountRef = useRef( 0 );
  const hasConnectedRef = useRef( false );
  // Ping/pong para medir latencia
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>( null );
  const pingTimestampRef = useRef( 0 );

  // Refs para visualización Siri-orb + PiP
  const analyserInRef = useRef<AnalyserNode | null>( null );
  const analyserOutRef = useRef<AnalyserNode | null>( null );
  const canvasRef = useRef<HTMLCanvasElement>( null );
  const videoRef = useRef<HTMLVideoElement>( null );

  useEffect( () => { statusRef.current = status; }, [ status ] );

  // Animar barras mientras está activo
  useEffect( () => {
    if ( status !== 'listening' && status !== 'speaking' ) return;
    const id = setInterval( () => setWaveTick( ( t ) => t + 1 ), 200 );
    return () => clearInterval( id );
  }, [ status ] );

  // ── Reproducir chunk PCM de la IA (24kHz) ──────────────────────────────
  const playChunkCountRef = useRef( 0 );
  const playChunk = useCallback( ( base64: string, mimeType?: string ) => {
    if ( !outputCtxRef.current ) {
      outputCtxRef.current = new AudioContext( { sampleRate: 24000 } );
    }
    const ctx = outputCtxRef.current;
    if ( ctx.state === 'suspended' ) {
      ctx.resume();
    }

    const float32 = base64PcmToFloat32( base64 );

    let rate = 24000;
    if ( mimeType ) {
      const m = /rate=(\d+)/.exec( mimeType );
      if ( m ) rate = parseInt( m[ 1 ], 10 );
    }

    playChunkCountRef.current++;

    const buf = ctx.createBuffer( 1, float32.length, rate );
    buf.getChannelData( 0 ).set( float32 );

    // Analyser de salida para que el orbe pulse cuando habla Gemini.
    if ( !analyserOutRef.current ) {
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.6;
      an.connect( ctx.destination );
      analyserOutRef.current = an;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect( analyserOutRef.current );

    // Registrar source activo; eliminarlo de la lista cuando termine
    activeSourcesRef.current.push( src );
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter( ( s ) => s !== src );
    };

    const now = ctx.currentTime;
    const at = Math.max( nextPlayRef.current, now + 0.02 );
    src.start( at );
    nextPlayRef.current = at + buf.duration;
  }, [] );

  // ── Manejar mensajes del proxy ───────────────────────────────────────────
  const handleMessage = useCallback(
    ( raw: string ) => {
      // Respuesta de ping — medir RTT y salir
      try {
        const quick = JSON.parse( raw );
        if ( quick?.pong !== undefined ) {
          setPingMs( Date.now() - quick.pong );
          return;
        }
      } catch { return; }

      let msg: AIServerMessage;
      try { msg = JSON.parse( raw ); } catch { return; }

      if ( msg.error ) {
        const errText = typeof msg.error === 'string'
          ? msg.error
          : ( msg.error.message ?? JSON.stringify( msg.error ) );
        setError( errText );
        setStatus( 'disconnected' );
        return;
      }

      if ( msg.setupComplete ) {
        setStatus( 'ready' );
        return;
      }

      if ( !msg.serverContent ) return;
      const { modelTurn, turnComplete, interrupted } = msg.serverContent;

      if ( interrupted ) {
        // Parar TODOS los sources ya agendados — sin esto el audio anterior
        // sigue sonando encima de la nueva respuesta (audio duplicado).
        activeSourcesRef.current.forEach( ( src ) => {
          try { src.stop(); } catch { /* ya terminó */ }
        } );
        activeSourcesRef.current = [];
        nextPlayRef.current = outputCtxRef.current?.currentTime ?? 0;
        if ( isListeningRef.current ) setStatus( 'listening' );
        return;
      }

      if ( modelTurn?.parts?.length ) {
        setStatus( 'speaking' );
        for ( const part of modelTurn.parts ) {
          if ( part.inlineData?.mimeType.startsWith( 'audio/' ) ) {
            playChunk( part.inlineData.data, part.inlineData.mimeType );
          }
        }
      }

      if ( turnComplete ) {
        setStatus( isListeningRef.current ? 'listening' : 'ready' );
      }
    },
    [ playChunk ]
  );

  // ── Conectar al proxy WebSocket ──────────────────────────────────────────
  const connect = useCallback( () => {
    if ( wsRef.current ) return;
    isManualDisconnectRef.current = false;
    setError( '' );
    setStatus( 'connecting' );

    const wsUrl = `${ location.protocol === 'https:' ? 'wss' : 'ws' }://${ location.host }/api/live`;

    let ws: WebSocket;
    try {
      ws = new WebSocket( wsUrl );
    } catch ( e ) {
      setError( `No se pudo crear el WebSocket: ${ ( e as Error ).message }` );
      setStatus( 'disconnected' );
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      hasConnectedRef.current = true;
      reconnectCountRef.current = 0;
      setReconnectAttempt( 0 );

      // Fallback: si setupComplete no llega en 3s, marcar listo igual
      setTimeout( () => {
        if ( wsRef.current?.readyState === WebSocket.OPEN && statusRef.current === 'connecting' ) {
          setStatus( 'ready' );
        }
      }, 3000 );

      // Ping cada 3 s para medir latencia
      pingIntervalRef.current = setInterval( () => {
        if ( wsRef.current?.readyState === WebSocket.OPEN ) {
          pingTimestampRef.current = Date.now();
          wsRef.current.send( JSON.stringify( { ping: pingTimestampRef.current } ) );
        }
      }, 3000 );
    };

    ws.onmessage = ( e ) => handleMessage( e.data as string );

    ws.onerror = () => {
      setError( 'No se pudo conectar al servidor. ¿Está corriendo npm run dev?' );
      setStatus( 'disconnected' );
      wsRef.current = null;
    };

    ws.onclose = () => {
      // Limpiar ping interval
      if ( pingIntervalRef.current ) {
        clearInterval( pingIntervalRef.current );
        pingIntervalRef.current = null;
      }
      setPingMs( null );
      setStatus( 'disconnected' );
      wsRef.current = null;
      isListeningRef.current = false;
    };
  }, [ handleMessage ] );

  // ── Auto-reconexión ─────────────────────────────────────────────────────
  // Se activa cuando el WS cae solo (no por el usuario), hasta 5 intentos
  useEffect( () => {
    if ( status !== 'disconnected' ) return;
    if ( !hasConnectedRef.current ) return;       // nunca conectado → no reconectar
    if ( isManualDisconnectRef.current ) return;  // fue el usuario → no reconectar
    if ( reconnectCountRef.current >= 5 ) return; // límite alcanzado

    reconnectCountRef.current += 1;
    setReconnectAttempt( reconnectCountRef.current );
    const delay = Math.min( 1000 * Math.pow( 2, reconnectCountRef.current - 1 ), 16000 );

    const timer = setTimeout( () => { connect(); }, delay );
    return () => clearTimeout( timer );
  }, [ status, connect ] );

  // ── Iniciar micrófono ────────────────────────────────────────────────────
  const startListening = useCallback( async () => {
    if ( !wsRef.current || isListeningRef.current ) return;
    setError( '' );

    if ( !outputCtxRef.current ) {
      outputCtxRef.current = new AudioContext( { sampleRate: 24000 } );
    }
    if ( outputCtxRef.current.state === 'suspended' ) {
      await outputCtxRef.current.resume();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia( {
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      } );
      streamRef.current = stream;

      if ( !inputCtxRef.current || inputCtxRef.current.state === 'closed' ) {
        inputCtxRef.current = new AudioContext( { sampleRate: 16000 } );
      }
      const ctx = inputCtxRef.current;
      if ( ctx.state === 'suspended' ) await ctx.resume();

      const source = ctx.createMediaStreamSource( stream );

      // Analyser en paralelo: para que el orbe reaccione al volumen del mic.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect( analyser );
      analyserInRef.current = analyser;

      const processor = ctx.createScriptProcessor( 4096, 1, 1 );

      let chunkN = 0;
      processor.onaudioprocess = ( e ) => {
        if ( !isListeningRef.current || wsRef.current?.readyState !== WebSocket.OPEN ) return;
        const channel = e.inputBuffer.getChannelData( 0 );

        // RMS para detectar si realmente hay voz o solo silencio
        let sum = 0;
        for ( let i = 0; i < channel.length; i++ ) sum += channel[ i ] * channel[ i ];
        const rms = Math.sqrt( sum / channel.length );

        chunkN++;
        const pcm = float32ToBase64Pcm( channel );
        wsRef.current.send(
          JSON.stringify( {
            realtimeInput: {
              audio: { data: pcm, mimeType: 'audio/pcm;rate=16000' },
            },
          } )
        );
      };

      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      source.connect( processor );
      processor.connect( silentGain );
      silentGain.connect( ctx.destination );

      processorRef.current = processor;
      isListeningRef.current = true;
      setStatus( 'listening' );
    } catch {
      setError( 'No se pudo acceder al micrófono. Verifica los permisos en Chrome.' );
    }
  }, [] );

  // ── Detener micrófono ────────────────────────────────────────────────────
  const stopListening = useCallback( () => {
    isListeningRef.current = false;

    if ( wsRef.current?.readyState === WebSocket.OPEN ) {
      wsRef.current.send( JSON.stringify( { realtimeInput: { audioStreamEnd: true } } ) );
    }

    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach( ( t ) => t.stop() );
    streamRef.current = null;
    // Resetear analyser de entrada para que no quede ligado al ctx cerrado
    analyserInRef.current = null;
    if ( statusRef.current === 'listening' ) setStatus( 'ready' );
  }, [] );

  // ── Desconectar todo ─────────────────────────────────────────────────────
  const disconnect = useCallback( () => {
    // Marcar desconexión manual para que auto-reconexión no se active
    isManualDisconnectRef.current = true;
    reconnectCountRef.current = 0;
    setReconnectAttempt( 0 );
    // Limpiar ping interval
    if ( pingIntervalRef.current ) {
      clearInterval( pingIntervalRef.current );
      pingIntervalRef.current = null;
    }
    setPingMs( null );
    stopListening();
    wsRef.current?.close();
    wsRef.current = null;
    activeSourcesRef.current.forEach( ( src ) => { try { src.stop(); } catch { /* ya terminó */ } } );
    activeSourcesRef.current = [];
    outputCtxRef.current?.close().catch( () => { } );
    outputCtxRef.current = null;
    inputCtxRef.current?.close().catch( () => { } );
    inputCtxRef.current = null;
    analyserOutRef.current = null;
    analyserInRef.current = null;
    nextPlayRef.current = 0;
    setStatus( 'disconnected' );
  }, [ stopListening ] );

  useEffect( () => () => { disconnect(); }, [ disconnect ] );

  // ─── Animation loop del orbe Siri ─────────────────────────────────────────
  useEffect( () => {
    const canvas = canvasRef.current;
    if ( !canvas ) return;
    const ctx = canvas.getContext( '2d' );
    if ( !ctx ) return;

    let raf = 0;
    let smoothAmp = 0;
    const data = new Uint8Array( 128 );

    // Paleta tipo Siri: rosa, morado, cyan, dorado, azul. Mismo set en
    // cualquier estado activo, solo cambia el tono dominante.
    const palettes: Record<Status, string[]> = {
      disconnected: [ '#475569', '#334155', '#1e293b', '#0f172a' ],
      connecting: [ '#fbbf24', '#f59e0b', '#fde68a', '#fef3c7', '#a16207' ],
      ready: [ '#FF3399', '#9B59FF', '#00D9FF', '#F5C542', '#3366FF' ],
      listening: [ '#ef4444', '#f97316', '#ec4899', '#fbbf24', '#dc2626' ],
      speaking: [ '#00D9FF', '#3366FF', '#9B59FF', '#06b6d4', '#FF3399' ],
    };

    // 6 blobs orbitando: [velocidad, fase inicial, radio orbital, tamaño]
    // Velocidades distintas + algunos en sentido contrario → flujo orgánico.
    const orbits: Array<[ number, number, number, number ]> = [
      [ 0.40, 0.00, 0.00, 0.55 ],  // núcleo casi fijo
      [ 0.65, 1.10, 0.20, 0.45 ],
      [ -0.55, 2.50, 0.26, 0.42 ],
      [ 0.85, 4.00, 0.32, 0.38 ],
      [ -1.00, 5.50, 0.38, 0.32 ],
      [ 0.45, 0.50, 0.16, 0.50 ],
    ];

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const t = performance.now() / 1000;

      // Amplitud RMS del analyser activo + suavizado exponencial
      let target = 0;
      const s = statusRef.current;
      const an = s === 'speaking' ? analyserOutRef.current
        : s === 'listening' ? analyserInRef.current
          : null;
      if ( an ) {
        an.getByteTimeDomainData( data );
        let sum = 0;
        for ( let i = 0; i < data.length; i++ ) sum += Math.abs( data[ i ] - 128 );
        target = Math.min( 1, ( sum / data.length ) / 50 );
      }
      smoothAmp = smoothAmp * 0.85 + target * 0.15;

      // Breathing idle: pulso suave aunque no haya audio
      const idlePulse = ( Math.sin( t * 0.7 ) + 1 ) * 0.5 * 0.08;
      const amp = Math.max( smoothAmp, idlePulse );

      const colors = palettes[ s ];

      // Fondo oscuro (canvas es rounded-full, así que llenar cuadrado está OK)
      ctx.fillStyle = '#0F172A';
      ctx.fillRect( 0, 0, w, h );

      ctx.save();
      ctx.translate( w / 2, h / 2 );

      const baseR = Math.min( w, h ) * 0.42;

      // 1) Aura atmosférica (sin blur, gradiente base)
      const atm = ctx.createRadialGradient( 0, 0, 0, 0, 0, baseR * 1.1 );
      atm.addColorStop( 0, colors[ 0 ] + '33' );
      atm.addColorStop( 0.45, colors[ 1 ] + '1a' );
      atm.addColorStop( 0.85, colors[ 2 % colors.length ] + '0d' );
      atm.addColorStop( 1, '#00000000' );
      ctx.fillStyle = atm;
      ctx.fillRect( -w / 2, -h / 2, w, h );

      // 2) Blobs líquidos: blur fuerte + blend aditivo → efecto plasma Siri
      ctx.filter = 'blur(28px)';
      ctx.globalCompositeOperation = 'lighter';

      for ( let i = 0; i < orbits.length; i++ ) {
        const [ sp, ang0, rad, sz ] = orbits[ i ];
        const ang = ang0 + t * sp;
        const breath = Math.sin( t * 0.5 + i * 1.7 ) * 0.04;
        const orbR = baseR * ( rad + breath ) + amp * baseR * 0.25;
        const x = Math.cos( ang ) * orbR;
        const y = Math.sin( ang ) * orbR;
        const bR = baseR * sz * ( 1 + amp * 0.45 );
        const c = colors[ i % colors.length ];

        const g = ctx.createRadialGradient( x, y, 0, x, y, bR );
        g.addColorStop( 0, c + 'b3' );
        g.addColorStop( 0.4, c + '55' );
        g.addColorStop( 1, c + '00' );
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc( x, y, bR, 0, Math.PI * 2 );
        ctx.fill();
      }

      // Reset filter y composite
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';

      // 3) Highlight especular tipo cristal (esquina superior izquierda)
      const shineX = -baseR * 0.22;
      const shineY = -baseR * 0.28;
      const shine = ctx.createRadialGradient( shineX, shineY, 0, shineX, shineY, baseR * 0.85 );
      const shineAlpha = 0.12 + amp * 0.18;
      shine.addColorStop( 0, `rgba(255,255,255,${ shineAlpha })` );
      shine.addColorStop( 0.5, `rgba(255,255,255,${ shineAlpha * 0.3 })` );
      shine.addColorStop( 1, 'rgba(255,255,255,0)' );
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc( 0, 0, baseR * 0.95, 0, Math.PI * 2 );
      ctx.fill();

      // 4) Anillo exterior pulsante cuando hay actividad fuerte
      if ( smoothAmp > 0.12 ) {
        ctx.strokeStyle = colors[ 0 ] + Math.floor( Math.min( 255, smoothAmp * 220 ) ).toString( 16 ).padStart( 2, '0' );
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc( 0, 0, baseR * 0.95 + Math.sin( t * 6 ) * 3, 0, Math.PI * 2 );
        ctx.stroke();
      }

      ctx.restore();

      raf = requestAnimationFrame( draw );
    };
    draw();

    return () => cancelAnimationFrame( raf );
  }, [] );

  // ─── Picture-in-Picture ───────────────────────────────────────────────────
  const togglePiP = useCallback( async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if ( !video || !canvas ) return;

    try {
      if ( document.pictureInPictureElement ) {
        await document.exitPictureInPicture();
        return;
      }
      if ( !video.srcObject ) {
        const stream = canvas.captureStream( 30 );
        video.srcObject = stream;
        await video.play();
      }
      await video.requestPictureInPicture();
      setPipActive( true );
    } catch {
      setError( 'Tu navegador no soporta Picture-in-Picture o lo bloqueó.' );
    }
  }, [] );

  // Sincronizar estado pipActive con el evento del DOM
  useEffect( () => {
    const v = videoRef.current;
    if ( !v ) return;
    const onLeave = () => setPipActive( false );
    const onEnter = () => setPipActive( true );
    v.addEventListener( 'leavepictureinpicture', onLeave );
    v.addEventListener( 'enterpictureinpicture', onEnter );
    return () => {
      v.removeEventListener( 'leavepictureinpicture', onLeave );
      v.removeEventListener( 'enterpictureinpicture', onEnter );
    };
  }, [] );

  // ── Atajo de teclado: barra espaciadora activa/desactiva micrófono ──────
  useEffect( () => {
    const onKey = ( e: KeyboardEvent ) => {
      if ( e.code !== 'Space' ) return;
      // Ignorar si el foco está en un input (ej. PIN gate)
      if ( e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement ) return;
      e.preventDefault();
      const s = statusRef.current;
      if ( s === 'ready' ) startListening();
      else if ( s === 'listening' ) stopListening();
    };
    window.addEventListener( 'keydown', onKey );
    return () => window.removeEventListener( 'keydown', onKey );
  }, [ startListening, stopListening ] );

  // ─── Render ───────────────────────────────────────────────────────────────

  const isConnected = status !== 'disconnected' && status !== 'connecting';

  const isReconnecting = status === 'disconnected' && reconnectAttempt > 0 && !isManualDisconnectRef.current;

  const statusLabel: Record<Status, string> = {
    disconnected: isReconnecting
      ? `Reconectando… (intento ${ reconnectAttempt }/5)`
      : 'Desconectado',
    connecting: 'Conectando con MonyIA…',
    ready: 'Listo — pulsa espacio o el mic para hablar',
    listening: 'Escuchando… (espacio para detener)',
    speaking: 'MonyIA está respondiendo…',
  };

  // Calidad de conexión basada en RTT del ping
  const pingColor = pingMs === null ? ''
    : pingMs < 150  ? 'text-emerald-400'
    : pingMs < 400  ? 'text-yellow-400'
    : 'text-red-400';
  const pingLabel = pingMs === null ? null
    : pingMs < 150  ? `${ pingMs }ms · Excelente`
    : pingMs < 400  ? `${ pingMs }ms · Regular`
    : `${ pingMs }ms · Malo`;

  const statusColor: Record<Status, string> = {
    disconnected: 'text-gray-500',
    connecting: 'text-yellow-400',
    ready: 'text-green-400',
    listening: 'text-red-400',
    speaking: 'text-blue-400',
  };

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto px-5 relative">

      {/* ── Glow ambiental de fondo ── */ }
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      {/* ── Header ── */ }
      <div className="flex items-center justify-between pt-6 pb-2">
        <div className="flex items-center gap-3">
          {/* Logo pill */ }
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl px-4 py-2 shadow-lg shadow-black/20">
            <span className={ `w-2 h-2 rounded-full flex-shrink-0 transition-all ${ isConnected ? 'bg-emerald-400 shadow-emerald-400/60 shadow-sm animate-pulse' : isReconnecting ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600' }` } />
            <span className="text-white font-bold text-sm tracking-wider">Mony<span className="text-fuchsia-400">IA</span></span>
          </div>
          {/* Indicador de calidad de conexión */ }
          { pingLabel && (
            <span className={ `text-[10px] font-medium ${ pingColor } bg-white/5 border border-white/10 rounded-xl px-2 py-1` }>
              { pingLabel }
            </span>
          ) }
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={ togglePiP }
            title={ pipActive ? 'Cerrar Picture in Picture' : 'Abrir Picture in Picture' }
            className={ `text-xs border rounded-xl px-3 py-1.5 transition-all backdrop-blur-sm font-medium ${ pipActive
              ? 'text-fuchsia-300 border-fuchsia-500/60 bg-fuchsia-500/15'
              : 'text-gray-400 border-white/10 bg-white/5 hover:border-fuchsia-500/40 hover:text-fuchsia-300'
              }` }
          >
            { pipActive ? '⊞ Picture in Picture activo' : '⊞ Picture in Picture' }
          </button>
          { isConnected && (
            <button
              onClick={ disconnect }
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 rounded-xl px-3 py-1.5 transition-all backdrop-blur-sm font-medium"
            >
              Colgar
            </button>
          ) }
        </div>
      </div>

      {/* Video oculto para PiP */ }
      <video
        ref={ videoRef }
        muted
        playsInline
        className="absolute -top-[9999px] -left-[9999px] w-1 h-1 opacity-0 pointer-events-none"
      />

      {/* ── Orbe central ── */ }
      <div className="flex-1 flex flex-col items-center justify-center gap-6">

        {/* Orbe Siri */ }
        <div className="relative flex items-center justify-center">
          <canvas
            ref={ canvasRef }
            width={ 480 }
            height={ 480 }
            className="w-72 h-72 rounded-full"
          />
        </div>

        {/* Card de estado glassmorphism */ }
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl px-6 py-4 text-center shadow-xl shadow-black/30 min-w-[220px]">
          <p className={ `text-sm font-semibold tracking-wide transition-colors ${ statusColor[ status ] }` }>
            { statusLabel[ status ] }
          </p>
          { status === 'listening' && (
            <div className="flex justify-center mt-3">
              <AudioBars active color="bg-red-400" key={ waveTick } />
            </div>
          ) }
        </div>

        {/* CTA conectar */ }
        { status === 'disconnected' && (
          <button
            onClick={ connect }
            className="group relative px-10 py-4 rounded-2xl font-bold text-sm tracking-wide text-white overflow-hidden transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg"
            style={ { background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f59e0b 100%)' } }
          >
            <span className="relative z-10 flex items-center gap-2">
              <span className="text-base">⚡</span> Iniciar conversación con MonyIA
            </span>
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ) }
      </div>

      {/* ── Error ── */ }
      { error && (
        <div className="mb-3 px-4 py-3 bg-red-950/60 backdrop-blur-sm border border-red-500/30 rounded-2xl text-red-300 text-xs flex justify-between items-center gap-2 shadow-lg">
          <span className="flex items-center gap-2"><span>⚠️</span>{ error }</span>
          <button onClick={ () => setError( '' ) } className="text-red-400 hover:text-red-200 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-500/20">✕</button>
        </div>
      ) }


      {/* ── Footer fijo al fondo ── */ }
      <div className="fixed bottom-0 left-0 right-0 pb-3 text-center pointer-events-none z-50">
        <p className="text-gray-700 text-[11px] tracking-wide">
          Hecho para Mony por urieel ❤️
        </p>
      </div>

      {/* ── Botón mic ── */ }
      { isConnected && (
        <div className="py-8 flex flex-col items-center gap-3">
          <div className="relative">
            { status === 'listening' && (
              <>
                <span className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
                <span className="absolute -inset-3 rounded-full bg-red-500/10 animate-ping" style={ { animationDelay: '0.15s' } } />
              </>
            ) }
            <button
              onClick={ status === 'listening' ? stopListening : startListening }
              disabled={ status === 'speaking' }
              className={ `relative w-20 h-20 rounded-full text-white shadow-2xl transition-all duration-200 flex items-center justify-center transform hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${ status === 'listening'
                ? 'shadow-red-500/40'
                : 'shadow-violet-500/40'
                }` }
              style={ status === 'listening'
                ? { background: 'linear-gradient(135deg, #dc2626, #f97316)' }
                : { background: 'linear-gradient(135deg, #7c3aed, #ec4899)' }
              }
            >
              { status === 'listening'
                ? <StopIcon className="w-9 h-9" />
                : <MicIcon className="w-9 h-9" />
              }
            </button>
          </div>
          <p className="text-gray-600 text-xs font-medium">
            { status === 'listening' ? 'Toca para detener' : status === 'speaking' ? 'MonyIA está hablando…' : 'Mantén para hablar' }
          </p>
        </div>
      ) }
    </div>
  );
}
