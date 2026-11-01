/**
 * Email design system constants.
 *
 * Inherited from upstream Decap CMS's UI library so transactional emails match
 * the hosted login pages. Kept in step with `../../templates/styles.ts`, not
 * with upstream.
 */

// ============================================================================
// Colors
// ============================================================================

export const colors = {
  // Raw colors
  white: '#fff',
  grayLight: '#eff0f4',
  gray: '#798291',
  grayDark: '#313d3e',
  blue: '#3a69c7',
  blueLight: '#e8f5fe',
  green: '#005614',
  greenLight: '#caef6f',
  brown: '#754e00',
  yellow: '#ffee9c',
  red: '#ff003b',
  redDark: '#D60032',
  redLight: '#fcefea',
  purple: '#70399f',
  purpleLight: '#f6d8ff',
  teal: '#17a2b8',
  tealDark: '#117888',
  tealLight: '#ddf5f9',

  // Semantic colors
  background: '#eff0f4',
  foreground: '#fff',
  text: '#798291',
  textLead: '#313d3e',
  textFieldBorder: '#dfdfe3',
  controlLabel: '#5D626F',
  button: '#313d3e',
  buttonHover: '#555a65',
  buttonText: '#fff',
  active: '#3a69c7',
  error: '#ff003b',
  errorBackground: '#fcefea',
  success: '#005614',
  successBackground: '#caef6f',
  warning: '#754e00',
  warningBackground: '#ffee9c',

  // Brand
  brandPink: '#FF0082',
} as const;

// ============================================================================
// Typography
// ============================================================================

export const fonts = {
  primary:
    `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"`,
  mono: `'SFMono-Regular', Consolas, "Liberation Mono", Menlo, Courier, monospace`,
} as const;

// ============================================================================
// Spacing & Sizing
// ============================================================================

export const lengths = {
  borderRadius: '5px',
  inputPadding: '10px',
  buttonHeight: '36px',
} as const;

// ============================================================================
// Shadows
// ============================================================================

export const shadows = {
  dropMain: '0 2px 6px 0 rgba(68, 74, 87, 0.05), 0 1px 3px 0 rgba(68, 74, 87, 0.1)',
  dropDeep: '0 4px 12px 0 rgba(68, 74, 87, 0.15), 0 1px 3px 0 rgba(68, 74, 87, 0.25)',
} as const;

// ============================================================================
// Default email logo -- the Contentia lockup. See the note on `defaultLogo` in
// ../../templates/styles.ts.
// ============================================================================

export const defaultLogoSvg =
  `<svg width="300" height="79" viewBox="0 0 340 90" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contentia">
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
 * Smaller logo for email headers (200px wide)
 */
export const defaultLogoSvgSmall =
  `<svg width="200" height="53" viewBox="0 0 340 90" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Contentia">
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

// ============================================================================
// Common CSS Styles
// ============================================================================

/**
 * Base CSS styles for web pages (login, reset password, etc.)
 */
export const pageBaseStyles = `
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
  color: ${colors.text};
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
}
.logo svg {
  width: 300px;
  height: auto;
}
.form-container {
  width: 350px;
  margin-top: -30px;
}
.error-message {
  background-color: ${colors.errorBackground};
  color: ${colors.error};
  padding: 12px 15px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  margin-bottom: 20px;
}
.success-message {
  background-color: ${colors.successBackground};
  color: ${colors.success};
  padding: 12px 15px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  margin-bottom: 20px;
}
.form-group {
  margin-bottom: 15px;
}
.form-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  font-weight: 600;
  color: ${colors.controlLabel};
  margin-bottom: 6px;
}
.form-input {
  background-color: ${colors.white};
  border-radius: ${lengths.borderRadius};
  border: solid 2px ${colors.textFieldBorder};
  font-size: 14px;
  padding: ${lengths.inputPadding};
  width: 100%;
  font-family: inherit;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.form-input:focus {
  outline: none;
  border-color: ${colors.active};
  box-shadow: inset 0 0 0 1px ${colors.active};
}
.submit-button {
  border: 0;
  border-radius: ${lengths.borderRadius};
  cursor: pointer;
  height: ${lengths.buttonHeight};
  line-height: ${lengths.buttonHeight};
  font-weight: 500;
  padding: 0 30px;
  background-color: ${colors.button};
  color: ${colors.buttonText};
  font-size: 14px;
  font-family: inherit;
  display: block;
  margin-top: 20px;
  margin-left: auto;
  box-shadow: ${shadows.dropDeep};
  transition: background-color 0.2s ease;
}
.submit-button:hover {
  background-color: ${colors.buttonHover};
}
.submit-button:focus {
  outline: -webkit-focus-ring-color auto 5px;
}
.submit-button:disabled {
  background-color: ${colors.grayLight};
  color: ${colors.gray};
  cursor: default;
  box-shadow: none;
}
.go-back {
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${colors.text};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s ease;
}
.go-back:hover {
  color: ${colors.textLead};
}
.go-back svg {
  width: 20px;
  height: 20px;
}
.link {
  color: ${colors.active};
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
`;

/**
 * Base CSS styles for HTML emails
 */
export const emailBaseStyles = `
body {
  font-family: ${fonts.primary};
  font-weight: normal;
  background-color: ${colors.background};
  color: ${colors.text};
  margin: 0;
  padding: 40px 20px;
  line-height: 1.6;
}
.email-container {
  max-width: 600px;
  margin: 0 auto;
  background-color: ${colors.white};
  border-radius: ${lengths.borderRadius};
  box-shadow: ${shadows.dropMain};
  overflow: hidden;
}
.email-header {
  background-color: ${colors.white};
  padding: 30px 40px;
  text-align: center;
  border-bottom: 1px solid ${colors.background};
}
.email-logo {
  width: 200px;
  height: auto;
}
.email-body {
  padding: 40px;
}
.email-title {
  font-size: 24px;
  font-weight: 600;
  color: ${colors.textLead};
  margin: 0 0 20px 0;
  letter-spacing: 0.4px;
}
.email-text {
  font-size: 15px;
  color: ${colors.text};
  margin: 0 0 20px 0;
}
.email-button {
  display: inline-block;
  background-color: ${colors.button};
  color: ${colors.buttonText} !important;
  text-decoration: none;
  padding: 12px 30px;
  border-radius: ${lengths.borderRadius};
  font-size: 14px;
  font-weight: 500;
  margin: 20px 0;
  box-shadow: ${shadows.dropDeep};
}
.email-button:hover {
  background-color: ${colors.buttonHover};
}
.email-link {
  color: ${colors.active};
  text-decoration: none;
}
.email-link:hover {
  text-decoration: underline;
}
.email-muted {
  font-size: 13px;
  color: ${colors.text};
}
.email-footer {
  background-color: #f8f9fa;
  padding: 20px 40px;
  text-align: center;
  border-top: 1px solid ${colors.background};
}
.email-footer-text {
  font-size: 12px;
  color: ${colors.text};
  margin: 0;
}
.email-code {
  background-color: ${colors.background};
  padding: 15px 20px;
  border-radius: ${lengths.borderRadius};
  font-family: ${fonts.mono};
  font-size: 14px;
  color: ${colors.textLead};
  word-break: break-all;
  margin: 20px 0;
}
.email-warning {
  background-color: ${colors.warningBackground};
  color: ${colors.warning};
  padding: 15px 20px;
  border-radius: ${lengths.borderRadius};
  font-size: 13px;
  margin: 20px 0;
}
`;
