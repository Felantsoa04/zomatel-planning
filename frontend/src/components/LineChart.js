'use client';

// GRAPHIQUE EN COURBE (SVG pur, aucune dependance ajoutee)
// - `data` : [{ label, valeur, secondaire? }] — libelles affiches tels quels.
// - Serie principale : total_heures par semaine (donnees reelles de /plannings).
// - Serie secondaire optionnelle : plannings crees par semaine (pointilles).
// - Responsive : viewBox fixe + width 100 % ; le texte garde une taille lisible.
// - Tooltip au survol d'une colonne invisible (zone de capture genereuse).
// - Animation : la courbe "se dessine" de gauche a droite (~1000 ms) quand le
//   SVG devient visible (IntersectionObserver), les points et l'aire apparaissent
//   en fondu a la fin du trace, puis plus AUCUN mouvement (pas de boucle).
//   prefers-reduced-motion ou IntersectionObserver indisponible : affichage
//   direct, sans animation.
// - Etat vide explicite si aucune donnee (jamais de chiffre invente).

import { useEffect, useMemo, useRef, useState } from 'react';

// Geometrie du SVG (viewBox) : marges pour axes + labels
const LARG = 720;
const HAUT = 280;
const MARG = { haut: 16, droite: 16, bas: 34, gauche: 44 };

function fmtNombre(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

export default function LineChart({
  data,
  labelSerie = 'Heures planifiées',
  labelSecondaire = 'Plannings',
  unite = 'h',
}) {
  const donnees = useMemo(
    () => (data || []).filter((d) => d && d.label != null && Number.isFinite(Number(d.valeur))),
    [data]
  );
  const refSvg = useRef(null);
  const [visible, setVisible] = useState(false); // passe a true UNE seule fois
  const [actif, setActif] = useState(null); // index survole

  // Animation jouee UNE FOIS quand le graphique entre dans le viewport.
  useEffect(() => {
    const el = refSvg.current;
    if (!el) return undefined;
    const reduire =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduire || typeof IntersectionObserver === 'undefined') {
      setVisible(true); // affichage direct, sans animation
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const n = donnees.length;

  // Echelles (meme a un seul point : valeurs affichees sans trait)
  const maxVal = useMemo(
    () => Math.max(1, ...donnees.map((d) => Math.max(Number(d.valeur), Number(d.secondaire) || 0))),
    [donnees]
  );
  const pas = Math.pow(10, Math.floor(Math.log10(maxVal))) / 2 || 0.5;
  const maxAxe = Math.ceil(maxVal / pas) * pas;
  const nbTicks = 4;
  const ticks = Array.from({ length: nbTicks + 1 }, (_, i) => (maxAxe / nbTicks) * i);

  const x = (i) =>
    n === 1
      ? MARG.gauche + (LARG - MARG.gauche - MARG.droite) / 2
      : MARG.gauche + (i * (LARG - MARG.gauche - MARG.droite)) / (n - 1);
  const y = (v) => HAUT - MARG.bas - (v / maxAxe) * (HAUT - MARG.haut - MARG.bas);

  const points = donnees.map((d, i) => [x(i), y(Number(d.valeur))]);
  const chemin = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const cheminAire =
    n > 1
      ? `${chemin} L${x(n - 1).toFixed(1)},${(HAUT - MARG.bas).toFixed(1)} L${x(0).toFixed(1)},${(HAUT - MARG.bas).toFixed(1)} Z`
      : '';
  const pointsSec = donnees
    .filter((d) => Number.isFinite(Number(d.secondaire)))
    .map((d, i) => `${x(i).toFixed(1)},${y(Number(d.secondaire)).toFixed(1)}`)
    .join(' ');

  // Longueur du trace pour l'animation de dessin (somme des segments)
  const longueur = useMemo(() => {
    let l = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      l += Math.hypot(x2 - x1, y2 - y1);
    }
    return Math.max(l, 1);
  }, [points]);

  // `montre` : points/aire/serie secondaire visibles (apres observation).
  // `dessine` : la courbe se trace (une fois, jamais rejouee au survol).
  const montre = visible;
  const dessine = visible && n > 1;

  if (n === 0) {
    return <p className="muted dash-vide">Aucune donnée à afficher pour le moment.</p>;
  }

  // Etiquettes X : espacees pour rester lisibles (mobile inclus)
  const pasLabel = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="linechart-wrap">
      <svg
        ref={refSvg}
        className="linechart"
        viewBox={`0 0 ${LARG} ${HAUT}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`${labelSerie} par période${pointsSec ? `, et ${labelSecondaire.toLowerCase()} par période` : ''}`}
        onMouseLeave={() => setActif(null)}
      >
        {/* Grille horizontale legere + axe Y */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARG.gauche} x2={LARG - MARG.droite} y1={y(t)} y2={y(t)} className="lc-grille" />
            <text x={MARG.gauche - 8} y={y(t)} dy="0.32em" textAnchor="end" className="lc-axe-y">
              {fmtNombre(t)}
            </text>
          </g>
        ))}
        {/* Axe X */}
        <line
          x1={MARG.gauche}
          x2={LARG - MARG.droite}
          y1={HAUT - MARG.bas}
          y2={HAUT - MARG.bas}
          className="lc-axe"
        />
        {/* Libelles X espacees */}
        {donnees.map((d, i) =>
          i % pasLabel === 0 ? (
            <text key={`xl-${d.label}-${i}`} x={x(i)} y={HAUT - MARG.bas + 16} textAnchor="middle" className="lc-axe-x">
              {d.label}
            </text>
          ) : null
        )}

        {/* Aire sous la courbe (fondu a la fin du trace) */}
        {cheminAire && <path d={cheminAire} className="lc-aire" style={{ opacity: montre ? 1 : 0 }} />}

        {/* Courbe principale : tracee de gauche a droite via stroke-dashoffset.
            La classe d'animation n'est ajoutee qu'une fois visible : le trace
            ne demarre jamais avant que la carte soit a l'ecran. */}
        {n > 1 && (
          <path
            d={chemin}
            className={`lc-courbe${dessine ? ' lc-courbe-animee' : ''}`}
            style={{ strokeDasharray: longueur, strokeDashoffset: longueur }}
          />
        )}

        {/* Serie secondaire (pointilles) : fondu apres la courbe */}
        {pointsSec && (
          <polyline points={pointsSec} className="lc-secondaire" style={{ opacity: montre ? 1 : 0 }} />
        )}

        {/* Points : apparition en fondu a la fin du trace (delai CSS 900 ms) */}
        {points.map(([px, py], i) => (
          <circle
            key={`pt-${i}`}
            cx={px}
            cy={py}
            r={actif === i ? 4.5 : 3}
            className="lc-point"
            style={{ opacity: montre ? 1 : 0 }}
          />
        ))}
        {pointsSec &&
          donnees.map((d, i) =>
            Number.isFinite(Number(d.secondaire)) ? (
              <circle
                key={`ptsec-${i}`}
                cx={x(i)}
                cy={y(Number(d.secondaire))}
                r={2.5}
                className="lc-point-sec"
                style={{ opacity: montre ? 1 : 0 }}
              />
            ) : null
          )}

        {/* Colonnes de survol invisibles + curseur vertical */}
        {donnees.map((d, i) => {
          const demi = n === 1 ? LARG / 2 : (x(1) - x(0)) / 2;
          const survol = actif === i;
          return (
            <g key={`zone-${i}`}>
              <rect
                x={x(i) - demi}
                y={MARG.haut}
                width={demi * 2}
                height={HAUT - MARG.haut - MARG.bas}
                fill="transparent"
                onMouseEnter={() => setActif(i)}
              />
              {survol && <line x1={x(i)} x2={x(i)} y1={MARG.haut} y2={HAUT - MARG.bas} className="lc-curseur" />}
            </g>
          );
        })}

        {/* Tooltip (SVG, suit la colonne survolee) */}
        {actif != null && donnees[actif] && (
          <g className="lc-tooltip" pointerEvents="none">
            {(() => {
              const d = donnees[actif];
              const lignes = [d.label, `${fmtNombre(Number(d.valeur))}${unite}`];
              if (Number.isFinite(Number(d.secondaire))) {
                lignes.push(`${fmtNombre(Number(d.secondaire))} ${labelSecondaire.toLowerCase()}`);
              }
              const boiteL = Math.max(...lignes.map((s) => s.length)) * 6.2 + 18;
              const boiteH = 14 + lignes.length * 15;
              let bx = x(actif) + 12;
              if (bx + boiteL > LARG - MARG.droite) bx = x(actif) - 12 - boiteL;
              const by = Math.max(MARG.haut, y(Number(d.valeur)) - boiteH - 8);
              return (
                <>
                  <rect x={bx} y={by} rx={6} width={boiteL} height={boiteH} className="lc-tooltip-fond" />
                  {lignes.map((s, k) => (
                    <text
                      key={`tt-${k}`}
                      x={bx + 9}
                      y={by + 20 + k * 15}
                      className={k === 0 ? 'lc-tooltip-titre' : 'lc-tooltip-valeur'}
                    >
                      {s}
                    </text>
                  ))}
                </>
              );
            })()}
          </g>
        )}
      </svg>

      {/* Legende uniquement si une serie secondaire existe */}
      {pointsSec && (
        <div className="lc-legende">
          <span className="lc-legende-item">
            <span className="lc-pastille lc-pastille-courbe" aria-hidden="true" /> {labelSerie} ({unite})
          </span>
          <span className="lc-legende-item">
            <span className="lc-pastille lc-pastille-sec" aria-hidden="true" /> {labelSecondaire}
          </span>
        </div>
      )}
    </div>
  );
}
