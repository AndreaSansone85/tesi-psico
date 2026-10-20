// Inserire l'URL del progetto Supabase e la chiave "anon" (Project Settings > API).
// La chiave anon è pensata per essere pubblica: la sicurezza è garantita dalle regole RLS in schema.sql.
// Non inserire MAI la chiave "service_role" in questo file.
export const SUPABASE_URL = "https://bxvzvnfprsdrepnqfoou.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4dnp2bmZwcnNkcmVwbnFmb291Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTQ5OTMsImV4cCI6MjEwODA3MDk5M30.g454aOWMw2RsuW1z_PvV9GarVG1i8D69yHUtckCxacA";

// Chiave pubblica (site key) di Cloudflare Turnstile. Lasciare vuota per disattivare il controllo antispam
// aggiuntivo; se impostata, gli invii passano dalla funzione "submit-thesis" (vedi README).
export const TURNSTILE_SITE_KEY = "";
