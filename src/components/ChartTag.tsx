/**
 * Small pill that marks whether a graphic is a model *prediction* or a record of
 * *historical* fact, so the two are never confused. Pair it with a caption that
 * states what the figure is based on.
 */
export default function ChartTag({ kind }: { kind: 'prediction' | 'history' }) {
  const pred = kind === 'prediction';
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 8,
        verticalAlign: 'middle',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 999,
        color: pred ? '#06281c' : 'var(--muted)',
        background: pred ? 'var(--gold)' : 'rgba(244,241,232,0.12)',
        border: pred ? 'none' : '1px solid var(--line)',
      }}
    >
      {pred ? 'Prediction' : 'History'}
    </span>
  );
}
