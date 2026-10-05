import './globals.css';
import './globals-ui.css';
import './globals-dark.css';

export const metadata = {
  title: 'Zomatel - Gestion de planning',
  description: 'Planning des services Zomatel',
};

// Script ANTI-FLASH : applique le theme (clair/sombre) stocke AVANT le premier
// rendu (s'execute avant React, silencieux si le stockage est indisponible).
const SCRIPT_THEME = `(function(){try{if(localStorage.getItem('zomatel:theme')==='sombre'){document.documentElement.dataset.theme='sombre';}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
