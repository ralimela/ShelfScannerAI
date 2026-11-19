import '@testing-library/jest-dom'
import { TextDecoder, TextEncoder } from 'util'
import { webcrypto } from 'crypto'

process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_test'
process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = 'test-client-id'
process.env.NEXT_PUBLIC_COGNITO_DOMAIN = 'https://test-domain.auth.us-east-1.amazoncognito.com'

// jsdom provides neither TextEncoder/TextDecoder nor a usable Web Crypto
// API, both of which lib/auth.ts's PKCE helpers need (crypto.subtle.digest,
// crypto.getRandomValues). Node has real implementations of both.
if (!global.TextEncoder) {
  global.TextEncoder = TextEncoder as typeof global.TextEncoder
}
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder
}
if (!global.crypto || !global.crypto.subtle) {
  Object.defineProperty(global, 'crypto', { value: webcrypto, configurable: true })
}
