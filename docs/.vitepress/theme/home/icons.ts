// Line icons (24×24, stroked) for the things that use content: they have no adapter logo.
// Backends use their adapter logo from /adapters/<key>.svg instead.
export const icons = {
  admin: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M8.5 4v16M11.5 9h6M11.5 12.5h6M11.5 16h3.5"/>',
  site:
    '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 8.5h19"/><path d="M8 13.5l-2 1.5 2 1.5M16 13.5l2 1.5-2 1.5M13 12.5l-2 5"/>',
  mobile: '<rect x="6" y="2" width="12" height="20" rx="2.6"/><path d="M10.5 18.5h3"/>',
  agent:
    '<path d="M11 3.5l1.8 4.9 4.9 1.8-4.9 1.8L11 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z"/><path d="M18.5 14.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.9z"/>',
  build: '<path d="M12 2.8l8 4.2v10l-8 4.2-8-4.2V7z"/><path d="M4 7l8 4.2L20 7M12 11.2v10"/>',
  intranet:
    '<path d="M4 21V5.5L12 3l8 2.5V21"/><path d="M2.5 21h19M9.5 21v-4h5v4M8 8.5h2M14 8.5h2M8 12.5h2M14 12.5h2"/>',
} as const;

export type IconName = keyof typeof icons;
