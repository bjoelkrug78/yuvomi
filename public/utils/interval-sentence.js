/**
 * EIN INTERVALL IST EIN SATZ (Critique R24 G1-Schichtplan-P2-3 / Bausteine (4)).
 *
 * Drei Module fragten denselben Abstand auf drei Arten ab: die Entsorgung mit
 * dem Etikett "Alle N Wochen" ueber einem Stepper (das N stand als Buchstabe
 * im Etikett), die Abos mit "Abrechnungszyklus" als Suchfeld und darunter
 * einem Etikett "Alle" ueber einer nackten 1, die Haushaltshilfe mit
 * "Rhythmus" ueber einem Zahlfeld, dessen Einheit nirgends stand. Jetzt steht
 * das Feld IM Satz: "Alle [2] Wochen", "Alle [1] [Monate]", "Alle [7] Tage".
 *
 * Die Wortstellung kommt aus der Sprache, nicht aus dem Code: der Satz ist ein
 * Locale-Text mit `{{count}}` (ja "{{count}}週間ごと", hu "Minden {{count}}.
 * héten"), an dessen Stelle das Feld tritt.
 */
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

const SLOT = '\u2063';

/**
 * @param {object} opts
 * @param {string} opts.key         Locale-Schluessel des Satzes mit `{{count}}`
 *                                  (`common.everyNDays|Weeks|Months`) ODER
 * @param {string} [opts.prefix]    ein freies Wort davor (Abos: die Einheit ist eine Wahl,
 *                                  der Satz endet mit ihr) - dann ohne `key`
 * @param {string} opts.countHtml   das Zahlfeld (oder der Stepper), fertiges Markup
 * @param {string} [opts.unitHtml]  eine Einheiten-Wahl am Satzende (Abos)
 * @param {string} opts.labelledBy  id der sichtbaren Beschriftung der Gruppe
 * @param {string} [opts.className]
 * @returns {string}
 */
export function intervalSentenceHtml({ key = '', prefix = '', countHtml, unitHtml = '', labelledBy, className = '' }) {
  const sentence = key ? t(key, { count: SLOT }) : `${prefix} ${SLOT}`;
  const [before = '', after = ''] = sentence.split(SLOT);
  const word = (text) => (text.trim() ? `<span class="interval-sentence__word">${esc(text.trim())}</span>` : '');
  return `<div class="interval-sentence${className ? ` ${esc(className)}` : ''}" role="group" aria-labelledby="${esc(labelledBy)}"${key ? ` data-interval-key="${esc(key)}"` : ''}>`
    + word(before) + countHtml + word(after) + unitHtml
    + '</div>';
}

/**
 * Tauscht den Satz um ein bestehendes Feld (die Entsorgung wechselt zwischen
 * Wochen und Monaten, waehrend das Feld seinen Wert behaelt).
 *
 * @param {Element} group  das `.interval-sentence`
 * @param {string} key
 */
export function setIntervalSentenceKey(group, key) {
  if (!group) return;
  group.dataset.intervalKey = key;
  const field = [...(group.children ?? [])].find((el) => !el.classList.contains('interval-sentence__word'));
  if (!field) return;
  group.querySelectorAll(':scope > .interval-sentence__word').forEach((el) => el.remove());
  const [before = '', after = ''] = t(key, { count: SLOT }).split(SLOT);
  const word = (text) => {
    const span = document.createElement('span');
    span.className = 'interval-sentence__word';
    span.textContent = text.trim();
    return span;
  };
  if (before.trim()) field.before(word(before));
  if (after.trim()) field.after(word(after));
}
