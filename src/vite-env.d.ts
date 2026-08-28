/// <reference types="vite/client" />

/** Vite resolves side-effect style imports and emits no type declarations for them. */
declare module '*.scss' {
  const content: string;
  export default content;
}
