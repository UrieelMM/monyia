import VoiceChatLive from './components/VoiceChatLive'
import PinGate from './components/PinGate'

export default function Home() {
  return (
    <PinGate>
      <main className="h-screen">
        <VoiceChatLive />
      </main>
    </PinGate>
  )
}
