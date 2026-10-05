'use client';

// PAGE MESSAGERIE — route dédiée /messagerie.
// Garde : seules les sessions autorisées voient cette page (Employe redirigé
// vers le login ; la permission messenger.use est revérifiée par chaque
// appel API — un compte sans permission verra une erreur claire).

import AppShell from '@/components/AppShell';
import MessengerPage from '@/components/MessengerPage';

export default function MessageriePage() {
  return (
    <AppShell>
      <MessengerPage />
    </AppShell>
  );
}
