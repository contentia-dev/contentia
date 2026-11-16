/**
 * Auto-login auth component used when the `contentia` backend is configured
 * with `dev_token`. Mounts, immediately calls `onLogin({ token })`, and
 * shows nothing visible (the editor navigates away as soon as the
 * subsequent `authenticate()` call resolves).
 *
 * This is a development-only shortcut: it skips the PKCE OAuth dance
 * entirely. The server is expected to accept the matching token (see
 * `createEmbeddedContentia({ auth: { mode: 'dev' } })` in
 * `contentia/server/decap`).
 */
import { Component } from 'react';

export interface DevAuthPageProps {
  onLogin: (user: unknown) => void;
  inProgress?: boolean;
  // The backend wires this via a factory wrapper; not provided by Decap.
  devToken?: string;
  // Set by the parent when a previous auth attempt with this token failed.
  error?: string;
}

class DevAuthenticationPage extends Component<DevAuthPageProps> {
  componentDidMount() {
    if (this.props.error) {
      return;
    }

    const token = this.props.devToken ?? '';
    if (!token) {
      console.warn(
        '[contentia dev auth] DevAuthenticationPage mounted without devToken - '
          + 'this should not happen; check createContentiaBackend wiring.',
      );
      return;
    }
    queueMicrotask(() => this.props.onLogin({ token }));
  }

  render() {
    return null;
  }
}

export default DevAuthenticationPage;
