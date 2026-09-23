'use client';

// Graphiques legeres 100 % CSS (aucune dependance ajoutee au projet).
// - DashBars  : barres horizontales (ex. employes par service)
// - DashDonut : anneau de repartition (ex. plannings par statut)

export function DashBars({ data, unite = '' }) {
  const items = (data || []).filter((d) => d.valeur > 0);
  if (items.length === 0) return <p className="muted">Aucune donnée.</p>;
  const max = Math.max(...items.map((d) => d.valeur));
  return (
    <div className="dash-bars">
      {items.map((d) => (
        <div key={d.label} className="dash-bar-row" title={`${d.label} : ${d.valeur}${unite}`}>
          <span className="dash-bar-label">{d.label}</span>
          <span className="dash-bar-track">
            <span
              className="dash-bar-fill"
              style={{ width: `${Math.max((d.valeur / max) * 100, 4)}%`, background: d.couleur || '#2f6fed' }}
            />
          </span>
          <span className="dash-bar-value">{d.valeur}{unite}</span>
        </div>
      ))}
    </div>
  );
}

export function DashDonut({ data, centreHaut, centreBas }) {
  const items = (data || []).filter((d) => d.valeur > 0);
  const total = items.reduce((s, d) => s + d.valeur, 0);
  if (total === 0) return <p className="muted">Aucune donnée.</p>;

  // Anneau en conic-gradient (segments dans l'ordre des donnees)
  let accumule = 0;
  const stops = items.map((d) => {
    const debut = (accumule / total) * 100;
    accumule += d.valeur;
    const fin = (accumule / total) * 100;
    return `${d.couleur} ${debut}% ${fin}%`;
  });

  return (
    <div className="dash-donut-wrap">
      <div
        className="dash-donut"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
        role="img"
        aria-label="Répartition"
      >
        <div className="dash-donut-trou">
          <strong>{centreHaut ?? total}</strong>
          <span>{centreBas || 'total'}</span>
        </div>
      </div>
      <ul className="dash-donut-legende">
        {items.map((d) => (
          <li key={d.label}>
            <span className="dash-pastille" style={{ background: d.couleur }} />
            {d.label} <strong>{d.valeur}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
