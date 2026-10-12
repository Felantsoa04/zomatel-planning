'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const LOCALES = { fr: 'fr-FR', mg: 'mg-MG', en: 'en-GB' };
const LIBELLES = {
  fr: {
    title: 'Calendrier',
    today: "Aujourd'hui",
    previousMonth: 'Mois précédent',
    nextMonth: 'Mois suivant',
    weekdays: ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'],
  },
  mg: {
    title: 'Kalandrie',
    today: 'Anio',
    previousMonth: 'Volana teo aloha',
    nextMonth: 'Volana manaraka',
    weekdays: ['Al', 'Ta', 'Ar', 'Ak', 'Zo', 'As', 'Ah'],
  },
  en: {
    title: 'Calendar',
    today: 'Today',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  },
};

function estMemeJour(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function joursDuMois(mois) {
  const premierJour = new Date(mois.getFullYear(), mois.getMonth(), 1);
  const decalageLundi = (premierJour.getDay() + 6) % 7;
  const debutGrille = new Date(mois.getFullYear(), mois.getMonth(), 1 - decalageLundi);

  return Array.from({ length: 42 }, (_, index) => (
    new Date(debutGrille.getFullYear(), debutGrille.getMonth(), debutGrille.getDate() + index)
  ));
}

export default function CalendarWidget({ plannings = [] }) {
  const { langue, t } = useI18n();
  const [selection, setSelection] = useState(() => new Date());
  const [moisAffiche, setMoisAffiche] = useState(() => {
    const maintenant = new Date();
    return new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  });
  const locale = LOCALES[langue] || LOCALES.fr;
  const textes = LIBELLES[langue] || LIBELLES.fr;
  const jours = joursDuMois(moisAffiche);

  function naviguerMois(decalage) {
    setMoisAffiche((mois) => new Date(mois.getFullYear(), mois.getMonth() + decalage, 1));
  }

  function revenirAujourdhui() {
    const maintenant = new Date();
    setSelection(maintenant);
    setMoisAffiche(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  }

  function choisirJour(jour) {
    setSelection(jour);
    if (jour.getMonth() !== moisAffiche.getMonth() || jour.getFullYear() !== moisAffiche.getFullYear()) {
      setMoisAffiche(new Date(jour.getFullYear(), jour.getMonth(), 1));
    }
  }

  return (
    <section className="calendar-widget" aria-labelledby="calendar-widget-title">
      <div className="calendar-widget-heading">
        <h2 id="calendar-widget-title">
          <CalendarDays size={17} aria-hidden="true" />
          {textes.title}
        </h2>
      </div>

      <div className="calendar-widget-navigation">
        <button
          type="button"
          className="calendar-widget-nav-button"
          onClick={() => naviguerMois(-1)}
          aria-label={textes.previousMonth}
        >
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <h3 aria-live="polite">
          {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(moisAffiche)}
        </h3>
        <button
          type="button"
          className="calendar-widget-nav-button"
          onClick={() => naviguerMois(1)}
          aria-label={textes.nextMonth}
        >
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="calendar-widget-grid" role="grid" aria-label={textes.title}>
        {textes.weekdays.map((jour, index) => (
          <span className="calendar-widget-weekday" role="columnheader" key={`${jour}-${index}`}>
            {jour}
          </span>
        ))}
        {jours.map((jour) => {
          const memeMois = jour.getMonth() === moisAffiche.getMonth();
          const selectionnee = estMemeJour(jour, selection);
          const aujourdHui = estMemeJour(jour, new Date());
          const cleJour = `${jour.getFullYear()}-${String(jour.getMonth() + 1).padStart(2, '0')}-${String(jour.getDate()).padStart(2, '0')}`;
          const aPlanning = plannings.some((planning) => {
            const debut = String(planning.date_debut_semaine || planning.date_debut || '').slice(0, 10);
            const fin = String(planning.date_fin_semaine || planning.date_fin || '').slice(0, 10);
            return debut && fin && debut <= cleJour && cleJour <= fin;
          });
          return (
            <button
              type="button"
              className={[
                'calendar-widget-day',
                !memeMois ? 'hors-mois' : '',
                selectionnee ? 'selectionne' : '',
                aujourdHui ? 'aujourdhui' : '',
                aPlanning ? 'avec-planning' : '',
              ].filter(Boolean).join(' ')}
              key={jour.getTime()}
              onClick={() => choisirJour(jour)}
              aria-pressed={selectionnee}
              aria-current={aujourdHui ? 'date' : undefined}
              aria-label={`${new Intl.DateTimeFormat(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(jour)}${aPlanning ? `, ${t('dashboard.planningExists')}` : ''}`}
            >
              <span>{jour.getDate()}</span>
              {aPlanning && <span className="calendar-widget-indicator" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <button type="button" className="calendar-widget-today" onClick={revenirAujourdhui}>
        {textes.today}
      </button>
    </section>
  );
}
