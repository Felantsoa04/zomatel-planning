'use client';

import { CircleCheck, CircleX, FileEdit, Send } from 'lucide-react';
import { LABELS_STATUT } from '@/lib/dash';
import { useI18n } from '@/lib/i18n';

const CONFIGURATION_STATUT = {
  BROUILLON: { Icone: FileEdit, cle: 'status.BROUILLON' },
  SOUMIS: { Icone: Send, cle: 'status.SOUMIS' },
  VALIDE: { Icone: CircleCheck, cle: 'status.VALIDE' },
  REJETE: { Icone: CircleX, cle: 'status.REJETE' },
};

export function IconeStatutPlanning({ statut, size = 15 }) {
  const Icone = CONFIGURATION_STATUT[statut]?.Icone;
  return Icone ? <Icone size={size} aria-hidden="true" /> : null;
}

export default function BadgeStatutPlanning({
  statut,
  as: Element = 'span',
  className,
  title,
  ariaLabel,
  size = 15,
  compteur,
  ...props
}) {
  const { t } = useI18n();
  const configuration = CONFIGURATION_STATUT[statut];
  const libelle = configuration
    ? t(configuration.cle) || LABELS_STATUT[statut]
    : LABELS_STATUT[statut] || statut;
  const classes = className || `badge ${statut}`;
  const description = ariaLabel || title || libelle;

  return (
    <Element
      className={classes}
      title={title || libelle}
      aria-label={description}
      {...(Element === 'span' ? { role: 'img' } : {})}
      {...props}
    >
      {configuration ? <IconeStatutPlanning statut={statut} size={size} /> : libelle}
      {compteur != null && <> {compteur}</>}
    </Element>
  );
}
