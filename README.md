# Archivio proposte di tesi

Piattaforma web per la raccolta delle proposte di tesi. Gli studenti inviano una richiesta senza registrarsi; i docenti accedono con un account personale per valutarla. Il frontend è statico (GitHub Pages), i dati risiedono in un database Supabase (PostgreSQL) protetto da regole di sicurezza a livello di riga.

## Funzioni

- Archivio pubblico con tipo di tesi (triennale o magistrale, in evidenza con un'etichetta colorata), nome, cognome, descrizione della richiesta, titolo, docente, sessione e stato di ogni richiesta, filtrabile e ricercabile.
- Statistiche pubbliche: candidati per sessione e per docente, con suddivisione tra triennali e magistrali, tesi assegnate e in attesa, posti liberi.
- Modulo di richiesta senza login. Lo studente descrive l'area di interesse o l'idea di ricerca e indica la sessione di laurea prevista; il titolo è facoltativo. Se manca, l'archivio mostra "Titolo da definire" e il docente lo inserisce in fase di valutazione: il database non consente di approvare una richiesta senza titolo definitivo. Email, telefono e matricola sono salvati in una tabella separata, inaccessibile all'utente anonimo.
- Una sola richiesta attiva per matricola, per impedire che uno studente contatti più docenti e scelga a posteriori. Le richieste rifiutate o ritirate non compaiono nell'archivio e liberano la matricola.
- Avviso automatico quando il titolo proposto è simile a uno già presente.
- Allegato PDF facoltativo (massimo 5 MB) alla proposta, conservato in un bucket privato e apribile solo dal docente della tesi e dagli amministratori.
- Area docenti: ciascun docente vede e valuta solo le proprie richieste (approva, rifiuta, modifica sessione, titolo, dati di contatto, note riservate) e può inserire manualmente una richiesta per sé, ad esempio quando lo studente si è presentato di persona.
- Storico delle modifiche per ogni richiesta (creazione, stato, sessione, docente, titolo), con data e autore.
- Due limiti distinti per docente, uno per le tesi triennali e uno per le magistrali: le richieste in attesa e approvate occupano un posto. Raggiunto il limite di un livello, il docente non è più selezionabile nel modulo per quel livello e il database rifiuta nuovi invii, così nessuno studente propone una tesi destinata a essere respinta per mancanza di posti. Ogni docente imposta i propri limiti dall'area riservata; l'amministratore può modificare quelli di tutti. Le statistiche pubbliche mostrano i posti occupati per livello.
- Ruolo amministratore: vede tutte le richieste, inserisce richieste per qualsiasi docente, riassegna i docenti, può modificare i limiti di tutti, gestisce sessioni e attivazione degli account.
- Esportazione CSV (separatore punto e virgola, compatibile con Excel) dell'elenco filtrato.
- Email automatiche: conferma allo studente, avviso al docente, esito della valutazione.

Il cambio di sessione o il ritiro di una richiesta è gestito dal docente o dall'amministratore, come da specifica (gli studenti non hanno un login).

## Struttura

```
index.html          archivio pubblico e modulo di richiesta
docenti.html        area docenti e amministratori
css/style.css
js/config.js        URL e chiave anon di Supabase
js/common.js        client, statistiche, utilità
js/public.js        logica pagina pubblica
js/staff.js         logica area docenti
supabase/schema.sql schema, regole di sicurezza, dati iniziali
supabase/functions/notify/index.ts         invio email
supabase/functions/submit-thesis/index.ts  verifica Turnstile e registrazione della richiesta
.github/workflows/pages.yml          deploy automatico
```

## Installazione

### 1. Database

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Apri SQL Editor, incolla il contenuto di `supabase/schema.sql` ed eseguilo.
3. Modifica le sessioni iniziali (tabella `sessions`) in base al calendario del corso di laurea.

### 2. Account docenti e amministratore

1. In Authentication, Users, scegli Add user e inserisci email e password, con Auto Confirm User attivo.
2. Nello SQL Editor associa il profilo:

```sql
insert into public.profiles (id, full_name, email, role)
select id, 'Prof. Mario Rossi', email, 'teacher'
from auth.users where email = 'mario.rossi@uniroma2.it';
```

Usa `role = 'admin'` per il primo amministratore (tu). I docenti successivi si aggiungono allo stesso modo. Un account disattivato dalla scheda Docenti perde subito l'accesso e non è più selezionabile dagli studenti.

In Authentication, URL Configuration, imposta Site URL sull'indirizzo di GitHub Pages: serve al link di reimpostazione della password.

### 3. Frontend

1. Copia Project URL e chiave `anon` (Project Settings, API) in `js/config.js`. La chiave anon è pubblica per progetto; non inserire mai la chiave `service_role`.
2. Crea un repository GitHub, carica i file e in Settings, Pages scegli GitHub Actions come sorgente. Ogni push su `main` ripubblica il sito.

Per provare il sito in locale: `python3 -m http.server 8000` nella cartella del progetto, poi apri `http://localhost:8000`.

### 4. Antispam con Cloudflare Turnstile (facoltativo)

Il database limita già gli invii (tre all'ora per indirizzo email) e il modulo contiene un campo trappola. Per un controllo più forte:

1. Crea un widget Turnstile su [Cloudflare](https://dash.cloudflare.com) e copia site key e secret key.
2. Inserisci la site key in `TURNSTILE_SITE_KEY` dentro `js/config.js`.
3. Distribuisci la funzione, indicando l'indirizzo del sito per le regole CORS:

```bash
supabase secrets set TURNSTILE_SECRET=... ALLOWED_ORIGIN=https://utente.github.io
supabase functions deploy submit-thesis
```

4. Per rendere obbligatorio il controllo, esegui nello SQL Editor le due istruzioni `revoke` e `grant` riportate in fondo a `supabase/schema.sql`. Da quel momento l'invio diretto dal browser alla funzione del database non è più possibile.

Limite noto: il caricamento dell'allegato PDF avviene prima dell'invio e non è protetto da Turnstile. Il bucket accetta solo PDF fino a 5 MB con nome casuale e nessuna lettura pubblica; i file caricati e mai associati a una richiesta si possono eliminare periodicamente dalla sezione Storage della dashboard (cartella `uploads`).

### 5. Email automatiche (facoltativo)

1. Crea un account su [Resend](https://resend.com) e verifica il dominio di invio.
2. Installa la CLI di Supabase, collega il progetto e imposta i segreti:

```bash
supabase secrets set RESEND_API_KEY=... FROM_EMAIL="Archivio Tesi <tesi@tuodominio.it>" \
  WEBHOOK_SECRET=una-stringa-lunga-casuale SITE_URL=https://utente.github.io/archivio-tesi
supabase functions deploy notify --no-verify-jwt
```

3. In Database, Webhooks crea due webhook di tipo Supabase Edge Functions verso `notify`, entrambi con header `x-webhook-secret` uguale al segreto:
   - tabella `thesis_private`, evento Insert;
   - tabella `theses`, evento Update.

## Sicurezza e privacy

- L'utente anonimo può leggere solo richieste in attesa o approvate e i campi pubblici; non ha alcun accesso a `thesis_private`.
- Gli invii passano da una funzione del database (`submit_thesis`) che valida i campi, blocca le matricole con una richiesta già attiva e limita a tre invii orari per indirizzo email. Il modulo include inoltre un campo trappola antispam. Per un controllo più forte si può aggiungere Cloudflare Turnstile.
- I docenti non possono riassegnare le tesi ad altri docenti; l'eliminazione definitiva è riservata all'amministratore.
- Gli allegati stanno in un bucket privato; il docente li apre tramite un link firmato valido due minuti.
- Ogni modifica di stato, sessione, docente o titolo è registrata con autore e data e non è modificabile dal frontend.
- Il testo inserito dagli studenti viene sempre inserito nella pagina con escape HTML, e nell'export CSV le celle che iniziano con caratteri di formula sono neutralizzate.
- Il modulo richiede il consenso a un'informativa. Prima della messa in produzione occorre redigere l'informativa ex artt. 13-14 GDPR con il titolare del trattamento dell'ateneo e concordare i tempi di conservazione; Supabase va configurato su una regione europea.

## Evoluzioni possibili

Controllo Turnstile anche sul caricamento dell'allegato, pulizia automatica degli allegati orfani, notifiche riepilogative periodiche ai docenti, tracciamento delle modifiche anche per abstract e dati di contatto.
