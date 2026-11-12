# Approdo — sito e prenotazioni dirette per B&B

Sito per B&B, affittacamere e case vacanza con **prenotazione direttamente sul sito**:
l'ospite sceglie camera, date e orario di arrivo; il gestore riceve un'email, conferma o
rifiuta dall'area gestore e l'ospite riceve l'esito via email. Le date vendute su Booking e
Airbnb si sincronizzano con i calendari iCal, così non ci sono doppie prenotazioni.

Un solo file da cambiare per ogni cliente: **`config/struttura.json`** (nome, camere, testi in
italiano e inglese, distanze, contatti, CIN, regole). Istruzioni: [docs/nuovo-cliente.md](docs/nuovo-cliente.md).

Stack: Node.js 22.13+ senza framework, database SQLite integrato in Node (`node:sqlite`),
email via SMTP (`nodemailer`, unica dipendenza). Nessun servizio di terze parti, nessun tracciamento.

## Avvio in locale

```bash
npm install
cp .env.example .env    # poi compila ADMIN_PASSWORD e SESSION_SECRET
node --env-file=.env --no-warnings=ExperimentalWarning server.mjs
```

Sito su http://localhost:3000, area gestore su http://localhost:3000/gestione.

Controlli: `npm test` (8 test end-to-end con database temporaneo) · `npm run check` (controlla la configurazione della struttura).

## Cosa fa

**Ospite** (`/`)
- Sito in italiano e inglese generato da `config/struttura.json`: camere con prezzi, servizi, distanze, contatti, CIN.
- Calendario a due mesi per camera con le notti occupate; arrivo e partenza si scelgono cliccando.
- Orario di arrivo scelto solo dentro la fascia di check-in (passi di 30 minuti), numero di ospiti limitato alla camera, notti minime.
- Prezzo diretto con lo sconto rispetto ai portali.
- Dopo l'invio: email di riepilogo e pagina personale `/richiesta/<codice>` per vedere lo stato o annullare.

**Gestore** (`/gestione`, protetta da password)
- Richieste da gestire con tutti i dati dell'ospite; **Conferma** o **Rifiuta** con un messaggio facoltativo, che arriva all'ospite via email.
- La conferma controlla e blocca le date nella stessa transazione: due conferme sulle stesse notti non sono possibili.
- Planning a 21 giorni per camera, colorato per provenienza (sito, Booking, Airbnb, blocco manuale).
- Blocco manuale delle date (telefonate, manutenzioni, chiusure) e cancellazione.
- Impostazioni: orari di check-in e check-out, notti minime, sconto, anticipo massimo, prezzi per camera.
- Collegamento con Booking e Airbnb: link .ics per camera letti ogni 30 minuti; calendario del sito da caricare sulle piattaforme.
- Registro delle email inviate e non inviate.

**Sicurezza**
- Validazione completa sul server (date, orari, ospiti, disponibilità), campo trappola antispam, limiti per IP e per email.
- Sessione del gestore firmata (HttpOnly, SameSite, Secure su https), token CSRF su ogni modifica, limite ai tentativi di accesso.
- Le disponibilità pubbliche contengono solo date, mai dati degli ospiti.

## Notifiche email

Impostare `NOTIFY_EMAIL_TO` e `SMTP_*`. Va bene la casella del B&B (Aruba, Register, ecc.) o
Gmail con una "password per le app". Senza SMTP l'app funziona ma le email finiscono nel
registro come "non inviata": nessun invio simulato.

## Pubblicazione su Render

1. Su Render: **New → Blueprint** e scegliere questo repository: legge `render.yaml`.
2. Compilare `SITE_URL` (es. `https://approdo-casa-libeccio.onrender.com` o il dominio del B&B), `NOTIFY_EMAIL_TO` e `SMTP_*`.
3. `ADMIN_PASSWORD`, `SESSION_SECRET` e `ICAL_FEED_KEY` li genera Render: la password del gestore si legge in **Environment**.
4. Per la struttura vera impostare `DATA_MODE=live`.

Serve il piano **Starter** perché il database sta su un disco permanente (`/var/data`).

## Limiti da conoscere

- **Una sola istanza**: il database è un file. Per più istanze passare a PostgreSQL mantenendo le funzioni di `src/db.mjs`.
- **Nessun pagamento online**: la caparra si gestisce fuori (bonifico o link di pagamento) e si può indicare nel messaggio di conferma.
- **Nessun adempimento automatico**: invio degli ospiti alla Polizia (Alloggiati Web), dati per la Regione (Ross1000) e imposta di soggiorno restano a carico del gestore.
- **Booking e Airbnb aggiornano i calendari con ritardo** (da pochi minuti a qualche ora): resta un piccolo rischio di doppia prenotazione tra piattaforme, che la conferma manuale del gestore riduce.
- Foto: vanno messe in `public/foto/` e indicate nel file di configurazione.
