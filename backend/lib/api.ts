const API_URL = process.env.NEXT_PUBLIC_API_URL;

export interface Service {
  id_service: number;
  code: string;
  nom: string;
  actif: number;
}

export async function fetchServices(): Promise<Service[]> {
  const res = await fetch(`${API_URL}/services`);
  if (!res.ok) throw new Error('Erreur lors du chargement des services');
  return res.json();
}

export async function fetchHealth(): Promise<{ status: string; db: boolean }> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error('Erreur health check');
  return res.json();
}