// Next.js requires this file to be named "middleware.ts".
// All middleware logic lives in proxy.ts — this file just wires it in.
export { proxy as middleware, config } from './proxy'
