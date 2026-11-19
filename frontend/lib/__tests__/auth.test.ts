import { decodeIdToken, exchangeCodeForTokens, getGoogleAuthorizeUrl } from '@/lib/auth'

function base64UrlEncodeJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function fakeIdToken(payload: object): string {
  const header = base64UrlEncodeJson({ alg: 'RS256', typ: 'JWT' })
  const body = base64UrlEncodeJson(payload)
  return `${header}.${body}.fakesignature`
}

describe('decodeIdToken', () => {
  it('decodes the sub, email, and exp claims from a JWT payload', () => {
    const token = fakeIdToken({ sub: 'user-123', email: 'a@example.com', exp: 1999999999 })
    const decoded = decodeIdToken(token)
    expect(decoded.sub).toBe('user-123')
    expect(decoded.email).toBe('a@example.com')
    expect(decoded.exp).toBe(1999999999)
  })
})

describe('getGoogleAuthorizeUrl', () => {
  it('builds a Cognito Hosted UI authorize URL with PKCE params and stores the verifier', async () => {
    const url = await getGoogleAuthorizeUrl('https://example.com/auth/callback')
    const parsed = new URL(url)

    expect(parsed.origin + parsed.pathname).toBe(
      'https://test-domain.auth.us-east-1.amazoncognito.com/oauth2/authorize'
    )
    expect(parsed.searchParams.get('identity_provider')).toBe('Google')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/auth/callback')
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy()

    const state = parsed.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(sessionStorage.getItem(`shelfscannerai_pkce_${state}`)).toBeTruthy()
  })

  it('generates a different state and verifier on every call', async () => {
    const urlA = await getGoogleAuthorizeUrl('https://example.com/auth/callback')
    const urlB = await getGoogleAuthorizeUrl('https://example.com/auth/callback')
    expect(new URL(urlA).searchParams.get('state')).not.toBe(new URL(urlB).searchParams.get('state'))
  })
})

describe('exchangeCodeForTokens', () => {
  it('rejects when no PKCE verifier was stored for the given state', async () => {
    await expect(
      exchangeCodeForTokens('some-code', 'unknown-state', 'https://example.com/auth/callback')
    ).rejects.toThrow(/expired/i)
  })

  it('consumes the stored verifier so a given state cannot be replayed', async () => {
    const url = await getGoogleAuthorizeUrl('https://example.com/auth/callback')
    const state = new URL(url).searchParams.get('state') as string

    // The real token exchange would need a live Cognito endpoint - just
    // confirm the verifier is actually removed after the first attempt,
    // since that's the replay-protection behavior that matters here.
    expect(sessionStorage.getItem(`shelfscannerai_pkce_${state}`)).toBeTruthy()
    await exchangeCodeForTokens('some-code', state, 'https://example.com/auth/callback').catch(() => {})
    expect(sessionStorage.getItem(`shelfscannerai_pkce_${state}`)).toBeNull()
  })
})
