import express from 'express';
import { createLogger } from '../logger.js';
import * as db from '../db.js';
import { collectErrors, date as validateDate, str, MAX_SHORT, MAX_TEXT } from '../middleware/validate.js';
import { deleteAnniversaryArtifacts, syncAnniversaryArtifacts } from '../services/anniversaries.js';
import { birthDateInput, validateYearUnknown } from '../services/birthdays.js';

const log = createLogger('Anniversaries');
const router = express.Router();

// Dieselben Werte wie der Erinnerungs-Auswahl im Geburtstags-Editor.
const REMINDER_OFFSETS = ['', '0', '1440', '2880', '10080', 'custom'];
const REMINDER_UNITS = ['minutes', 'hours', 'days', 'weeks'];

// Jede Seite ist eine Verknüpfung zu einem Geburtstag ODER ein Freitext-Name,
// nie beides. Die Datenbank erzwingt die Pflicht einer Seite (CHECK), dieser
// Schritt sagt ehrlich, was falsch ist.
function validateSide(body, side) {
  const idRaw = body[`person_${side}_birthday_id`];
  const nameRaw = body[`person_${side}_name`];
  const birthdayId = idRaw === undefined || idRaw === null || idRaw === '' ? null : Number(idRaw);
  if (birthdayId !== null && (!Number.isInteger(birthdayId) || birthdayId <= 0)) {
    return { value: null, error: `Person ${side.toUpperCase()} must reference a birthday.` };
  }
  const name = nameRaw === undefined || nameRaw === null ? '' : String(nameRaw).trim();
  if (birthdayId === null && name === '') {
    return { value: null, error: `Person ${side.toUpperCase()} needs a name or a linked birthday.` };
  }
  if (name.length > MAX_SHORT) {
    return { value: null, error: `Person ${side.toUpperCase()} name is too long.` };
  }
  return { value: { birthdayId, name: birthdayId === null ? name : null }, error: null };
}

function validateReminder(body) {
  const offset = body.reminder_offset === undefined ? undefined : (body.reminder_offset ?? null);
  if (offset !== undefined && offset !== null && !REMINDER_OFFSETS.includes(String(offset))) {
    return { error: 'Reminder offset is not supported.' };
  }
  const unit = body.reminder_custom_unit;
  if (unit !== undefined && unit !== null && !REMINDER_UNITS.includes(unit)) {
    return { error: 'Reminder unit is not supported.' };
  }
  return { offset: offset === undefined ? null : offset, unit: unit ?? null, error: null };
}

const ANNIVERSARY_SELECT = `
  SELECT a.*,
         ba.name AS person_a_linked_name,
         bb.name AS person_b_linked_name
    FROM anniversaries a
    LEFT JOIN birthdays ba ON ba.id = a.person_a_birthday_id
    LEFT JOIN birthdays bb ON bb.id = a.person_b_birthday_id`;

function loadAnniversary(id) {
  return db.get().prepare(`${ANNIVERSARY_SELECT} WHERE a.id = ?`).get(id);
}

router.get('/', (_req, res) => {
  try {
    const rows = db.get().prepare(`${ANNIVERSARY_SELECT} ORDER BY a.anniversary_date ASC`).all();
    res.json({ data: rows });
  } catch (err) {
    log.error('GET / error:', err);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

// Ohne Jahr zählt nur Tag und Monat: das Platzhalterjahr setzt der Dienst, bevor
// geprüft wird (wie bei Geburtstagen, birthDateInput).
function validateAnniversaryDate(raw, yearUnknown) {
  return validateDate(birthDateInput(raw, yearUnknown), 'Anniversary date', true);
}

router.post('/', (req, res) => {
  try {
    const sideA = validateSide(req.body, 'a');
    const sideB = validateSide(req.body, 'b');
    const vYearUnknown = validateYearUnknown(req.body.year_unknown, 'year_unknown');
    const yearUnknown = vYearUnknown.value === true;
    const vDate = validateAnniversaryDate(req.body.anniversary_date, yearUnknown);
    const vNotes = str(req.body.notes, 'Notes', { max: MAX_TEXT, required: false });
    const reminder = validateReminder(req.body);
    const errors = collectErrors([
      { error: sideA.error }, { error: sideB.error }, vYearUnknown, vDate, vNotes, { error: reminder.error },
    ]);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const result = db.get().prepare(`
      INSERT INTO anniversaries
        (person_a_birthday_id, person_a_name, person_b_birthday_id, person_b_name,
         anniversary_date, year_unknown, notes, reminder_offset, reminder_custom_unit, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sideA.value.birthdayId, sideA.value.name,
      sideB.value.birthdayId, sideB.value.name,
      birthDateInput(vDate.value, yearUnknown), yearUnknown ? 1 : 0, vNotes.value ?? null,
      reminder.offset, reminder.unit,
      req.authUserId || req.session.userId,
    );

    const row = loadAnniversary(result.lastInsertRowid);
    db.transaction(() => syncAnniversaryArtifacts(db.get(), row));
    res.status(201).json({ data: loadAnniversary(result.lastInsertRowid) });
  } catch (err) {
    log.error('POST / error:', err);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = loadAnniversary(id);
    if (!existing) return res.status(404).json({ error: 'Anniversary not found.', code: 404, reason: 'anniversaries_not_found' });

    // Fehlt ein Feld, bleibt der gespeicherte Wert. Eine Seite wird als Ganzes
    // ersetzt, sobald sie mitgeschickt wird, damit Verknüpfung und Freitext nie
    // zugleich stehen.
    const yearUnknownIn = validateYearUnknown(req.body.year_unknown, 'year_unknown');
    const yearUnknown = yearUnknownIn.value ?? existing.year_unknown === 1;
    const checks = [yearUnknownIn];
    const sideA = req.body.person_a_name !== undefined || req.body.person_a_birthday_id !== undefined
      ? validateSide(req.body, 'a') : { value: null, error: null };
    const sideB = req.body.person_b_name !== undefined || req.body.person_b_birthday_id !== undefined
      ? validateSide(req.body, 'b') : { value: null, error: null };
    checks.push({ error: sideA.error }, { error: sideB.error });
    const vDate = req.body.anniversary_date !== undefined
      ? validateAnniversaryDate(req.body.anniversary_date, yearUnknown) : null;
    if (vDate) checks.push(vDate);
    if (req.body.notes !== undefined) checks.push(str(req.body.notes, 'Notes', { max: MAX_TEXT, required: false }));
    const reminder = validateReminder(req.body);
    checks.push({ error: reminder.error });
    const errors = collectErrors(checks);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), code: 400 });

    const a = sideA.value ?? { birthdayId: existing.person_a_birthday_id, name: existing.person_a_name };
    const b = sideB.value ?? { birthdayId: existing.person_b_birthday_id, name: existing.person_b_name };
    const dateValue = vDate ? birthDateInput(vDate.value, yearUnknown) : existing.anniversary_date;
    const notes = req.body.notes !== undefined ? (req.body.notes || null) : existing.notes;

    db.get().prepare(`
      UPDATE anniversaries
         SET person_a_birthday_id = ?, person_a_name = ?,
             person_b_birthday_id = ?, person_b_name = ?,
             anniversary_date = ?, year_unknown = ?, notes = ?,
             reminder_offset = ?, reminder_custom_amount = ?, reminder_custom_unit = ?
       WHERE id = ?
    `).run(
      a.birthdayId, a.name, b.birthdayId, b.name,
      dateValue, yearUnknown ? 1 : 0, notes,
      req.body.reminder_offset !== undefined ? reminder.offset : existing.reminder_offset,
      req.body.reminder_custom_amount !== undefined ? (req.body.reminder_custom_amount ?? null) : existing.reminder_custom_amount,
      req.body.reminder_custom_unit !== undefined ? reminder.unit : existing.reminder_custom_unit,
      id,
    );

    const row = loadAnniversary(id);
    db.transaction(() => syncAnniversaryArtifacts(db.get(), row));
    res.json({ data: loadAnniversary(id) });
  } catch (err) {
    log.error('PUT /:id error:', err);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = loadAnniversary(id);
    if (!existing) return res.status(404).json({ error: 'Anniversary not found.', code: 404, reason: 'anniversaries_not_found' });
    db.transaction(() => {
      deleteAnniversaryArtifacts(db.get(), existing);
      db.get().prepare('DELETE FROM anniversaries WHERE id = ?').run(id);
    });
    res.status(204).end();
  } catch (err) {
    log.error('DELETE /:id error:', err);
    res.status(500).json({ error: 'Internal error.', code: 500 });
  }
});

export default router;
