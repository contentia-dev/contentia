import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from 'contentia/core';

import { createServerLogger } from './logger.js';
import { JwtVerificationError } from './oidc.js';

const sink = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() });

describe('createServerLogger', () => {
  it('turns client (4xx) errors into one-line warnings', () => {
    const s = sink();
    const logger = createServerLogger(s);
    logger.error('Authentication failed:', new AuthenticationError('Invalid API key'));
    logger.error('Authentication failed:', new JwtVerificationError('Invalid access token: expired'));
    expect(s.error).not.toHaveBeenCalled();
    expect(s.warn.mock.calls).toEqual([
      ['Authentication failed:', 'unauthenticated: Invalid API key'],
      ['Authentication failed:', 'JwtVerificationError: Invalid access token: expired'],
    ]);
  });

  it('keeps server errors, with their stack, at error level', () => {
    const s = sink();
    const failure = new Error('OIDC: fetching the JWKS failed with HTTP 503');
    createServerLogger(s).error('Authentication failed:', failure);
    expect(s.error).toHaveBeenCalledWith('Authentication failed:', failure);
  });

  it('drops debug output unless enabled', () => {
    const quiet = sink();
    createServerLogger(quiet).debug('Health check endpoint');
    expect(quiet.debug).not.toHaveBeenCalled();
    const verbose = sink();
    createServerLogger(verbose, true).debug('Health check endpoint');
    expect(verbose.debug).toHaveBeenCalledWith('Health check endpoint');
  });
});
