'use client';

import { useState, useRef, useEffect } from 'react';

const CORRECT_PIN = '180426';
const STORAGE_KEY = 'monyia_unlocked';

export default function PinGate( { children }: { children: React.ReactNode } ) {
  const [ unlocked, setUnlocked ] = useState( false );
  const [ pin, setPin ] = useState( [ '', '', '', '', '', '' ] );
  const [ shake, setShake ] = useState( false );
  const [ ready, setReady ] = useState( false ); // evita flash SSR
  const inputsRef = useRef<( HTMLInputElement | null )[]>( [] );

  // Verificar localStorage solo en cliente
  useEffect( () => {
    if ( localStorage.getItem( STORAGE_KEY ) === '1' ) {
      setUnlocked( true );
    }
    setReady( true );
  }, [] );

  // Auto-focus primer input cuando aparece la pantalla
  useEffect( () => {
    if ( ready && !unlocked ) {
      setTimeout( () => inputsRef.current[ 0 ]?.focus(), 100 );
    }
  }, [ ready, unlocked ] );

  const checkPin = ( digits: string[] ) => {
    const entered = digits.join( '' );
    if ( entered.length < 6 ) return;

    if ( entered === CORRECT_PIN ) {
      localStorage.setItem( STORAGE_KEY, '1' );
      setUnlocked( true );
    } else {
      setShake( true );
      setTimeout( () => {
        setShake( false );
        setPin( [ '', '', '', '', '', '' ] );
        inputsRef.current[ 0 ]?.focus();
      }, 600 );
    }
  };

  const handleChange = ( idx: number, value: string ) => {
    const digit = value.replace( /\D/g, '' ).slice( -1 );
    const next = [ ...pin ];
    next[ idx ] = digit;
    setPin( next );

    if ( digit && idx < 5 ) {
      inputsRef.current[ idx + 1 ]?.focus();
    }

    if ( next.every( ( d ) => d !== '' ) ) {
      checkPin( next );
    }
  };

  const handleKeyDown = ( idx: number, e: React.KeyboardEvent<HTMLInputElement> ) => {
    if ( e.key === 'Backspace' && !pin[ idx ] && idx > 0 ) {
      inputsRef.current[ idx - 1 ]?.focus();
    }
  };

  if ( !ready ) return null;
  if ( unlocked ) return <>{ children }</>;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#080812] px-6">
      {/* Glows de fondo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative z-10 flex flex-col items-center gap-8 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl px-10 py-12 shadow-2xl shadow-black/50 w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <span className="text-white font-bold text-2xl tracking-wider">
            Mony<span className="text-fuchsia-400">IA</span>
          </span>
          <p className="text-gray-500 text-xs tracking-wide">Ingresa tu PIN para continuar</p>
        </div>

        {/* Inputs PIN */}
        <div
          className={ `flex gap-3 transition-transform ${ shake ? 'animate-[shake_0.5s_ease-in-out]' : '' }` }
          style={ shake ? { animation: 'shake 0.5s ease-in-out' } : {} }
        >
          { pin.map( ( digit, i ) => (
            <input
              key={ i }
              ref={ ( el ) => { inputsRef.current[ i ] = el; } }
              type="password"
              inputMode="numeric"
              maxLength={ 1 }
              value={ digit }
              onChange={ ( e ) => handleChange( i, e.target.value ) }
              onKeyDown={ ( e ) => handleKeyDown( i, e ) }
              className={ `w-11 h-14 rounded-xl text-center text-xl font-bold bg-white/8 border transition-all outline-none caret-transparent
                ${ digit
                  ? 'border-fuchsia-500/70 text-white bg-fuchsia-500/10'
                  : 'border-white/15 text-white'
                }
                focus:border-fuchsia-400 focus:bg-fuchsia-500/10 focus:shadow-lg focus:shadow-fuchsia-500/20` }
            />
          ) ) }
        </div>

        <p className="text-gray-700 text-[11px] tracking-wide">Hecho para Mony por urieel ❤️</p>
      </div>

      {/* Keyframe de shake inline */}
      <style>{ `
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-8px); }
          30%       { transform: translateX(8px); }
          45%       { transform: translateX(-6px); }
          60%       { transform: translateX(6px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
      ` }</style>
    </div>
  );
}
