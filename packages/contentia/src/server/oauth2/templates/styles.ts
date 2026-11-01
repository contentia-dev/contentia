/**
 * Login-page design system.
 *
 * Colors, fonts, shadows and component styles were inherited from upstream
 * Decap CMS (`packages/decap-cms-ui-default/src/styles.js` and
 * `packages/decap-cms-ui-auth/src/NetlifyAuthenticationPage.js`) so the hosted
 * login pages match an admin UI built on that lineage. They are no longer kept
 * in sync with upstream; treat these values as this package's own.
 */

// Template tag functions for intellisense support
const css = String.raw;
const html = String.raw;

// ============================================================================
// Design Tokens
// ============================================================================

/**
 * Color Palette
 */
export const colors = {
  // Primary colors
  blue: '#3a69c7',
  blueLight: '#e8f5fe',
  green: '#005614',
  greenLight: '#caef6f',
  brown: '#754e00',
  purple: '#70399f',
  teal: '#17a2b8',

  // Grays
  grayLight: '#eff0f4',
  gray: '#798291',
  grayDark: '#313d3e',

  // UI colors
  textPrimary: '#313d3e',
  textSecondary: '#798291',
  textMuted: '#5D626F',
  background: '#eff0f4',
  surface: '#ffffff',
  border: '#dfdfe3',
  borderHover: '#c4c4c4',

  // Status colors
  error: '#ff003b',
  errorLight: '#fff0f3',
  success: '#005614',
  warning: '#754e00',

  // Button colors
  buttonPrimary: '#313d3e',
  buttonPrimaryHover: '#555a65',
  buttonDisabled: '#eff0f4',
} as const;

/**
 * Typography
 */
export const fonts = {
  primary:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace',
} as const;

/**
 * Spacing & Sizing
 */
export const lengths = {
  borderRadius: '5px',
  inputPadding: '10px',
  buttonHeight: '36px',
  inputBorderWidth: '2px',
} as const;

/**
 * Shadows
 */
export const shadows = {
  button: '0 4px 12px 0 rgba(68, 74, 87, 0.15), 0 1px 3px 0 rgba(68, 74, 87, 0.25)',
  dropShadow: '0 2px 6px 0 rgba(68, 74, 87, 0.05), 0 1px 3px 0 rgba(68, 74, 87, 0.1)',
  inputFocus: 'inset 0 0 0 1px #3a69c7',
} as const;

// ============================================================================
// CSS Styles
// ============================================================================

/**
 * Base reset and body styles
 */
export const baseStyles = css`
  *,
  *:before,
  *:after {
    box-sizing: border-box;
  }
  body {
    font-family: ${fonts.primary};
    font-weight: normal;
    display: flex;
    flex-flow: column nowrap;
    align-items: center;
    justify-content: center;
    gap: 50px;
    min-height: 100vh;
    margin: 0;
    background-color: ${colors.background};
    color: ${colors.textSecondary};
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;

/**
 * Logo styles
 */
export const logoStyles = css`
  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo svg {
    width: 300px;
    height: auto;
  }
`;

/**
 * Form container styles
 */
export const containerStyles = css`
  .auth-container {
    width: 350px;
    margin-top: -30px;
  }
  .auth-form {
    display: block;
  }
  .auth-form.hidden {
    display: none;
  }
`;

/**
 * Error message styles
 */
export const errorStyles = css`
  .error-message {
    background-color: ${colors.errorLight};
    border: 1px solid ${colors.error};
    border-radius: ${lengths.borderRadius};
    color: ${colors.error};
    font-size: 14px;
    padding: 10px 15px;
    margin-bottom: 15px;
  }
  .error-message:empty {
    display: none;
  }
`;

/**
 * Form input styles
 */
export const formStyles = css`
  .form-group {
    margin-bottom: 15px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    color: ${colors.textMuted};
    margin-bottom: 6px;
  }
  .form-input {
    background-color: ${colors.surface};
    border-radius: ${lengths.borderRadius};
    border: solid ${lengths.inputBorderWidth} ${colors.border};
    font-size: 14px;
    padding: ${lengths.inputPadding};
    width: 100%;
    font-family: inherit;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .form-input:focus {
    outline: none;
    border-color: ${colors.blue};
    box-shadow: ${shadows.inputFocus};
  }
  .form-input:disabled {
    background-color: #f5f5f5;
    cursor: not-allowed;
  }
`;

/**
 * Button styles
 */
export const buttonStyles = css`
  .button {
    border: 0;
    border-radius: ${lengths.borderRadius};
    cursor: pointer;
    height: ${lengths.buttonHeight};
    line-height: ${lengths.buttonHeight};
    font-weight: 500;
    padding: 0 30px;
    font-size: 14px;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background-color 0.2s ease;
  }
  .button-primary {
    background-color: ${colors.buttonPrimary};
    color: ${colors.surface};
    box-shadow: ${shadows.button};
  }
  .button-primary:hover {
    background-color: ${colors.buttonPrimaryHover};
  }
  .button-secondary {
    background-color: ${colors.surface};
    color: ${colors.textPrimary};
    border: 2px solid ${colors.border};
  }
  .button-secondary:hover {
    background-color: #f5f5f5;
    border-color: ${colors.borderHover};
  }
  .button:focus {
    outline: -webkit-focus-ring-color auto 5px;
  }
  .button:disabled {
    background-color: ${colors.buttonDisabled};
    color: ${colors.textSecondary};
    cursor: default;
    box-shadow: none;
    border-color: ${colors.border};
  }
  .button-full {
    width: 100%;
  }
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
  }
`;

/**
 * Divider styles
 */
export const dividerStyles = css`
  .divider {
    display: flex;
    align-items: center;
    gap: 15px;
    margin: 20px 0;
    color: ${colors.textSecondary};
    font-size: 12px;
    text-transform: uppercase;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background-color: ${colors.border};
  }
`;

/**
 * Passkey-specific styles
 */
export const passkeyStyles = css`
  .passkey-icon {
    width: 20px;
    height: 20px;
  }
`;

/**
 * TOTP-specific styles
 */
export const totpStyles = css`
  .totp-input {
    width: 100%;
    height: 48px;
    text-align: center;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.5em;
    background-color: ${colors.surface};
    border-radius: ${lengths.borderRadius};
    border: solid ${lengths.inputBorderWidth} ${colors.border};
    font-family: inherit;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    margin-bottom: 20px;
  }
  .totp-input:focus {
    outline: none;
    border-color: ${colors.blue};
    box-shadow: ${shadows.inputFocus};
  }
  .totp-input::placeholder {
    letter-spacing: normal;
    font-weight: normal;
    font-size: 14px;
    color: ${colors.textSecondary};
  }
  .totp-description {
    text-align: center;
    font-size: 14px;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .backup-link {
    display: block;
    text-align: center;
    margin-top: 15px;
    color: ${colors.blue};
    font-size: 14px;
    text-decoration: none;
  }
  .backup-link:hover {
    text-decoration: underline;
  }
`;

/**
 * Forgot password link styles
 */
export const forgotPasswordStyles = css`
  .forgot-password-link {
    display: block;
    text-align: right;
    margin-top: 8px;
    color: ${colors.blue};
    font-size: 13px;
    text-decoration: none;
  }
  .forgot-password-link:hover {
    text-decoration: underline;
  }
`;

/**
 * Back button styles
 */
export const backButtonStyles = css`
  .back-button {
    display: flex;
    align-items: center;
    gap: 8px;
    color: ${colors.textSecondary};
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-bottom: 20px;
  }
  .back-button:hover {
    color: ${colors.textPrimary};
  }
  .back-button svg {
    width: 20px;
    height: 20px;
  }
`;

/**
 * Loading spinner styles
 */
export const spinnerStyles = css`
  .loading-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid ${colors.surface};
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  .button-secondary .loading-spinner {
    border-color: ${colors.textPrimary};
    border-top-color: transparent;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

/**
 * Utility styles
 */
export const utilityStyles = css`
  .hidden {
    display: none !important;
  }
`;

/**
 * Combined styles for the login page
 * Import this for a complete stylesheet
 */
export const loginPageStyles = [
  baseStyles,
  logoStyles,
  containerStyles,
  errorStyles,
  formStyles,
  buttonStyles,
  dividerStyles,
  passkeyStyles,
  totpStyles,
  forgotPasswordStyles,
  backButtonStyles,
  spinnerStyles,
  utilityStyles,
].join('\n');

// ============================================================================
// SVG Assets
// ============================================================================

/**
 * Default login-page logo.
 *
 * The Contentia mark (docs/public/contentia-mark.svg) beside the name, at the
 * same proportions the `.logo svg` rule sizes for. It is the fallback when no
 * `customLogo` is configured; pass one to `contentiaOauth2` to override it.
 */
export const defaultLogo =
  html`<svg width="300" height="79" viewBox="0 0 340 90" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contentia">
  <g transform="scale(0.9)">
    <g fill="#0b0b0b" stroke="#0b0b0b">
      <path fill="none" stroke-width="7" d="M50.0000 3.5000 A46.5 46.5 0 0 1 90.2702 26.7500"/>
      <path fill="none" stroke-width="7" d="M50.0000 14.0000 A36.0 36.0 0 0 1 81.1769 32.0000"/>
      <path stroke="none" d="M50 50 L50.0000 21.0000 A29.0 29.0 0 0 1 75.1147 35.5000 Z"/>
    </g>
    <g fill="#3a3a3a" stroke="#3a3a3a">
      <path fill="none" stroke-width="7" d="M9.7298 26.7500 A46.5 46.5 0 0 1 50.0000 3.5000"/>
      <path fill="none" stroke-width="7" d="M18.8231 32.0000 A36.0 36.0 0 0 1 50.0000 14.0000"/>
      <path stroke="none" d="M50 50 L24.8853 35.5000 A29.0 29.0 0 0 1 50.0000 21.0000 Z"/>
    </g>
    <g fill="#666666" stroke="#666666">
      <path fill="none" stroke-width="7" d="M9.7298 73.2500 A46.5 46.5 0 0 1 9.7298 26.7500"/>
      <path fill="none" stroke-width="7" d="M18.8231 68.0000 A36.0 36.0 0 0 1 18.8231 32.0000"/>
      <path stroke="none" d="M50 50 L24.8853 64.5000 A29.0 29.0 0 0 1 24.8853 35.5000 Z"/>
    </g>
    <g fill="#919191" stroke="#919191">
      <path fill="none" stroke-width="7" d="M50.0000 96.5000 A46.5 46.5 0 0 1 9.7298 73.2500"/>
      <path fill="none" stroke-width="7" d="M50.0000 86.0000 A36.0 36.0 0 0 1 18.8231 68.0000"/>
      <path stroke="none" d="M50 50 L50.0000 79.0000 A29.0 29.0 0 0 1 24.8853 64.5000 Z"/>
    </g>
    <g fill="#bcbcbc" stroke="#bcbcbc">
      <path fill="none" stroke-width="7" d="M90.2702 73.2500 A46.5 46.5 0 0 1 50.0000 96.5000"/>
      <path fill="none" stroke-width="7" d="M81.1769 68.0000 A36.0 36.0 0 0 1 50.0000 86.0000"/>
      <path stroke="none" d="M50 50 L75.1147 64.5000 A29.0 29.0 0 0 1 50.0000 79.0000 Z"/>
    </g>
  </g>
  <text x="108" y="63" textLength="228" lengthAdjust="spacingAndGlyphs" fill="#0b0b0b" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="50" font-weight="600">Contentia</text>
</svg>`;

/**
 * Passkey (fingerprint) icon SVG
 */
export const passkeyIcon =
  html`<svg class="passkey-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
  <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/>
  <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
  <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
  <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
  <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
  <path d="M2 16h.01"/>
  <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
  <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>
</svg>`;

/**
 * Back arrow icon SVG
 */
export const backIcon =
  html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 12H5M12 19l-7-7 7-7"/>
</svg>`;
