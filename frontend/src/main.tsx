import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Plotly from 'plotly.js/dist/plotly.min.js';
import './index.css';
import App from './App';

// Global Plotly override: force transparent paper + plot backgrounds on
// every plot in the app so that exported SVGs (and the live figures) have
// no white backdrop. Individual layouts can still set bgcolor on specific
// annotations or legends, which remain opaque. Applied once at startup so
// every Plotly.newPlot / Plotly.react call inherits the transparent fill
// unless the caller explicitly overrides it.
const TRANSPARENT = 'rgba(0,0,0,0)';
const _origNewPlot = (Plotly as any).newPlot;
(Plotly as any).newPlot = function (
  div: any,
  data: any,
  layout: any,
  config?: any,
) {
  const merged = {
    paper_bgcolor: TRANSPARENT,
    plot_bgcolor: TRANSPARENT,
    ...(layout || {}),
  };
  // Ensure callers that pass explicit white backgrounds still become transparent
  if (merged.paper_bgcolor === '#fff' || merged.paper_bgcolor === '#ffffff' || merged.paper_bgcolor === 'white') {
    merged.paper_bgcolor = TRANSPARENT;
  }
  if (merged.plot_bgcolor === '#fff' || merged.plot_bgcolor === '#ffffff' || merged.plot_bgcolor === 'white') {
    merged.plot_bgcolor = TRANSPARENT;
  }
  return _origNewPlot.call(this, div, data, merged, config);
};
const _origReact = (Plotly as any).react;
if (_origReact) {
  (Plotly as any).react = function (div: any, data: any, layout: any, config?: any) {
    const merged = {
      paper_bgcolor: TRANSPARENT,
      plot_bgcolor: TRANSPARENT,
      ...(layout || {}),
    };
    if (merged.paper_bgcolor === '#fff' || merged.paper_bgcolor === '#ffffff' || merged.paper_bgcolor === 'white') {
      merged.paper_bgcolor = TRANSPARENT;
    }
    if (merged.plot_bgcolor === '#fff' || merged.plot_bgcolor === '#ffffff' || merged.plot_bgcolor === 'white') {
      merged.plot_bgcolor = TRANSPARENT;
    }
    return _origReact.call(this, div, data, merged, config);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
