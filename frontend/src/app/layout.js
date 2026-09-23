import './globals.css';

export const metadata = {
  title: 'Zomatel - Gestion de planning',
  description: 'Planning des services Zomatel',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}