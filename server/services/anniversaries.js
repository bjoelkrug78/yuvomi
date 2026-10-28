import { formatDateKey, resolveHouseholdFormats, translate } from '../utils/i18n.js';
import { householdTimeZone, todayKey } from '../utils/timezone.js';
import { markInlineOutbound, OUTBOUND_SOURCES, queueEventDeletion } from './calendar-outbound.js';
import { BIRTHDAY_COLOR, BIRTHDAY_RRULE, birthdayReminderAt } from './birthdays.js';

// Ein Jahrestag hat dieselbe Kalenderform wie ein Geburtstag: ganztägig,
// jährlich wiederkehrend, mittags erinnert. Nur Titel, Symbol und die Felder
// am Datensatz unterscheiden sich.
const ANNIVERSARY_ICON = 'heart';

// Die Namen beider Seiten: eine Verknüpfung nimmt den Namen des Geburtstags,
// ein Freitext den getippten Namen. Fehlt eine Seite ganz, bleibt sie leer.
function sideName(side) {
  return side.linkedName ?? side.freeName ?? '';
}

export function anniversaryNames(row) {
  return [sideName({ linkedName: row.person_a_linked_name, freeName: row.person_a_name }),
    sideName({ linkedName: row.person_b_linked_name, freeName: row.person_b_name })]
    .filter(Boolean)
    .join(' & ');
}

// Ordinalzahl in Englisch, wie "10th" oder "21st". Der Titel bleibt im Server,
// weil der Kalendereintrag auch über ICS und CalDAV ohne Browser ankommt.
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

// Jahre seit dem Jahrestag, nur wenn das Jahr bekannt ist. Ein Platzhalterjahr
// (#2095) ist kein Hochzeitsjahr, daraus eine Zahl zu machen wäre erfunden.
export function anniversaryYearsAt(anniversaryDate, yearUnknown, today) {
  if (yearUnknown) return null;
  const startYear = parseInt(String(anniversaryDate).slice(0, 4), 10);
  const currentYear = parseInt(String(today).slice(0, 4), 10);
  const years = currentYear - startYear;
  return years > 0 ? years : null;
}

export function anniversaryEventTitle(row, locale, today) {
  const names = anniversaryNames(row);
  const years = anniversaryYearsAt(row.anniversary_date, row.year_unknown === 1, today);
  return years != null
    ? translate(locale, 'anniversaries.calendarEventTitleCounted', { names, ordinal: ordinal(years) })
    : translate(locale, 'anniversaries.calendarEventTitle', { names });
}

export function anniversaryEventDescription(row, locale, dateFormat) {
  const names = anniversaryNames(row);
  if (row.year_unknown === 1) return translate(locale, 'anniversaries.calendarEventDescriptionNoDate', { names });
  const date = formatDateKey(row.anniversary_date, dateFormat);
  return translate(locale, 'anniversaries.calendarEventDescription', { names, date });
}

/**
 * Legt den Kalendertermin eines Jahrestags an, aktualisiert ihn oder räumt ihn
 * weg. Dieselben Regeln wie beim Geburtstag (syncBirthdayCalendarEvent): der
 * Termin folgt den Feldern am Datensatz, und ein gespiegelter Termin bekommt nur
 * die Felder, die der Jahrestag selbst hervorbringt.
 */
export function syncAnniversaryCalendarEvent(database, row) {
  const linkedEventId = row.calendar_event_id;
  const sourceDate = row.anniversary_date;

  if (!sourceDate || row.reminder_offset === '') {
    if (linkedEventId) {
      database.prepare(`
        DELETE FROM reminders
        WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
      `).run(linkedEventId, row.created_by);
      deleteCalendarEvent(database, linkedEventId);
      database.prepare('UPDATE anniversaries SET calendar_event_id = NULL WHERE id = ?').run(row.id);
    }
    return null;
  }

  const { locale, dateFormat } = resolveHouseholdFormats(database);
  const today = todayKey(database);
  const payload = {
    title: anniversaryEventTitle(row, locale, today),
    description: anniversaryEventDescription(row, locale, dateFormat),
    start_datetime: sourceDate,
    end_datetime: null,
    all_day: 1,
    location: null,
    color: BIRTHDAY_COLOR,
    icon: ANNIVERSARY_ICON,
    assigned_to: null,
    recurrence_rule: BIRTHDAY_RRULE,
    created_by: row.created_by,
  };

  if (linkedEventId) {
    const existing = database.prepare('SELECT * FROM calendar_events WHERE id = ?').get(linkedEventId);
    if (existing) {
      // Wie beim Geburtstag: ein gespiegelter Termin wird nur an den Feldern
      // geschrieben, die der Jahrestag hervorbringt, sonst entsteht ein Push
      // pro Abruf (siehe syncBirthdayCalendarEvent).
      const mirrored = OUTBOUND_SOURCES.includes(existing.external_source) && !!existing.external_calendar_id;
      if (mirrored) {
        database.prepare(`
          UPDATE calendar_events
          SET title = ?, description = ?, start_datetime = ?,
              end_datetime = CASE WHEN end_datetime IS NULL THEN NULL ELSE ? END
          WHERE id = ?
        `).run(payload.title, payload.description, payload.start_datetime, payload.start_datetime, linkedEventId);
        const authoredChanged = existing.title !== payload.title
          || existing.description !== payload.description
          || existing.start_datetime !== payload.start_datetime;
        if (authoredChanged) markInlineOutbound(database, existing);
      } else {
        database.prepare(`
          UPDATE calendar_events
          SET title = ?, description = ?, start_datetime = ?, end_datetime = ?, all_day = ?,
              location = ?, color = ?, icon = ?, assigned_to = ?, recurrence_rule = ?, created_by = ?
          WHERE id = ?
        `).run(
          payload.title, payload.description, payload.start_datetime, payload.end_datetime,
          payload.all_day, payload.location, payload.color, payload.icon, payload.assigned_to,
          payload.recurrence_rule, payload.created_by, linkedEventId,
        );
      }
      return linkedEventId;
    }
  }

  const result = database.prepare(`
    INSERT INTO calendar_events
      (title, description, start_datetime, end_datetime, all_day, location, color,
       icon, assigned_to, created_by, recurrence_rule, external_source, series_authored)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 1)
  `).run(
    payload.title, payload.description, payload.start_datetime, payload.end_datetime,
    payload.all_day, payload.location, payload.color, payload.icon, payload.assigned_to,
    payload.created_by, payload.recurrence_rule,
  );

  database.prepare('UPDATE anniversaries SET calendar_event_id = ? WHERE id = ?')
    .run(result.lastInsertRowid, row.id);
  return result.lastInsertRowid;
}

/**
 * Erinnerung wie beim Geburtstag: eine Zeile je Termin, neu angelegt nur, wenn
 * sich Vorlauf oder Datum ändern. Der Ablauf folgt syncBirthdayReminder.
 */
export function syncAnniversaryReminder(database, row, from = new Date()) {
  const eventId = row.calendar_event_id;
  if (!eventId) return null;
  const today = todayKey(database, from);
  const tz = householdTimeZone(database);

  if (row.reminder_offset === '') {
    database.prepare(`
      DELETE FROM reminders
      WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    `).run(eventId, row.created_by);
    return null;
  }

  const offsetMin = reminderOffsetMinutes(row);
  const desired = birthdayReminderAt(row.anniversary_date, offsetMin, today, tz);
  const existing = database.prepare(`
    SELECT * FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
    ORDER BY created_at DESC
  `).all(eventId, row.created_by);

  const current = existing.find((r) => r.remind_at === desired && r.dismissed === 0)
    ?? existing.find((r) => r.remind_at === desired);
  if (current) return current.id;

  database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
  `).run(eventId, row.created_by);

  const result = database.prepare(`
    INSERT INTO reminders (entity_type, entity_id, remind_at, created_by)
    VALUES ('event', ?, ?, ?)
  `).run(eventId, desired, row.created_by);
  return result.lastInsertRowid;
}

// Dieselbe Umrechnung wie getOffsetMinutes beim Geburtstag, auf die Spalten
// dieser Tabelle. Eine Kopie statt eines Imports, weil dort die Spaltennamen
// fest auf birthdays stehen.
function reminderOffsetMinutes(row) {
  if (row.reminder_offset === 'custom') {
    const amount = parseInt(row.reminder_custom_amount, 10) || 1;
    const unit = row.reminder_custom_unit || 'days';
    if (unit === 'weeks') return amount * 10080;
    if (unit === 'days') return amount * 1440;
    if (unit === 'hours') return amount * 60;
    return amount;
  }
  return parseInt(row.reminder_offset, 10) || 0;
}

export function syncAnniversaryArtifacts(database, row, from = new Date()) {
  const calendarEventId = syncAnniversaryCalendarEvent(database, row);
  const refreshed = { ...row, calendar_event_id: calendarEventId };
  syncAnniversaryReminder(database, refreshed, from);
  return refreshed;
}

/**
 * Löscht den Termin samt Erinnerung und merkt die Kopie beim Provider vor. Die
 * Reihenfolge ist dieselbe wie beim Geburtstag (deleteBirthdayArtifacts): die
 * Vormerkung muss vor dem DELETE passieren, sonst fehlt der Weg zum Objekt.
 */
export function deleteAnniversaryArtifacts(database, row) {
  if (!row.calendar_event_id) return;
  database.prepare(`
    DELETE FROM reminders
    WHERE entity_type = 'event' AND entity_id = ? AND created_by = ?
  `).run(row.calendar_event_id, row.created_by);
  deleteCalendarEvent(database, row.calendar_event_id);
}

function deleteCalendarEvent(database, eventId) {
  const event = database.prepare('SELECT * FROM calendar_events WHERE id = ?').get(eventId);
  if (event) queueEventDeletion(event, database);
  database.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
}
