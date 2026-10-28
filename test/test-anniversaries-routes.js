/**
 * Modul: Jahrestage (server/routes/anniversaries.js, server/services/anniversaries.js)
 * Zweck: Ein Jahrestag hat zwei Personen. Jede Seite ist eine Verknüpfung zu
 *        einem Geburtstag ODER ein Freitext-Name. Der Termin folgt dem
 *        Geburtstags-Muster: ganztägig, jährlich, mit Erinnerung.
 * Ausführen: node --experimental-sqlite --test test/test-anniversaries-routes.js
 */
process.env.DB_PATH = ':memory:';
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const dbmod = await import('../server/db.js');
const { default: anniversariesRouter } = await import('../server/routes/anniversaries.js');
const { ordinal, anniversaryYearsAt } = await import('../server/services/anniversaries.js');
const db = dbmod.get();

const USER = db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('u','U','x','member')`).run().lastInsertRowid;
const actor = { id: USER, role: 'member' };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.authUserId = actor.id;
  req.authRole = actor.role;
  req.session = { userId: actor.id, role: actor.role };
  next();
});
app.use('/', anniversariesRouter);
const server = app.listen(0, '127.0.0.1');
const baseUrl = await new Promise((r) => server.on('listening', () => r(`http://127.0.0.1:${server.address().port}`)));
test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const BIRTHDAY_ANNA = db.prepare(`
  INSERT INTO birthdays (name, birth_date, created_by) VALUES ('Anna', '1990-05-01', ?)
`).run(USER).lastInsertRowid;

test('ordinal() schreibt die englische Form, auch für 11-13', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(10), '10th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(102), '102nd');
});

test('anniversaryYearsAt() zählt Jahre nur bei bekanntem Jahr', () => {
  assert.equal(anniversaryYearsAt('2016-06-01', false, '2026-10-28'), 10);
  assert.equal(anniversaryYearsAt('2016-06-01', true, '2026-10-28'), null);
  assert.equal(anniversaryYearsAt('2026-06-01', false, '2026-10-28'), null);
});

test('Freitext-Paar: legt Jahrestag an, mit Termin und Erinnerung', async () => {
  const res = await call('POST', '/', {
    person_a_name: 'Ben',
    person_b_name: 'Lena',
    anniversary_date: '2016-06-01',
    reminder_offset: '1440',
  });
  assert.equal(res.status, 201);
  const row = res.json.data;
  assert.equal(row.person_a_name, 'Ben');
  assert.equal(row.person_b_name, 'Lena');
  assert.equal(row.person_a_birthday_id, null);
  assert.ok(row.calendar_event_id, 'Kalendertermin muss angelegt sein');

  const event = db.prepare('SELECT title, recurrence_rule, all_day FROM calendar_events WHERE id = ?').get(row.calendar_event_id);
  assert.match(event.title, /Ben & Lena/);
  assert.match(event.title, /10th anniversary/);
  assert.equal(event.all_day, 1);
  assert.match(event.recurrence_rule, /FREQ=YEARLY/);
});

test('verknüpftes Paar: nimmt den Namen des Geburtstags', async () => {
  const res = await call('POST', '/', {
    person_a_birthday_id: BIRTHDAY_ANNA,
    person_b_name: 'Tom',
    anniversary_date: '2015-08-20',
    reminder_offset: '0',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.person_a_linked_name, 'Anna');
  const event = db.prepare('SELECT title FROM calendar_events WHERE id = ?').get(res.json.data.calendar_event_id);
  assert.match(event.title, /Anna & Tom/);
});

test('Seite ohne Name und ohne Verknüpfung wird abgelehnt', async () => {
  const res = await call('POST', '/', { person_b_name: 'Tom', anniversary_date: '2015-08-20' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Person A/);
});

test('ungültige Verknüpfung wird abgelehnt', async () => {
  const res = await call('POST', '/', {
    person_a_birthday_id: -3,
    person_b_name: 'Tom',
    anniversary_date: '2015-08-20',
  });
  assert.equal(res.status, 400);
});

test('Jahr unbekannt: kein Zählwert im Titel', async () => {
  const res = await call('POST', '/', {
    person_a_name: 'Mia',
    person_b_name: 'Jan',
    anniversary_date: '2000-03-03',
    year_unknown: true,
    reminder_offset: '',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.calendar_event_id, null, 'ohne Erinnerung kein Termin');
});

test('DELETE entfernt Jahrestag, Termin und Erinnerung', async () => {
  const created = await call('POST', '/', {
    person_a_name: 'Ida',
    person_b_name: 'Kai',
    anniversary_date: '2012-01-15',
    reminder_offset: '1440',
  });
  const { id, calendar_event_id: eventId } = created.json.data;
  const del = await call('DELETE', `/${id}`);
  assert.equal(del.status, 204);
  assert.equal(db.prepare('SELECT id FROM anniversaries WHERE id = ?').get(id), undefined);
  assert.equal(db.prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId), undefined);
  assert.equal(db.prepare('SELECT id FROM reminders WHERE entity_id = ?').get(eventId), undefined);
});

test('GET listet Jahrestage mit verknüpften Namen', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.ok(res.json.data.length >= 1);
});

test('Jahr unbekannt: der Tag wird mit dem Platzhalterjahr gespeichert', async () => {
  const res = await call('POST', '/', {
    person_a_name: 'Eva',
    person_b_name: 'Finn',
    anniversary_date: '2024-02-29',
    year_unknown: true,
    reminder_offset: '',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.anniversary_date, '2000-02-29', '29.02. bleibt gueltig');
  assert.equal(res.json.data.year_unknown, 1);
});

test('PUT ändert nur die mitgeschickten Felder', async () => {
  const created = await call('POST', '/', {
    person_a_name: 'Gil',
    person_b_name: 'Hanna',
    anniversary_date: '2010-07-07',
    notes: 'Garten',
    reminder_offset: '1440',
  });
  const id = created.json.data.id;
  const res = await call('PUT', `/${id}`, { notes: 'Terrasse' });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.notes, 'Terrasse');
  assert.equal(res.json.data.person_a_name, 'Gil');
  assert.equal(res.json.data.anniversary_date, '2010-07-07');
  assert.equal(res.json.data.reminder_offset, '1440', 'Erinnerung bleibt stehen, wenn sie nicht mitkommt');
});

test('PUT wechselt eine Seite von Freitext auf Verknüpfung', async () => {
  const created = await call('POST', '/', {
    person_a_name: 'Ida',
    person_b_name: 'Jonas',
    anniversary_date: '2008-04-04',
    reminder_offset: '1440',
  });
  const id = created.json.data.id;
  const res = await call('PUT', `/${id}`, { person_a_birthday_id: BIRTHDAY_ANNA });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.person_a_birthday_id, BIRTHDAY_ANNA);
  assert.equal(res.json.data.person_a_linked_name, 'Anna');
  const event = db.prepare('SELECT title FROM calendar_events WHERE id = ?').get(res.json.data.calendar_event_id);
  assert.match(event.title, /Anna & Jonas/, 'der Termin folgt der neuen Verknüpfung');
});

test('PUT auf unbekannten Jahrestag liefert 404', async () => {
  const res = await call('PUT', '/999999', { notes: 'x' });
  assert.equal(res.status, 404);
});
