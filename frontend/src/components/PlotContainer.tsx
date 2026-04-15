import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { usePlot } from '../hooks/useApi';

export default function PlotContainer({ plotType, title }: { plotType: string; title?: string }) {
  const { data, isLoading, error } = usePlot(plotType);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = useState(400);

  useEffect(() => {
    if (!data || !plotRef.current) return;

    let figure: { data: Plotly.Data[]; layout?: Partial<Plotly.Layout> };
    try {
      figure = typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return;
    }

    // Use the figure's own height if specified, otherwise default to 400
    const figHeight = (figure.layout?.height as number) || 400;
    setPlotHeight(figHeight);

    // Preserve the figure's own margins and automargin settings.
    // Only fill in defaults for margins not already specified by the figure.
    const figMargin = (figure.layout?.margin as Record<string, number | undefined>) || {};
    const mergedMargin: Record<string, number> = {
      r: figMargin.r ?? 30,
      t: figMargin.t ?? 30,
      b: figMargin.b ?? 50,
    };
    // Only set left margin if the figure explicitly provides one;
    // otherwise let Plotly automargin handle it.
    if (figMargin.l !== undefined) {
      mergedMargin.l = figMargin.l;
    }

    const layout = {
      ...figure.layout,
      autosize: true,
      height: figHeight,
      margin: mergedMargin,
      title: undefined,
    };

    Plotly.newPlot(plotRef.current, figure.data, layout, {
      responsive: true,
      displayModeBar: false,
    });

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, [data]);

  if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Loading plot...</div>;
  if (error) return <div style={{ padding: '1rem', color: '#dc3545' }}>Failed to load plot.</div>;
  if (!data) return null;

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: '1rem', marginBottom: '1rem', border: '1px solid #ddd', overflow: 'hidden' }}>
      {title && <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#333' }}>{title}</h3>}
      <div ref={plotRef} style={{ width: '100%', height: plotHeight }} />
    </div>
  );
}
