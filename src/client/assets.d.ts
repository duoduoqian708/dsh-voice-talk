// Ambient type declarations for assets esbuild inlines as data URLs.

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.webp' {
  const src: string
  export default src
}
