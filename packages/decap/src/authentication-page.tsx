import { PkceAuthenticator } from '@laikacms/decap-cms/lib/auth';
import { AuthenticationPage, Icon } from '@laikacms/decap-cms/ui-default';
import React, { Component } from 'react';

interface BackendConfig {
  base_url?: string;
  app_id?: string;
  auth_endpoint?: string;
  auth_token_endpoint?: string;
  auth_token_endpoint_content_type?: string;
  use_oidc?: boolean;
  [key: string]: unknown;
}

interface CMSConfig {
  backend?: BackendConfig;
  logo_url?: string;
  site_url?: string;
  [key: string]: unknown;
}

// Exported so that downstream aggregated exports (e.g. an object containing this component)
// can have a fully nameable type and avoid TS4023 (private type in exported symbol).
export interface PKCEAuthPageProps {
  onLogin: (user: unknown) => void; // Upstream expects Credentials-like object
  inProgress?: boolean;
  config?: CMSConfig;
  t?: (key: string) => string;
}

interface PKCEAuthPageState {
  loginError?: string;
}

/**
 * The login page for the OAuth 2.0 authorization-code flow with PKCE, against
 * `contentia/server/oauth2` or any other OAuth 2.0 / OpenID Connect provider.
 */
class PKCEAuthenticationPage extends Component<PKCEAuthPageProps, PKCEAuthPageState> {
  private auth?: PkceAuthenticator;

  constructor(props: PKCEAuthPageProps) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    const {
      base_url = '',
      app_id = '',
      auth_endpoint = 'oauth2/authorize',
      auth_token_endpoint = 'oauth2/token',
      auth_token_endpoint_content_type = 'application/x-www-form-urlencoded; charset=utf-8',
      use_oidc = false,
      redirect_uri,
      return_to,
    } = (this.props.config?.backend || {}) as {
      base_url?: string,
      app_id?: string,
      auth_endpoint?: string,
      auth_token_endpoint?: string,
      auth_token_endpoint_content_type?: string,
      use_oidc?: boolean,
      redirect_uri?: string,
      return_to?: string,
    };

    if (!base_url || !app_id) {
      this.setState({ loginError: 'Missing required configuration: base_url and app_id are required' });
      return;
    }

    // `redirect_uri` / `return_to` are what let an embedded CMS live on a
    // per-project route: a provider that matches redirect URIs exactly gets one
    // fixed callback, and `return_to` says which route to bounce back to.
    // Omitted everywhere else, where the current page URL is the right
    // redirect target.
    try {
      this.auth = new PkceAuthenticator({
        base_url,
        auth_endpoint,
        app_id,
        auth_token_endpoint,
        auth_token_endpoint_content_type,
        use_oidc,
        ...(redirect_uri === undefined ? {} : { redirect_uri }),
        ...(return_to === undefined ? {} : { return_to }),
      });
    } catch (err: unknown) {
      this.setState({ loginError: (err as Error).message });
      return;
    }

    this.auth.completeAuth((err: Error | null, data: unknown) => {
      if (err) {
        this.setState({ loginError: err.toString() });
        return;
      }
      if (data && typeof data === 'object') {
        // The API bearer is the ACCESS token, never an id_token.
        // `completeAuth`/`authenticate` already set `token` to `access_token`;
        // leave it alone.
        this.props.onLogin(data);
      }
    });
  }

  handleLogin = (e: React.MouseEvent) => {
    e.preventDefault();

    if (!this.auth) {
      this.setState({ loginError: 'Authentication not properly initialized' });
      return;
    }

    const scope = 'openid email profile';

    this.auth.authenticate({ scope }, (err: Error | null, data: unknown) => {
      if (err) {
        this.setState({ loginError: err.toString() });
        return;
      }
      if (data && typeof data === 'object') {
        // The API bearer is the ACCESS token, never an id_token (see above).
        this.props.onLogin(data);
      }
    });
  };

  render() {
    const { inProgress = false, config, t = (key: string) => key } = this.props;
    const { loginError } = this.state;

    return (
      <AuthenticationPage
        onLogin={this.handleLogin}
        loginDisabled={inProgress}
        loginErrorMessage={loginError}
        siteUrl={config?.site_url}
        renderButtonContent={() => (
          <React.Fragment>
            <Icon type="link" /> {inProgress ? t('auth.loggingIn') : t('auth.login')}
          </React.Fragment>
        )}
        t={t}
      />
    );
  }
}

export default PKCEAuthenticationPage;
