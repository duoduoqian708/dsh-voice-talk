// Type face for lottie-web's minified player build (the shipped bundle has no
// sibling d.ts; mirror the root package's default export, same runtime API).
declare module 'lottie-web/build/player/lottie.min.js' {
  import type { LottiePlayer } from 'lottie-web'
  const player: LottiePlayer
  export default player
}
