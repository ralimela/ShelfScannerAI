import {
  CognitoUser,
  CognitoUserPool,
  CognitoUserAttribute,
  AuthenticationDetails,
  CognitoRefreshToken,
} from 'amazon-cognito-identity-js'

const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN

export interface AuthTokens {
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface DecodedIdToken {
  sub: string
  email?: string
  exp: number
}

function getUserPool(): CognitoUserPool {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('Cognito is not configured (NEXT_PUBLIC_COGNITO_USER_POOL_ID / NEXT_PUBLIC_COGNITO_CLIENT_ID)')
  }
  return new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
}

export function decodeIdToken(idToken: string): DecodedIdToken {
  const payload = idToken.split('.')[1]
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  )
  return JSON.parse(json)
}

function tokensFromSession(session: {
  getIdToken: () => { getJwtToken: () => string; getExpiration: () => number }
  getAccessToken: () => { getJwtToken: () => string }
  getRefreshToken: () => { getToken: () => string }
}): AuthTokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: session.getIdToken().getExpiration() * 1000,
  }
}

export function signUp(email: string, password: string): Promise<{ userSub: string }> {
  return new Promise((resolve, reject) => {
    const attributes = [new CognitoUserAttribute({ Name: 'email', Value: email })]
    getUserPool().signUp(email, password, attributes, [], (err, result) => {
      if (err || !result) {
        reject(err instanceof Error ? err : new Error('Sign up failed'))
        return
      }
      resolve({ userSub: result.userSub })
    })
  })
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err instanceof Error ? err : new Error('Verification failed'))
        return
      }
      resolve()
    })
  })
}

export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.resendConfirmationCode((err) => {
      if (err) {
        reject(err instanceof Error ? err : new Error('Could not resend the code'))
        return
      }
      resolve()
    })
  })
}

export function signIn(email: string, password: string): Promise<AuthTokens> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    const authDetails = new AuthenticationDetails({ Username: email, Password: password })
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(tokensFromSession(session)),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Sign in failed')),
    })
  })
}

export function refreshSession(email: string, refreshToken: string): Promise<AuthTokens> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.refreshSession(new CognitoRefreshToken({ RefreshToken: refreshToken }), (err, session) => {
      if (err || !session) {
        reject(err instanceof Error ? err : new Error('Session refresh failed'))
        return
      }
      resolve(tokensFromSession(session))
    })
  })
}

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Could not start password reset')),
    })
  })
}

export function confirmPassword(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Could not reset the password')),
    })
  })
}

export function signOutLocally(email: string): void {
  try {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() })
    user.signOut()
  } catch {
    // best-effort - the AuthContext clearing its own stored tokens is what
    // actually matters for this client-only app
  }
}

// ---------------------------------------------------------------------
// Google sign-in via the Cognito Hosted UI. This is a public client (no
// client secret), so PKCE is required by Cognito's /oauth2/token endpoint.
// Feature-flagged off (NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED) until a Google
// OAuth client is actually registered as an identity provider in Cognito.
// ---------------------------------------------------------------------

const PKCE_STORAGE_PREFIX = 'shelfscannerai_pkce_'

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafeString(byteLength: number): string {
  const array = new Uint8Array(byteLength)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

async function sha256(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return new Uint8Array(digest)
}

export async function getGoogleAuthorizeUrl(redirectUri: string): Promise<string> {
  if (!COGNITO_DOMAIN || !CLIENT_ID) {
    throw new Error('Cognito is not configured')
  }
  const verifier = randomUrlSafeString(32)
  const challenge = base64UrlEncode(await sha256(verifier))
  const state = randomUrlSafeString(16)
  sessionStorage.setItem(`${PKCE_STORAGE_PREFIX}${state}`, verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    identity_provider: 'Google',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, state: string, redirectUri: string): Promise<AuthTokens> {
  if (!COGNITO_DOMAIN || !CLIENT_ID) {
    throw new Error('Cognito is not configured')
  }
  const verifierKey = `${PKCE_STORAGE_PREFIX}${state}`
  const verifier = sessionStorage.getItem(verifierKey)
  if (!verifier) {
    throw new Error('This sign-in link has expired - please try again')
  }
  sessionStorage.removeItem(verifierKey)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error('Google sign-in failed')
  }
  const data = await res.json()
  const decoded = decodeIdToken(data.id_token)
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: decoded.exp * 1000,
  }
}
