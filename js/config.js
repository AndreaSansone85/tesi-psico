// Inserire l'URL del progetto Supabase e la chiave "anon" (Project Settings > API).
// La chiave anon è pensata per essere pubblica: la sicurezza è garantita dalle regole RLS in schema.sql.
// Non inserire MAI la chiave "service_role" in questo file.
export const SUPABASE_URL = "https://IL-TUO-PROGETTO.supabase.co";
export const SUPABASE_ANON_KEY = "INSERISCI-QUI-LA-CHIAVE-ANON";

// Chiave pubblica (site key) di Cloudflare Turnstile. Lasciare vuota per disattivare il controllo antispam
// aggiuntivo; se impostata, gli invii passano dalla funzione "submit-thesis" (vedi README).
export const TURNSTILE_SITE_KEY = "";
