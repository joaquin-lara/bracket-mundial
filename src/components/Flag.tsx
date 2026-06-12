import { flagUrl } from '@/lib/flags';

/** Small country flag; renders nothing for TBD slots (no code yet). */
export default function Flag({ code, name }: { code: string | null; name?: string }) {
  const url = flagUrl(code);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="flag" src={url} alt={name ?? code ?? 'flag'} loading="lazy" />;
}
