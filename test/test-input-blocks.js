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

test('Intervall-Satz: das Feld steht an der Stelle von {{count}}, Woerter davor und danach, benannte Gruppe', () => {
  // Der Loader-Stub von t() gibt "key" + JSON der Parameter zurueck - der
  // Platzhalter steht darin, wo die Sprache ihn hinstellt.
  const html = intervalSentenceHtml({ key: 'common.everyNWeeks', countHtml: '<input id="n">', labelledBy: 'lbl', className: 'x' });
  assert.match(html, /^<div class="interval-sentence x" role="group" aria-labelledby="lbl" data-interval-key="common\.everyNWeeks">/);
  assert.match(html, /<span class="interval-sentence__word">common\.everyNWeeks\{&quot;count&quot;:&quot;<\/span><input id="n"><span class="interval-sentence__word">&quot;\}<\/span><\/div>$/,
    'das Feld steht genau dort, wo der Text {{count}} traegt');
  const withUnit = intervalSentenceHtml({ prefix: 'Alle', countHtml: '<input id="n">', unitHtml: '<select id="u"></select>', labelledBy: 'l' });
  assert.match(withUnit, /<span class="interval-sentence__word">Alle<\/span><input id="n"><select id="u"><\/select><\/div>$/, 'Wahl der Einheit am Satzende');
});

test('Intervall-Satz: jede Sprache hat die drei Saetze mit genau einem {{count}}', () => {
  const dir = new URL('../public/locales/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const { common } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const key of ['everyNDays', 'everyNWeeks', 'everyNMonths']) {
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
  assert.match(subs, /intervalSentenceHtml\(\{\s*prefix: t\('subscriptions\.intervalLabel'\)[\s\S]{0,400}unitHtml: `<select class="form-input" id="subscription-cycle"/);
  assert.doesNotMatch(subs, /comboboxMarkup\(\{\s*id: 'subscription-cycle'/, 'der Zyklus ist kein Suchfeld mehr');
  const hk = read('pages/housekeeping.js');
  assert.equal((hk.match(/intervalSentenceHtml\(\{\s*key: 'common\.everyNDays'/g) ?? []).length, 2, 'Anlegen und Bearbeiten einer Arbeit');
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
