declare module '#cms-config' {
  const config: import('./shared/format').CmsConfig
  export default config
}

declare module '#cms-icons' {
  /** Icônes Lucide citées dans cms.config.ts, par nom ('briefcase' → composant). */
  const icons: Record<string, import('vue').Component>
  export default icons
}
