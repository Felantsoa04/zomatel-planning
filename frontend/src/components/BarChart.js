'use client';

/* GRAPHIQUE EN BARRES VERTICALES (SVG pur, aucune dependance) — remplace la
 * courbe LineChart pour les donnees hebdomadaires (exigence 5).
 * - `data` : [{ label, valeur, secondaire? }] (meme format que LineChart).
 * - Serie principale : total_heures par semaine (donnees reelles de /plannings).
 * - Serie secondaire optionnelle : nombre de plannings par semaine.
 * - Compact : hauteur reduite, tooltip au survol, legende si serie secondaire.
 * - Etat vide explicite si aucune donnee (jamais de chiffre invente).
 * - Les donnees statistiques sont CONSERVEES : seule la presentation change.
 */

import { useMemo, useState } from 'react';

// Geometrie du SVG (viewBox) : compact (exigence 5 : graphique plus petit)
const LARG = 720;
const HAUT = 240;
const MARG = { haut: 14, droite: 12, bas: 32, gauche: 40 };

function fmtNombre(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

export default function BarChart({
  data,
  labelSerie = 'Heures planifiées',
  labelSecondaire = 'Plannings',
  unite = 'h',
}) {
  const donnees = useMemo(
    () => (data || []).filter((d) => d && d.label != null && Number.isFinite(Number(d.valeur))),
    [data]
  );
  const [actif, setActif] = useState(null); // index survole

  const n = donnees.length;
  const aSec = donnees.some((d) => Number.isFinite(Number(d.secondaire)));

  const maxVal = useMemo(
    () => Math.max(1, ...donnees.map((d) => Math.max(Number(d.valeur), Number(d.secondaire) || 0))),
    [donnees]
  );
  const pas = Math.pow(10, Math.floor(Math.log10(maxVal))) / 2 || 0.5;
  const maxAxe = Math.ceil(maxVal / pas) * pas;
  const nbTicks = 4;
  const ticks = Array.from({ length: nbTicks + 1 }, (_, i) => (maxAxe / nbTicks) * i);

  // Zones : chaque categorie occupe une tranche egale.
  const tranche = (LARG - MARG.gauche - MARG.droite) / Math.max(n, 1);
  const y = (v) => HAUT - MARG.bas - (v / maxAxe) * (HAUT - MARG.haut - MARG.bas);

  // Largeur des barres : 60 % de la tranche (2 series -> deux demi-barres).
  const largeurGroupe = aSec ? tranche * 0.62 : tranche * 0.5;
  const largeurBarre = aSec ? largeurGroupe / 2 : largeurGroupe;

  if (n === 0) {
    return <p className="muted dash-vide">Aucune donnée à afficher pour le moment.</p>;
  }

  // Etiquettes X espacees pour rester lisibles (mobile inclus)
  const pasLabel = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="bar-chart">
      <svg
        className="bar-chart-svg"
        viewBox={`0 0 ${LARG} ${HAUT}`}
        role="img"
        aria-label={`${labelSerie} par période${aSec ? `, et ${labelSecondaire.toLowerCase()} par période` : ''}`}
        onMouseLeave={() => setActif(null)}
      >
        {/* Grille horizontale + echelle Y */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARG.gauche} x2={LARG - MARG.droite} y1={y(t)} y2={y(t)} className="bc-grille" />
            <text x={MARG.gauche - 7} y={y(t)} dy="0.32em" textAnchor="end" className="bc-axe-y">
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
          className="bc-axe"
        />

        {donnees.map((d, i) => {
          const centreX = MARG.gauche + tranche * i + tranche / 2;
          const hPrincipale = Math.max((HAUT - MARG.bas) - y(Number(d.valeur)), 1.5);
          const aSecIci = Number.isFinite(Number(d.secondaire));
          const hSec = aSecIci ? Math.max((HAUT - MARG.bas) - y(Number(d.secondaire)), 1.5) : 0;
          const xBarre1 = aSec ? centreX - largeurBarre - 1 : centreX - largeurBarre / 2;
          const xBarre2 = centreX + 1;
          const survol = actif === i;
          return (
            <g key={`${d.label}-${i}`}>
              {/* Barre principale */}
              <rect
                x={xBarre1}
                y={y(Number(d.valeur))}
                width={Math.max(largeurBarre, 3)}
                height={hPrincipale}
                rx={3}
                className="bc-barre"
                opacity={survol ? 1 : 0.92}
              />
              {/* Barre secondaire (nombre de plannings) */}
              {aSecIci && (
                <rect
                  x={xBarre2}
                  y={y(Number(d.secondaire))}
                  width={Math.max(largeurBarre, 3)}
                  height={hSec}
                  rx={2}
                  className="bc-barre-sec"
                />
              )}
              {/* Etiquette X (espacee) */}
              {i % pasLabel === 0 && (
                <text x={centreX} y={HAUT - MARG.bas + 15} textAnchor="middle" className="bc-axe-x">
                  {d.label}
                </text>
              )}
              {/* Zone de survol (capture genereuse) */}
              <rect
                x={MARG.gauche + tranche * i}
                y={MARG.haut}
                width={tranche}
                height={HAUT - MARG.haut - MARG.bas}
                fill="transparent"
                onMouseEnter={() => setActif(i)}
              />
              {/* Valeur au-dessus de la barre survolee */}
              {survol && (
                <text
                  x={centreX}
                  y={y(Number(d.valeur)) - 5}
                  textAnchor="middle"
                  className="bc-axe-y"
                  style={{ fontWeight: 700, fill: 'var(--zom-texte)' }}
                >
                  {fmtNombre(Number(d.valeur))}{unite}
                </text>
              )}
            </g>
          );
        })}

        {/* Tooltip si serie secondaire (valeur secondaire affichee) */}
        {actif != null && donnees[actif] && aSec && Number.isFinite(Number(donnees[actif].secondaire)) && (
          <g pointerEvents="none">
            <rect
              x={Math.min(MARG.gauche + tranche * actif + tranche / 2 + 8, LARG - 150)}
              y={MARG.haut + 4}
              width={140}
              height={34}
              rx={6}
              className="bc-tooltip-fond"
            />
            <text
              x={Math.min(MARG.gauche + tranche * actif + tranche / 2 + 8, LARG - 150) + 8}
              y={MARG.haut + 19}
              className="bc-tooltip-titre"
            >
              {donnees[actif].label}
            </text>
            <text
              x={Math.min(MARG.gauche + tranche * actif + tranche / 2 + 8, LARG - 150) + 8}
              y={MARG.haut + 32}
              className="bc-tooltip-valeur"
            >
              {fmtNombre(Number(donnees[actif].secondaire))} {labelSecondaire.toLowerCase()}
            </text>
          </g>
        )}
      </svg>

      {/* Legende uniquement si une serie secondaire existe */}
      {aSec && (
        <div className="bc-legende">
          <span className="bc-legende-item">
            <span className="bc-pastille bc-pastille-principale" aria-hidden="true" /> {labelSerie} ({unite})
          </span>
          <span className="bc-legende-item">
            <span className="bc-pastille bc-pastille-sec" aria-hidden="true" /> {labelSecondaire}
          </span>
        </div>
      )}
    </div>
  );
}
