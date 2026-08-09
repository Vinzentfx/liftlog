// Accent-, punctuation- and language-tolerant exercise search shared by both
// catalogue screens. The aliases are intentionally small and predictable.
const ALIASES = {
  klimmzug: 'pull up', klimmzuge: 'pull up', klimmzuege: 'pull up', pullup: 'pull up',
  liegestutz: 'push up', liegestutze: 'push up', liegestuetz: 'push up', liegestuetze: 'push up', pushup: 'push up',
  kreuzheben: 'deadlift', kniebeuge: 'squat', bankdrucken: 'bench press', bankdruecken: 'bench press',
  rudern: 'row', latziehen: 'lat pulldown', schulterdruecken: 'shoulder press',
  beinpresse: 'leg press', beinstrecker: 'leg extension', beinbeuger: 'leg curl',
  wadenheben: 'calf raise', seitheben: 'lateral raise', butterfly: 'fly',
  eigengewicht: 'bodyweight', korpergewicht: 'bodyweight', koerpergewicht: 'bodyweight', maschine: 'machine',
  kabel: 'cable', kurzhantel: 'dumbbell', langhantel: 'barbell',
};

export function searchText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

const expand = (query) => query.split(' ').map((word) => ALIASES[word] || word).join(' ');

export function exerciseSearchScore(exercise, query) {
  const raw = searchText(query);
  if (!raw) return 1;
  const q = expand(raw);
  const name = searchText(exercise.name);
  const haystack = `${name} ${searchText(exercise.muscle)} ${searchText(exercise.equipment)}`;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (haystack.includes(q)) return 60;
  const words = q.split(' ').filter(Boolean);
  if (words.every((word) => haystack.includes(word))) return 40;
  // A one-character typo should not hide an otherwise exact exercise name.
  if (q.length >= 5 && distanceAtMostOne(name, q)) return 20;
  return 0;
}

function distanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
