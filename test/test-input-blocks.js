/**
 * Modul: Eingabe-Bausteine und Dialogregeln (Critique R24, Schritt 3)
 * Zweck: Die Bausteine, die die Critique vom 26.10. app-weit vereinheitlicht
 *        hat, und dass ihre Aufrufer sie benutzen:
 *          - das Intervall als Satz (utils/interval-sentence.js): "Alle [2]
 *            Wochen" in Entsorgung, Abos und Haushaltshilfe, die Wortstellung
 *            aus dem Locale-Text;
 *          - die Zeitspanne Beginn/Ende in EINER Zeile (`.form-pair`) im
 *            Schichtart-Dialog, kein "image-off" am Symbol-Knopf.
 *        Der Farbwaehler hat seine eigene Suite (test:color-picker), die
 *        Personenzeile steht in test:people-pickers.
 * Ausführen: node --loader ./test/test-browser-loader.mjs --test test/test-input-blocks.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const { intervalSentenceHtml } = await import('../public/utils/interval-sentence.js');

// Echte Saetze einer Sprache fuer den Loader-Stub von t() (globalThis.__tDict).
const localeDict = (locale) => {
  const { common } = JSON.parse(readFileSync(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8'));
  return Object.fromEntries(Object.entries(common).filter(([k]) => k.startsWith('everyN')).map(([k, v]) => [`common.${k}`, v]));
};
const withLocale = (locale, fn) => {
  globalThis.__tDict = localeDict(locale);
  globalThis.__locale = locale;
  try { return fn(); } finally { delete globalThis.__tDict; delete globalThis.__locale; }
};
const words = (html) => [...html.matchAll(/<span class="interval-sentence__word"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

test('Intervall-Satz: das Feld steht an der Stelle von {{count}}, Woerter davor und danach, benannte Gruppe', () => {
  withLocale('de', () => {
    const html = intervalSentenceHtml({ key: 'common.everyNWeeks', count: 2, countHtml: '<input id="n">', labelledBy: 'lbl', className: 'x' });
    assert.match(html, /^<div class="interval-sentence x" role="group" aria-labelledby="lbl" data-interval-key="common\.everyNWeeks">/);
    assert.match(html, /<span class="interval-sentence__word" data-interval-part="before">Alle<\/span><input id="n"><span class="interval-sentence__word" data-interval-part="after">Wochen<\/span><\/div>$/,
      'das Feld steht genau dort, wo der Text {{count}} traegt');
  });
  // Ein Anhaengsel an der Zahl ("2. héten") bleibt an der Zahl, nicht am Wort.
  withLocale('hu', () => {
    assert.deepEqual(words(intervalSentenceHtml({ key: 'common.everyNWeeks', count: 2, countHtml: '<input>', labelledBy: 'l' })), ['Minden', '.', 'héten']);
  });
});

// R24 S4, Frage F1: bei 1 las der Satz "Alle 1 Wochen". Die Form waehlt die
// Zahl (Intl.PluralRules der UI-Sprache), in jeder Sprache mit ihren Kategorien.
test('Intervall-Satz F1: die Woerter folgen der Zahl - Singular bei 1, few/many, wo die Sprache sie hat', () => {
  const satz = (locale, key, count) => withLocale(locale, () => words(intervalSentenceHtml({ key, count, countHtml: '<input>', labelledBy: 'l' })).join(' '));
  assert.equal(satz('de', 'common.everyNWeeks', 1), 'Alle Woche');
  assert.equal(satz('de', 'common.everyNWeeks', 2), 'Alle Wochen');
  assert.equal(satz('de', 'common.everyNDays', 1), 'Alle Tag');
  assert.equal(satz('en', 'common.everyNMonths', 1), 'Every month');
  assert.equal(satz('pl', 'common.everyNMonths', 2), 'Co miesiące');
  assert.equal(satz('pl', 'common.everyNMonths', 5), 'Co miesięcy');
  assert.equal(satz('ru', 'common.everyNWeeks', 21), 'Раз в неделю');
  assert.equal(satz('de', 'common.everyNWeeks', ''), 'Alle Wochen', 'ein leeres Feld behaelt den Basissatz');
});

test('Intervall-Satz F1, Abos: die Einheit ist eine Wahl IM Satz, ihre Woerter folgen Zahl und Einheit', () => {
  withLocale('de', () => {
    const html = intervalSentenceHtml({ units: { id: 'u', options: ['daily', 'weekly', 'monthly', 'yearly'], selected: 'monthly' }, count: 1, countHtml: '<input>', labelledBy: 'l' });
    assert.match(html, /data-interval-units/);
    assert.match(html, /<select class="form-input" id="u" aria-labelledby="l"><option value="daily">Tag<\/option><option value="weekly">Woche<\/option><option value="monthly" selected>Monat<\/option><option value="yearly">Jahr<\/option><\/select><\/div>$/,
      'bei 1 im Singular - "Alle [1] [Monat]"');
    assert.deepEqual(words(html), ['Alle']);
    const zwei = intervalSentenceHtml({ units: { id: 'u', options: ['monthly'], selected: 'monthly' }, count: 2, countHtml: '<input>', labelledBy: 'l' });
    assert.match(zwei, /<option value="monthly" selected>Monate<\/option>/);
  });
  // Das Wort vor der Zahl kommt aus dem Satz der gewaehlten Einheit - so stimmt das Geschlecht.
  withLocale('fr', () => {
    const woche = intervalSentenceHtml({ units: { id: 'u', options: ['daily', 'weekly'], selected: 'weekly' }, count: 2, countHtml: '<input>', labelledBy: 'l' });
    assert.deepEqual(words(woche), ['Toutes les']);
  });
});

test('Intervall-Satz: jede Sprache hat die vier Saetze mit genau einem {{count}}', () => {
  const dir = new URL('../public/locales/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const { common } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const key of ['everyNDays', 'everyNWeeks', 'everyNMonths', 'everyNYears', 'everyNDays_one', 'everyNWeeks_one', 'everyNMonths_one', 'everyNYears_one']) {
      assert.equal((common[key]?.match(/\{\{count\}\}/g) ?? []).length, 1, `${file}: common.${key} = ${common[key]}`);
      assert.doesNotMatch(common[key], /\bN\b/, `${file}: common.${key} traegt noch das Buchstaben-N`);
    }
  }
});

test('Intervall-Satz: Entsorgung, Abos und Haushaltshilfe benutzen ihn (Critique R24)', () => {
  const waste = read('pages/waste.js');
  assert.match(waste, /intervalSentenceHtml\(\{\s*key: kind === 'weekly' \? 'common\.everyNWeeks' : 'common\.everyNMonths'/);
  assert.match(waste, /setIntervalSentenceKey\(panel\.querySelector\('\.wsm-interval-sentence'\)/, 'der Satz folgt der Wiederholung');
  assert.doesNotMatch(waste, /intervalLabelWeekly|intervalLabelMonthly/, 'kein Etikett "Alle N Wochen" mehr');
  const subs = read('pages/subscriptions.js');
  assert.match(subs, /intervalSentenceHtml\(\{\s*units: \{ id: 'subscription-cycle', options: state\.meta\.billing_cycles, selected: formCycle \}[\s\S]{0,200}count: subscription\?\.cycle_interval \|\| 1,/);
  assert.match(subs, /t\(sentence, \{ count: subscription\.cycle_interval \}\)/, 'die Abo-Zeile sagt denselben Satz wie der Dialog');
  assert.match(waste, /count: schedule\?\.interval \?\? 1,/, 'die Entsorgung nennt ihre Zahl - der Satz waehlt danach');
  assert.doesNotMatch(subs, /comboboxMarkup\(\{\s*id: 'subscription-cycle'/, 'der Zyklus ist kein Suchfeld mehr');
  const hk = read('pages/housekeeping.js');
  assert.equal((hk.match(/intervalSentenceHtml\(\{\s*key: 'common\.everyNDays'/g) ?? []).length, 2, 'Anlegen und Bearbeiten einer Arbeit');
  assert.equal((hk.match(/labelledBy: 'housekeeping-(?:create|edit)-frequency-label', count: /g) ?? []).length, 2, 'beide nennen ihre Zahl');
  // Neu gesetzt wird beim Tippen ueber EINEN Listener am Dokument - kein Aufrufer verdrahtet ihn.
  const util = read('utils/interval-sentence.js');
  assert.match(util, /document\.addEventListener\('input', onChange\);\s*document\.addEventListener\('change', onChange\);/);
});

test('Schichtart: Beginn und Ende in EINER Zeile, das Symbol ohne durchgestrichenes Bild', async () => {
  const { __test: schedule } = await import('../public/pages/schedule.js');
  const html = schedule.shiftFields({});
  assert.match(html, /<div class="form-pair schedule-time-pair"><div class="form-field[^"]*">[^]*?name="start_time"[^]*?<\/div><div class="form-field[^"]*">[^]*?name="end_time"[^]*?<\/div><\/div>$/, 'Beginn und Ende stehen als Paar');
  assert.doesNotMatch(html, /image-off/);
  assert.match(html, /data-action="pick-shift-icon"><i data-lucide="plus"/, 'ohne Symbol das Plus der Auswahl');
  assert.match(schedule.shiftFields({ icon: 'moon' }), /data-action="pick-shift-icon"><i data-lucide="moon"/);
  assert.doesNotMatch(read('pages/schedule.js'), /'image-off'/);
});

// R24, Critique G1-Geburtstage-P3-1 (Hinweis-Ort): „Jeder Geburtstag wird
// automatisch zum Kalender ... hinzugefuegt" stand unter dem Aufklapper ueber
// dem Fuss - nach dem Ausfuellen. Jetzt ist er der Hinweis des Datumsfelds.
test('Geburtstag: der Kalender-Hinweis steht am Datum, nicht ueber dem Fuss', () => {
  const bd = read('pages/birthdays.js');
  const field = bd.slice(bd.indexOf("id: 'bd-birth-date',"), bd.indexOf('})}', bd.indexOf("id: 'bd-birth-date',")));
  assert.match(field, /hint: t\('birthdays\.calendarHint'\)/, 'der Hinweis des Datumsfelds');
  assert.doesNotMatch(bd, /birthday-modal__hint/, 'kein zweiter Ort ueber dem Fuss');
});

test('Bild: das Vorschaubild ist der EINE Knopf, das Abzeichen sagt "aenderbar", Entfernen nur als Text mit Bild', async () => {
  const { mediaPickerBadgeHtml } = await import('../public/utils/media-picker.js');
  assert.equal(mediaPickerBadgeHtml(), '<span class="media-picker__badge" aria-hidden="true"><i data-lucide="pencil"></i></span>');
  const bd = read('pages/birthdays.js');
  const editor = bd.slice(bd.indexOf('<div class="birthday-modal__photo-wrap">'), bd.indexOf('<div class="birthday-modal__fields">'));
  assert.match(editor, /<span class="media-picker">\s*<button type="button" class="birthday-avatar-editor" id="birthday-preview"[\s\S]*?<\/button>\s*\$\{mediaPickerBadgeHtml\(\)\}\s*<\/span>/);
  assert.doesNotMatch(bd, /bd-photo-edit|birthday-modal__photo-action/, 'kein zweiter Knopf mit demselben Stift');
  assert.match(editor, /class="btn btn--ghost btn--sm media-picker__remove" id="bd-remove-photo"\$\{photoData \? '' : ' hidden'\}>\$\{t\('birthdays\.removePhoto'\)\}<\/button>/);
  const { eachRule } = await import('./css-rules.js');
  const layout = [...eachRule(readFileSync(new URL('../public/styles/layout.css', import.meta.url), 'utf8'))].filter((r) => !r.at.length);
  const badge = layout.find((r) => r.selector.trim() === '.media-picker__badge');
  assert.match(badge?.body ?? '', /pointer-events:\s*none/, 'das Abzeichen nimmt dem Knopf keinen Tipp');
  assert.match(badge?.body ?? '', /position:\s*absolute/);
});

test('Kontakte: "+ Telefonnummer hinzufuegen" ist eine leise Zeilenaktion an der Feldkante, "Jahr unbekannt" ein Schalter', async () => {
  const src = read('pages/contacts.js');
  assert.match(src, /class="btn btn--ghost btn--sm contact-mv-add" data-mv-add/);
  const { eachRule } = await import('./css-rules.js');
  const add = [...eachRule(readFileSync(new URL('../public/styles/contacts.css', import.meta.url), 'utf8'))].find((r) => r.selector.trim() === '.contact-mv-add');
  assert.match(add?.body ?? '', /align-self:\s*flex-start/);
  // Der Geburtstag des Kontakts nimmt den geteilten Baustein, dessen "Jahr
  // unbekannt" ein Schalter ist (role=switch) - kein Kaestchen.
  assert.match(src, /birthDateFieldHtml\(\{\s*id: 'cm-birthday'/);
  assert.match(read('utils/birth-date.js'), /<input type="checkbox" role="switch" id="\$\{esc\(id\)\}-year-unknown"/);
});

test('Dialogregel Erstfokus: dialogInitialFocus - Anlegen das erste Feld, Bearbeiten "edit" (Loader-Stub gleich)', async () => {
  const src = read('components/modal.js');
  const body = src.slice(src.indexOf('export function dialogInitialFocus('), src.indexOf('\n}\n', src.indexOf('export function dialogInitialFocus(')));
  assert.match(body, /return isEdit \? 'edit' : 'first-field';/);
  const { dialogInitialFocus } = await import('/components/modal.js');
  assert.equal(dialogInitialFocus(true), 'edit');
  assert.equal(dialogInitialFocus(false), 'first-field');
});
