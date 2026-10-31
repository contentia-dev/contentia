import { normalizeScopes } from 'contentia/auth';
import { AuthenticationError } from 'contentia/core';

import type { User } from 'contentia/server/api';
import {
  type AuthorizationCode,
  contentiaOauth2,
  type OAuthCallbacks,
  type OAuthSession,
} from 'contentia/server/oauth2';

import type { LoginConfig, LoginUserConfig } from './config.js';
import type { ServerLogger } from './logger.js';

/** Where the login endpoints live: `/oauth2/authorize`, `/oauth2/token`, `/oauth2/logout`. */
export const LOGIN_BASE_PATH = '/oauth2';
const TOKEN_ENDPOINT = `${LOGIN_BASE_PATH}/token`;

export interface LoginServer {
  /** Whether `pathname` belongs to the login server rather than the API. */
  handles(pathname: string): boolean;
  fetch(request: Request): Promise<Response>;
  /**
   * The user behind an access token this server issued, or `undefined` when
   * it didn't issue it (it may be an OIDC token). Throws for an expired one.
   */
  userForAccessToken(token: string): User | undefined;
  /** Fails fast on a runtime that can't run the login server safely. */
  ready(): Promise<void>;
}

/**
 * The built-in login page over the users in the config (`auth.login`), for
 * testing. Authorization codes and sessions live in this process: a restart
 * signs everyone out, and a token only works on the replica that issued it.
 */
export const createLoginServer = (login: LoginConfig, logger: ServerLogger): LoginServer => {
  const users = new Map(login.users.map(user => [user.email, user]));
  const codes = new Map<string, AuthorizationCode>();
  const sessions = new Map<string, OAuthSession>();
  const byAccessToken = new Map<string, OAuthSession>();
  const byRefreshToken = new Map<string, OAuthSession>();

  const removeSession = (session: OAuthSession) => {
    sessions.delete(session.id);
    byAccessToken.delete(session.accessToken);
    byRefreshToken.delete(session.refreshToken);
  };

  // Only signed-in users create codes and sessions, and there are few of
  // them, so a sweep whenever one is added keeps memory bounded.
  const sweep = () => {
    const now = Date.now();
    for (const [code, entry] of codes) if (entry.expiresAt < now) codes.delete(code);
    for (const session of sessions.values()) if (session.refreshTokenExpiresAt < now) removeSession(session);
  };

  const asOAuthUser = (user: LoginUserConfig | undefined) =>
    user ? { id: user.email, email: user.email, passwordHash: user.passwordHash } : null;

  const callbacks: OAuthCallbacks = {
    getUserByEmail: async email => asOAuthUser(users.get(email)),
    getUserById: async id => asOAuthUser(users.get(id)),
    storeAuthorizationCode: async code => {
      sweep();
      // The token response then reports the scopes the user actually gets
      // rather than echoing whatever the client asked for.
      codes.set(code.code, { ...code, scope: [...(users.get(code.userId)?.scopes ?? [])] });
    },
    getAuthorizationCode: async code => codes.get(code) ?? null,
    deleteAuthorizationCode: async code => {
      codes.delete(code);
    },
    createSession: async session => {
      sweep();
      sessions.set(session.id, session);
      byAccessToken.set(session.accessToken, session);
      byRefreshToken.set(session.refreshToken, session);
    },
    getSessionByAccessToken: async token => byAccessToken.get(token) ?? null,
    getSessionByRefreshToken: async token => byRefreshToken.get(token) ?? null,
    logoutSession: async id => {
      const session = sessions.get(id);
      if (session) removeSession(session);
    },
    logoutAll: async userId => {
      for (const session of sessions.values()) if (session.userId === userId) removeSession(session);
    },
  };

  const oauth2 = contentiaOauth2({
    basePath: LOGIN_BASE_PATH,
    clientId: login.clientId,
    allowedRedirectUris: [...login.redirectUris],
    callbacks,
    logger: { ...logger, fatal: logger.error },
  });

  // The admin UI exchanges its code with a fetch from the redirect page, so
  // the token endpoint answers CORS for exactly those pages' origins.
  const tokenOrigins = new Set(login.redirectUris.map(uri => new URL(uri).origin));
  const corsHeaders = (request: Request): Record<string, string> | undefined => {
    const origin = request.headers.get('origin');
    if (origin === null || !tokenOrigins.has(origin)) return undefined;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  };

  return {
    handles: pathname => pathname === LOGIN_BASE_PATH || pathname.startsWith(`${LOGIN_BASE_PATH}/`),

    async fetch(request) {
      const cors = new URL(request.url).pathname === TOKEN_ENDPOINT ? corsHeaders(request) : undefined;
      if (cors && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const response = await oauth2.fetch(request);
      if (!cors) return response;
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },

    userForAccessToken(token) {
      const session = byAccessToken.get(token);
      if (!session) return undefined;
      if (session.accessTokenExpiresAt <= Date.now()) throw new AuthenticationError('Access token expired');
      const user = users.get(session.userId);
      if (!user) return undefined;
      // Scopes come from the config, never from the session: the client
      // chose the scope it asked for at /authorize.
      return {
        id: user.email,
        email: user.email,
        ...(user.name !== undefined && { name: user.name }),
        scopes: normalizeScopes([...user.scopes]),
      };
    },

    ready: () => oauth2.ready(),
  };
};
