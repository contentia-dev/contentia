import { describe, expect, it, vi } from 'vitest';

import DevAuthenticationPage from './dev-authentication-page.js';

import type { DevAuthPageProps } from './dev-authentication-page.js';

/** Mount the page the way React would: construct it, then run componentDidMount. */
async function mount(props: DevAuthPageProps): Promise<void> {
  new DevAuthenticationPage(props).componentDidMount();
  // The login is queued as a microtask; let it run.
  await Promise.resolve();
}

describe('DevAuthenticationPage', () => {
  it('logs in with the dev token on mount', async () => {
    const onLogin = vi.fn();

    await mount({ devToken: 'dev-token', onLogin });

    expect(onLogin).toHaveBeenCalledExactlyOnceWith({ token: 'dev-token' });
  });

  it('does not retry auto-login after authentication failed', async () => {
    const onLogin = vi.fn();

    await mount({ devToken: 'dev-token', onLogin });
    expect(onLogin).toHaveBeenCalledTimes(1);

    await mount({ devToken: 'dev-token', error: 'Authentication failed', onLogin });

    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('does not log in without a dev token', async () => {
    const onLogin = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await mount({ onLogin });

    expect(onLogin).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('renders nothing', () => {
    expect(new DevAuthenticationPage({ onLogin: vi.fn() }).render()).toBeNull();
  });
});
