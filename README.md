# Archivio proposte di tesi

Piattaforma web per raccogliere le proposte di tesi (triennali e magistrali). Gli studenti inviano una richiesta senza registrarsi; i docenti accedono con un account personale per valutarla. Il sito è statico e ospitato su GitHub Pages; i dati stanno in un database Supabase protetto da regole di sicurezza; le email partono dal database tramite un account Gmail dedicato e un piccolo script di Google.

## Cosa fa

- **Archivio pubblico** con tipo di tesi (triennale o magistrale, in evidenza), candidato, docente, sessione, descrizione, titolo e stato, filtrabile e ricercabile. Mostra le richieste in attesa e le tesi approvate.
- **Statistiche pubbliche**: candidati per sessione e per docente, suddivisi tra triennali e magistrali, con i posti occupati.
- **Modulo senza login**: lo studente indica nome, cognome, matricola, email, telefono, tipo di tesi, docente (scrivendo le prime lettere del cognome compare l'elenco dei suggerimenti), sessione di laurea prevista e una descrizione della richiesta. Titolo e allegato PDF (massimo 5 MB) sono facoltativi. Matricola, email, telefono e allegato sono visibili solo al docente scelto e agli amministratori.
- **Una sola richiesta attiva per matricola**, per impedire che uno studente contatti più docenti e scelga a posteriori. Le richieste rifiutate o ritirate lasciano l'archivio e liberano la matricola.
- **Due limiti per docente**, uno per le triennali e uno per le magistrali. Le richieste in attesa e approvate occupano un posto; a posti esauriti il docente non è selezionabile nel modulo e il database rifiuta nuovi invii. Ogni docente imposta i propri limiti; l'amministratore può modificare quelli di tutti.
- **Area docenti**: ogni docente vede e gestisce le proprie richieste (approva, rifiuta, modifica titolo, sessione, tipo di tesi e dati di contatto, aggiunge note riservate, inserisce una richiesta a mano). Il titolo definitivo è obbligatorio per approvare.
- **Amministratore**: vede tutto, riassegna i docenti, gestisce sessioni e account, esporta l'elenco in CSV (separatore punto e virgola, compatibile con Excel).
- **Storico** di ogni richiesta (creazione, stato, sessione, docente, tipo, titolo) con data e autore.
- **Email automatiche**: conferma allo studente, avviso al docente, esito della valutazione.

## File del repository

```
index.html            archivio pubblico e modulo di richiesta
docenti.html          area docenti e amministratori
privacy.html          informativa privacy (bozza da completare)
css/style.css
js/config.js          indirizzo e chiave pubblica di Supabase (da compilare al passo 4)
js/common.js, public.js, staff.js
supabase/schema.sql   database, sicurezza ed email (si esegue una sola volta, al passo 1)
README.md
```

Carica tutto su GitHub. Il file `supabase/schema.sql` non serve al sito: viene incollato una volta in Supabase e nel repository resta come copia di riserva.

## Cosa serve

1. Un account **GitHub** (gratuito).
2. Un account **Supabase** (gratuito), su [supabase.com](https://supabase.com).
3. Un **nuovo indirizzo Gmail dedicato al servizio** (gratuito), da cui partiranno le email automatiche. Non usare il tuo indirizzo personale: l'account del servizio può essere condiviso con la segreteria o con un collega.

## Passo 1: creare il database

1. Su Supabase scegli New project. Assegna un nome, imposta una password del database (conservala) e scegli una **regione europea** (ad esempio Frankfurt). Attendi la creazione.
2. Apri **SQL Editor**, scegli New query, incolla **tutto** il contenuto di `supabase/schema.sql` e premi Run.
3. Deve comparire "Success". Se compare un errore, copia il messaggio e fermati: lo schema va eseguito su un progetto nuovo e vuoto; in caso di errore a metà la via più semplice è creare un altro progetto e ripartire da qui.
4. In **Table Editor**, tabella `sessions`, modifica i nomi delle sessioni di laurea in base al tuo calendario (le tre di esempio sono Estiva 2027, Autunnale 2027, Invernale 2028). Puoi aggiungerne altre anche dall'area amministratore.

## Passo 2: creare gli account

1. In **Authentication**, **Users**, scegli Add user, Create new user. Inserisci email e password e **attiva "Auto Confirm User"**.
2. Torna in SQL Editor e collega l'utente a un profilo. Per te, come amministratore, sostituisci l'email e il nome:

```sql
insert into public.profiles (id, full_name, email, role)
select id, 'Prof. Nome Cognome', email, 'admin'
from auth.users where email = 'tua@email.it';
```

3. Il nome scritto in `full_name` è quello che gli studenti vedono e cercano nel campo docente: includi il titolo (`Prof.` o `Prof.ssa`) e scrivi nome e cognome per esteso. Per ogni docente ripeti i due passaggi con `'teacher'` al posto di `'admin'`. Se un docente deve anche assegnarsi tesi come amministratore, usa `'admin'`.
4. In **Authentication**, **URL Configuration**, imposta come Site URL l'indirizzo del sito (lo conosci dopo il passo 5; puoi tornare qui in seguito).

## Passo 3: attivare le email

Le email partono da un indirizzo Gmail dedicato, tramite un piccolo script di Google (Apps Script). È gratuito, non richiede un dominio e non usa il tuo indirizzo personale. Il database chiama lo script, e lo script invia il messaggio.

**3.1 Crea l'account.** Crea un nuovo account Gmail, ad esempio `archivio.tesi.nomedipartimento@gmail.com`, e conserva le credenziali in un posto sicuro.

**3.2 Crea lo script.** Accedi con quell'account, vai su [script.google.com](https://script.google.com) e scegli Nuovo progetto. Cancella il codice di esempio e incolla questo:

```javascript
const TOKEN = 'INVENTA_UN_CODICE_SEGRETO_LUNGO';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== TOKEN) return ContentService.createTextOutput('forbidden');
    const msg = { to: d.to, subject: d.subject, htmlBody: d.html, name: d.name || 'Archivio tesi' };
    if (d.replyTo) msg.replyTo = d.replyTo;
    MailApp.sendEmail(msg);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}

// Si esegue una sola volta, per concedere il permesso di inviare email.
function autorizza() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Prova autorizzazione', 'Autorizzazione concessa.');
}
```

Al posto di `INVENTA_UN_CODICE_SEGRETO_LUNGO` scrivi una stringa lunga e casuale (almeno 30 caratteri) e copiala da qualche parte: ti serve al punto 3.5. Salva il progetto con l'icona del dischetto.

**3.3 Concedi il permesso.** Nel menu a tendina in alto scegli la funzione `autorizza` e premi Esegui. Google chiede l'autorizzazione: scegli l'account e, se compare "Google non ha verificato questa app", premi Avanzate, poi "Vai a (nome progetto)" e Consenti. Il permesso serve solo a inviare email da quell'account. Riceverai un messaggio di prova.

**3.4 Pubblica lo script.** Premi Deploy (Esegui il deployment), Nuovo deployment, clicca l'ingranaggio accanto a "Seleziona tipo" e scegli Applicazione web. Imposta "Esegui come: Me" e "Chi ha accesso: Chiunque", poi Deploy. Copia l'**URL dell'applicazione web** (inizia con `https://script.google.com/macros/s/`). L'accesso "Chiunque" serve perché a chiamare lo script è il database, non una persona con account Google; il codice segreto impedisce a chiunque altro di usarlo.

**3.5 Collega lo script al database.** Nell'SQL Editor di Supabase esegui, sostituendo i valori:

```sql
insert into public.app_config (key, value) values
  ('email_webhook_url', 'INCOLLA_L_URL_DELL_APPLICAZIONE_WEB'),
  ('email_token',       'IL_CODICE_SEGRETO_DEL_PUNTO_3.2'),
  ('email_from_name',   'Archivio tesi'),
  ('site_url',          'https://TUOUTENTE.github.io/NOMEREPO')
on conflict (key) do update set value = excluded.value;
```

**3.6 Prova.** Esegui, con la tua email:

```sql
select public._send_email('tua@email.it', 'Prova', '<p>Email di prova.</p>');
```

Dopo qualche secondo il messaggio deve arrivare (la prima volta controlla anche lo spam e segnalalo come sicuro). Per vedere cosa ha risposto lo script:

```sql
select id, status_code, left(content, 200) as risposta, error_msg
from net._http_response order by id desc limit 3;
```

Un `status_code` 200 o 302 indica che la richiesta è arrivata allo script; la conferma definitiva è l'email in arrivo.

**Come funziona e limiti**

- Lo studente che risponde a un'email del sistema scrive direttamente al docente, perché l'indirizzo di risposta è quello del docente.
- Gli account Gmail gratuiti possono inviare circa 100 messaggi al giorno (limite di Google per Apps Script). Ogni nuova richiesta genera due email e ogni esito una, quindi basta per decine di richieste al giorno. Superato il limite i messaggi non partono, senza errori visibili sul sito.
- Se in futuro modifichi il codice dello script, devi ripubblicarlo: Deploy, Gestisci deployment, icona della matita, Versione: Nuova versione, Deploy. L'URL non cambia.

## Passo 4: collegare il sito al database

1. In Supabase apri **Project Settings**, **API**, e copia **Project URL** e la chiave **anon public** (non la `service_role`).
2. Su GitHub apri `js/config.js`, premi l'icona della matita, sostituisci `SUPABASE_URL` e `SUPABASE_ANON_KEY` con i valori copiati e conferma con Commit changes. La chiave anon è pensata per essere pubblica: la protezione dei dati è affidata alle regole di sicurezza create dallo schema.

## Passo 5: pubblicare il sito

1. Carica nel repository `index.html`, `docenti.html`, `privacy.html`, le cartelle `css` e `js` e il resto dei file (ricarica anche quelli già presenti, per avere le versioni più recenti).
2. In **Settings**, **Pages**, alla voce Build and deployment scegli Source: **Deploy from a branch**, Branch: `main`, cartella `/ (root)`, poi Save.
3. Dopo uno o due minuti il sito è all'indirizzo `https://TUOUTENTE.github.io/NOMEREPO/`. Con un account GitHub gratuito il repository deve essere pubblico; non contiene segreti.
4. Se non l'hai già fatto, imposta questo indirizzo come Site URL (passo 2, punto 4) e come `site_url` (passo 3).

## Passo 6: prova completa

1. Apri il sito: devono comparire le statistiche con le sessioni.
2. Invia una richiesta di prova con una tua email vera. Controlla che arrivino la conferma allo studente e l'avviso al docente.
3. Apri `docenti.html`, entra con l'account del docente scelto, inserisci il titolo definitivo e approva. Controlla l'email di esito e che la richiesta risulti approvata nell'archivio.
4. Cancella la richiesta di prova dall'area amministratore (finestra di modifica, Elimina).

## Uso quotidiano

- **Cambio di sessione, ritiro, correzioni**: lo studente scrive al docente, che modifica la richiesta dall'area docenti. Il ritiro libera il posto.
- **Limiti di tesi**: ogni docente li imposta nella scheda in cima all'area docenti; vuoto significa nessun limite. L'amministratore può modificare quelli di tutti dalla scheda Docenti.
- **Nuovo docente**: crea l'utente e il profilo come al passo 2. Per sospendere un docente usa Disattiva nella scheda Docenti.
- **Nuova sessione**: scheda Sessioni dell'area amministratore.
- **Richiesta arrivata di persona**: il pulsante Nuova richiesta nell'area docenti la inserisce a mano; se è già approvata, lo studente riceve solo l'email di esito.

## Se qualcosa non funziona

- **Il sito mostra "Impossibile caricare i dati"**: controlla `js/config.js` (indirizzo e chiave corretti, nessuno spazio in più).
- **"Questo account non è abilitato come docente"**: manca il profilo del passo 2 oppure l'account è disattivato.
- **Le email non arrivano**: ripeti la prova del passo 3.6 e leggi `status_code` ed `error_msg`. Controlla la cartella spam. Verifica che il deployment dello script sia impostato su "Chiunque" e che il codice segreto nello script e quello in `app_config` coincidano (se sono diversi lo script risponde "forbidden" senza inviare nulla). Su script.google.com, sezione Esecuzioni, compaiono gli errori dello script. Per controllare quali impostazioni sono presenti senza mostrare i valori: `select key from public.app_config;` (devono comparire `email_webhook_url`, `email_token`, `email_from_name`, `site_url`).
- **Un invio non riesce**: il messaggio d'errore mostrato nel modulo indica il motivo (matricola già con una richiesta attiva, docente senza posti, troppi invii dallo stesso indirizzo, dati non validi).

## Sicurezza e privacy

- L'utente anonimo legge solo richieste in attesa o approvate e i campi pubblici. Matricola, email, telefono, allegati, note e storico stanno in tabelle riservate al docente della tesi e agli amministratori.
- Gli invii passano da una funzione del database che valida i campi, blocca le matricole con una richiesta già attiva e limita a tre gli invii orari per indirizzo email; il modulo contiene anche un campo trappola contro i programmi automatici.
- Gli allegati stanno in un archivio privato; il docente li apre con un link che scade dopo due minuti. I PDF caricati e mai associati a una richiesta (invio non andato a buon fine) si possono eliminare dalla sezione Storage di Supabase, cartella `uploads`.
- Il testo inserito dagli studenti è sempre mostrato con escape HTML e le celle del CSV che iniziano con caratteri di formula sono neutralizzate.
- L'indirizzo dello script e il codice segreto sono salvati in una tabella non leggibile dal sito.
- `privacy.html` contiene una bozza di informativa ex artt. 13-14 GDPR, collegata al modulo. Le parti evidenziate in giallo (titolare, RPD, base giuridica, regione dei server, periodo di conservazione, servizio email, data) vanno completate con il titolare del trattamento e il RPD prima della messa in produzione.
