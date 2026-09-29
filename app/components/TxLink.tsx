/**
 * An onchain reference that opens the Arc explorer in a new tab. The address of the link is built on the server from the
 * registry (`explorerTxUrl` / `explorerAddressUrl`); this only draws it. Plan 05f, rule 7.
 */
export function TxLink({ href, label, children, className = "" }: { href: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className={`font-mono text-xs underline decoration-rule underline-offset-4 hover:decoration-ink ${className}`}
    >
      {children}
      <span aria-hidden> ↗</span>
    </a>
  );
}
