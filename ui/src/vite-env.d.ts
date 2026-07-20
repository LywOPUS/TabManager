/// <reference types="vite/client" />

declare module '@ext/lib/*.js' {
  const mod: Record<string, unknown>
  export = mod
}
