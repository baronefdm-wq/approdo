# Come preparare il sito per un nuovo B&B

Tempo stimato: 1-2 ore con foto e testi già pronti.

## 1. Raccogliere dal cliente
- Nome della struttura, tipo (B&B, casa vacanza…), indirizzo, email, telefono.
- **CIN** (codice identificativo nazionale): è obbligatorio mostrarlo.
- Per ogni camera: nome, breve descrizione, metri quadri, letti, ospiti massimi, prezzo a notte.
- Foto: una principale e una per camera (orizzontali, almeno 1600 px di larghezza). **Solo foto del cliente o con licenza**, mai prese da Booking o Airbnb.
- Orari di check-in e check-out, notti minime, sconto per chi prenota direttamente.
- Email su cui ricevere le richieste e la casella da cui inviare (dati SMTP).
- Se è su Booking o Airbnb: i link .ics dei calendari di ogni camera.

## 2. Configurare
1. Creare una copia del repository per il cliente (un repository per struttura).
2. Modificare `config/struttura.json`. Gli `id` delle camere vanno scritti in minuscolo senza spazi (es. `camera-mare`) e non vanno più cambiati dopo la pubblicazione.
3. Copiare le foto in `public/foto/` e scrivere i nomi dei file in `fotoPrincipale` e nel campo `foto` di ogni camera.
4. Eseguire `npm run check`: segnala foto mancanti, testi senza traduzione, CIN o contatti di esempio.
5. Eseguire `npm test`.

## 3. Pubblicare
1. Render → New → Blueprint → repository del cliente.
2. Compilare `SITE_URL`, `NOTIFY_EMAIL_TO`, `SMTP_*` e cambiare `DATA_MODE` in `live`.
3. Collegare il dominio del cliente in Render (Settings → Custom domains).
4. Entrare in `/gestione` con la password generata da Render e controllare orari e prezzi.
5. In **Impostazioni → Collegamento con Booking e Airbnb**: incollare i link .ics delle piattaforme e caricare sulle piattaforme il "Calendario del sito" di ogni camera.

## 4. Prova finale con il cliente
- Fare una richiesta di prova dal telefono, verificare che arrivi l'email al gestore.
- Confermarla dall'area gestore e verificare l'email all'ospite.
- Cancellarla da **Date occupate**.
