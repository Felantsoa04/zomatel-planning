'use client';

// NUMÉRISATION DES PLANNINGS PAPIER (RH uniquement) :
//   1. Import des photos/scans des plannings préparés par les chefs de service;
//   2. OCR automatique (reconnaissance des tableaux) ;
//   3. Vérification/correction par la RH (comparaison avec le document) ;
//   4. Confirmation -> planning BROUILLON (circuit existant : grille,
//      soumission, validation, export groupé Excel par semaine).

import AppShell from '@/components/AppShell';
import NumerisationClient from '@/components/NumerisationClient';

export default function NumerisationPage() {
  return (
    <AppShell>
      <NumerisationClient />
    </AppShell>
  );
}
