'use strict';
const $ = id => document.getElementById(id);

const WORLD_COUNTRIES = 195;
const VISITED_KEY = 'visitedCountries';
const TRIPS_KEY = 'travelLogTrips';
const COLORS_KEY = 'travelLogCountryColors';

const DEFAULT_COLOR = '#515258';
const VISITED_COLOR = '#ed79a2';

const COLORS = [
  '#F36B9A', '#F47779', '#F5A06C', '#F2CE65',
  '#8BCF82', '#62CFC8', '#76B6F2', '#B08AE8'
];

const SHORT_NAMES = {
  'Republic of Korea': 'South Korea',
  'Korea, Republic of': 'South Korea',
  'Russian Federation': 'Russia',
  'United States of America': 'United States',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Viet Nam': 'Vietnam',
  'Türkiye': 'Turkey',
  'Czechia': 'Czech Republic',
  'Brunei Darussalam': 'Brunei',
  'Moldova, Republic of': 'Moldova',
  "Lao People's Democratic Republic": 'Laos',
  'Iran (Islamic Republic of)': 'Iran',
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Venezuela (Bolivarian Republic of)': 'Venezuela',
  'United Republic of Tanzania': 'Tanzania'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

let visitedCountries = loadJSON(VISITED_KEY, []);
let trips = loadJSON(TRIPS_KEY, {});
let countryColors = loadJSON(COLORS_KEY, {});

if (!Array.isArray(visitedCountries)) visitedCountries = [];
if (!trips || typeof trips !== 'object' || Array.isArray(trips)) trips = {};
if (!countryColors || typeof countryColors !== 'object' || Array.isArray(countryColors)) countryColors = {};

visitedCountries = [...new Set(
  visitedCountries.filter(id => typeof id === 'string')
)];

function saveData() {
  const keys = [VISITED_KEY, TRIPS_KEY, COLORS_KEY];
  const old = keys.map(key => localStorage.getItem(key));

  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify(visitedCountries));
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
    localStorage.setItem(COLORS_KEY, JSON.stringify(countryColors));
    return true;
  } catch (error) {
    console.error(error);
    keys.forEach((key, index) => {
      try {
        if (old[index] === null) localStorage.removeItem(key);
        else localStorage.setItem(key, old[index]);
      } catch (e) {
        console.error(e);
      }
    });
    return false;
  }
}

const mapObject = $('world-map');
const promptModal = $('journal-prompt');
const colorModal = $('color-modal');
const travelModal = $('travel-modal');
const diaryViewer = $('diary-viewer');

let svgRoot = null;
let mapInitialized = false;
let countryGroups = new Map();
let countryNames = new Map();

let activeCountryId = null;
let activeCountryName = '';
let selectedCountryId = null;
let selectedCountryName = '';
let colorCountryId = null;
let colorCountryName = '';
let selectedColor = COLORS[0];

let editorCountryId = null;
let editorPhotos = [];
let editorLoading = false;
let travelSortMode = 'updated-new';

let originalView = { x: 0, y: 0, w: 2000, h: 857 };
let currentView = { ...originalView };
let dragState = null;
let suppressClick = false;

function makeElement(tag, className = '', content) {
  const element = document.createElement(tag);
  element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function getCountryName(id) {
  return countryNames.get(id) || id;
}

function getTripRecords(id) {
  return Array.isArray(trips[id]) ? trips[id] : [];
}

function isVisited(id) {
  return visitedCountries.includes(id) || getTripRecords(id).length > 0;
}

function getVisitedIds() {
  const ids = new Set(visitedCountries);
  Object.entries(trips).forEach(([id, records]) => {
    if (Array.isArray(records) && records.length) ids.add(id);
  });
  return ids;
}

function updateBodyLock() {
  document.body.classList.toggle('modal-open',
    [promptModal, colorModal, travelModal, diaryViewer]
      .some(modal => !modal.hidden)
  );
}

function showModal(modal) {
  modal.hidden = false;
  updateBodyLock();
}

function hideModal(modal) {
  modal.hidden = true;
  updateBodyLock();
}

function parseDateUTC(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);

  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return NaN;

  return date.getTime();
}

function calculateDays(start, end) {
  const a = parseDateUTC(start);
  const b = parseDateUTC(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

function totalTravelDays() {
  const unique = new Set();

  Object.values(trips).forEach(records => {
    if (!Array.isArray(records)) return;
    records.forEach(trip => {
      const start = parseDateUTC(trip.start);
      const days = calculateDays(trip.start, trip.end);
      if (!Number.isFinite(start) ||
          !Number.isFinite(days) ||
          days < 1 || days > 3650) return;

      for (let i = 0; i < days; i++) {
        unique.add(start + i * 86400000);
      }
    });
  });

  return unique.size;
}

function updateStats() {
  const count = getVisitedIds().size;
  $('country-count').textContent = count;
  $('world-percent').textContent =
    ((count / WORLD_COUNTRIES) * 100).toFixed(2) + '%';
  $('travel-days').textContent = totalTravelDays();
}

function refreshMapColors() {
  countryGroups.forEach((shapes, id) => {
    const visited = isVisited(id);
    const color = visited
      ? (countryColors[id] || VISITED_COLOR)
      : DEFAULT_COLOR;

    shapes.forEach(shape => {
      shape.style.fill = color;
      shape.classList.toggle('visited', visited);
    });
  });
}

function refreshAll() {
  refreshMapColors();
  updateStats();
  renderHomeTrips();
  renderSearchResults();
}

function openCountryMenu(id, name) {
  activeCountryId = id;
  activeCountryName = name || getCountryName(id);

  const visited = isVisited(id);

  $('prompt-country').textContent = activeCountryName;
  $('prompt-title').textContent = visited
    ? `Your memories in ${activeCountryName}`
    : `Add ${activeCountryName} to your travel map?`;

  $('prompt-yes').textContent = visited
    ? 'View Memories' : 'Add to My Map';

  $('prompt-create').hidden = !visited;
  $('prompt-delete').hidden = !visited;
  $('prompt-recolor').hidden = !visited;

  showModal(promptModal);
}

function closeCountryMenu() {
  hideModal(promptModal);
  activeCountryId = null;
  activeCountryName = '';
}

$('prompt-no').addEventListener('click', closeCountryMenu);
promptModal.addEventListener('click', event => {
  if (event.target === promptModal) closeCountryMenu();
});

$('prompt-yes').addEventListener('click', () => {
  const id = activeCountryId;
  const name = activeCountryName;
  if (!id) return;

  const visited = isVisited(id);
  closeCountryMenu();

  if (visited) openTravelModal(id, name);
  else openColorModal(id, name);
});

$('prompt-create').addEventListener('click', () => {
  const id = activeCountryId;
  const name = activeCountryName;
  if (!id || !isVisited(id)) return;

  closeCountryMenu();
  openDiaryEditor(id, name);
});

$('prompt-recolor').addEventListener('click', () => {
  const id = activeCountryId;
  const name = activeCountryName;
  closeCountryMenu();
  if (id) openColorModal(id, name);
});

function openColorModal(id, name) {
  colorCountryId = id;
  colorCountryName = name;
  selectedColor = countryColors[id] || COLORS[0];

  $('color-country').textContent = name;
  $('color-save').textContent = isVisited(id)
    ? 'Update Color' : 'Save Color';

  document.querySelectorAll('.country-color-option')
    .forEach(button => {
      button.classList.toggle('selected',
        button.dataset.color === selectedColor);
    });

  showModal(colorModal);
}

function closeColorModal() {
  hideModal(colorModal);
  colorCountryId = null;
  colorCountryName = '';
}

document.querySelectorAll('.country-color-option')
  .forEach(button => {
    button.addEventListener('click', () => {
      selectedColor = button.dataset.color;
      document.querySelectorAll('.country-color-option')
        .forEach(option => {
          option.classList.toggle('selected',
            option === button);
        });
    });
  });

$('color-save').addEventListener('click', () => {
  const id = colorCountryId;
  const name = colorCountryName;
  if (!id) return;

  const oldVisited = [...visitedCountries];
  const oldColors = { ...countryColors };

  countryColors[id] = selectedColor;
  if (!visitedCountries.includes(id)) visitedCountries.push(id);

  if (!saveData()) {
    visitedCountries = oldVisited;
    countryColors = oldColors;
    alert('色を保存できませんでした。');
    return;
  }

  closeColorModal();
  refreshAll();
  openCountryMenu(id, name);
});

$('color-cancel').addEventListener('click', closeColorModal);
colorModal.addEventListener('click', event => {
  if (event.target === colorModal) closeColorModal();
});

function removeCountry(id, name) {
  if (!confirm(`${name}の訪問登録と旅行記録をすべて削除しますか？`)) {
    return false;
  }

  const oldVisited = [...visitedCountries];
  const oldColors = { ...countryColors };
  const oldTrips = trips[id];

  visitedCountries = visitedCountries.filter(x => x !== id);
  delete countryColors[id];
  delete trips[id];

  if (!saveData()) {
    visitedCountries = oldVisited;
    countryColors = oldColors;
    if (oldTrips !== undefined) trips[id] = oldTrips;
    alert('削除できませんでした。');
    return false;
  }

  refreshAll();
  return true;
}

$('prompt-delete').addEventListener('click', () => {
  if (activeCountryId &&
      removeCountry(activeCountryId, activeCountryName)) {
    closeCountryMenu();
  }
});

$('modal-delete-country').addEventListener('click', () => {
  if (selectedCountryId &&
      removeCountry(selectedCountryId, selectedCountryName)) {
    closeTravelModal();
  }
});

/* SAVED MEMORIES MODAL */

function openTravelModal(id, name) {
  selectedCountryId = id;
  selectedCountryName = name || getCountryName(id);
  $('modal-title').textContent = selectedCountryName;
  renderTrips();
  showModal(travelModal);
}

function closeTravelModal() {
  hideModal(travelModal);
  selectedCountryId = null;
  selectedCountryName = '';
}

$('close-modal').addEventListener('click', closeTravelModal);
travelModal.addEventListener('click', event => {
  if (event.target === travelModal) closeTravelModal();
});

function tripPhotos(trip) {
  if (Array.isArray(trip.photos) && trip.photos.length) {
    return trip.photos.filter(Boolean);
  }
  return trip.photo ? [trip.photo] : [];
}

function renderTrips() {
  const list = $('trip-list');
  list.replaceChildren();

  const id = selectedCountryId;
  const records = getTripRecords(id);

  if (!records.length) {
    list.appendChild(makeElement(
      'p', 'home-trip-empty',
      'まだ日記がありません。Create New Memoriesから追加できます。'
    ));
    return;
  }

  records.forEach((trip, index) => {
    const card = makeElement('article', 'trip-card');
    const days = calculateDays(trip.start, trip.end);

    card.appendChild(makeElement(
      'strong', '',
      `${trip.start || ''} ～ ${trip.end || ''}` +
      (Number.isFinite(days) ? ` (${days} days)` : '')
    ));

    if (trip.city) {
      card.appendChild(makeElement('p', '', '📍 ' + trip.city));
    }

    if (trip.diary) {
      const preview = trip.diary.length > 160
        ? trip.diary.slice(0, 160) + '…'
        : trip.diary;
      card.appendChild(makeElement('p', '', preview));
    }

    const firstPhoto = tripPhotos(trip)[0];
    if (firstPhoto) {
      const image = document.createElement('img');
      image.src = firstPhoto;
      image.alt = 'Travel memory';
      image.loading = 'lazy';
      card.appendChild(image);
    }

    const actions = makeElement('div', 'trip-card-actions');

    const view = makeElement(
      'button', 'trip-view-button', 'View Diary'
    );
    view.type = 'button';
    view.addEventListener('click', () => {
      closeTravelModal();
      openDiaryViewer(id, trip);
    });

    const remove = makeElement(
      'button', 'delete-trip', 'Delete'
    );
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!confirm('この旅行日記を削除しますか？')) return;

      const old = [...getTripRecords(id)];
      trips[id].splice(index, 1);
      if (!trips[id].length) delete trips[id];

      if (!saveData()) {
        trips[id] = old;
        alert('削除できませんでした。');
        return;
      }

      renderTrips();
      refreshAll();
    });

    actions.append(view, remove);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () =>
      reject(new Error('写真を読み込めませんでした。'));

    reader.onload = () => {
      const image = new Image();

      image.onerror = () =>
        reject(new Error('画像を開けませんでした。'));

      image.onload = () => {
        const ratio = Math.min(
          1, 900 / Math.max(image.width, image.height)
        );

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('画像処理に失敗しました。'));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function setDiaryEditMode(editing) {
  [
    'editor-dates', 'editor-city-wrap',
    'editor-text-wrap', 'editor-photo-control',
    'editor-photo-count', 'editor-message',
    'editor-save'
  ].forEach(id => {
    $(id).hidden = !editing;
  });

  ['viewer-date', 'viewer-city', 'viewer-text']
    .forEach(id => {
      $(id).hidden = editing;
    });
}

function applyDiaryColor(id) {
  $('diary-book').style.setProperty(
    '--diary-accent',
    countryColors[id] || VISITED_COLOR
  );
}

function renderDiaryPhotos(photos, editing = false) {
  const gallery = $('diary-photo-gallery');
  gallery.replaceChildren();

  const list = photos.length ? photos : [''];

  list.forEach((src, index) => {
    const frame = makeElement(
      'div', 'diary-gallery-polaroid'
    );

    if (src) {
      const image = document.createElement('img');
      image.src = src;
      image.alt = `Travel memory ${index + 1}`;
      frame.appendChild(image);

      if (editing) {
        const remove = makeElement(
          'button', 'diary-photo-remove', '×'
        );
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove photo');

        remove.addEventListener('click', () => {
          if (editorLoading) return;
          editorPhotos.splice(index, 1);
          renderDiaryPhotos(editorPhotos, true);
        });

        frame.appendChild(remove);
      }
    } else {
      const placeholder = makeElement(
        'div', 'diary-photo-placeholder'
      );
      placeholder.appendChild(makeElement('span', '', '✈'));
      placeholder.appendChild(makeElement(
        'p', '', 'Memories made here ♡'
      ));
      frame.appendChild(placeholder);
    }

    gallery.appendChild(frame);
  });

  $('editor-photo-count').textContent =
    `${photos.length} / 12 photos`;
}

function openDiaryEditor(id, name) {
  editorCountryId = id;
  editorPhotos = [];
  editorLoading = false;

  $('viewer-country').textContent =
    name || getCountryName(id);

  applyDiaryColor(id);

  $('editor-start').value = '';
  $('editor-end').value = '';
  $('editor-city').value = '';
  $('editor-text').value = '';
  $('editor-photos').value = '';
  $('editor-message').textContent = '';
  $('editor-save').disabled = false;

  setDiaryEditMode(true);
  renderDiaryPhotos([], true);
  showModal(diaryViewer);
}

function openDiaryViewer(id, trip) {
  if (!trip) return;

  editorCountryId = null;
  editorPhotos = [];
  editorLoading = false;

  $('viewer-country').textContent = getCountryName(id);
  $('viewer-date').textContent =
    `${trip.start || ''} ～ ${trip.end || ''}`;
  $('viewer-city').textContent =
    trip.city ? '📍 ' + trip.city : '';
  $('viewer-text').textContent =
    trip.diary || 'Memories made along the way.';

  applyDiaryColor(id);
  setDiaryEditMode(false);
  renderDiaryPhotos(tripPhotos(trip));
  showModal(diaryViewer);
}

$('editor-photos').addEventListener('change', async event => {
  if (!editorCountryId || editorLoading) return;

  const files = Array.from(event.target.files);
  const message = $('editor-message');

  editorLoading = true;
  $('editor-save').disabled = true;
  message.textContent = 'Loading photos...';

  try {
    for (const file of files) {
      if (editorPhotos.length >= 12) {
        message.textContent = '写真は最大12枚まで追加できます。';
        break;
      }

      if (!file.type.startsWith('image/')) continue;

      const photo = await compressPhoto(file);
      editorPhotos.push(photo);
    }

    renderDiaryPhotos(editorPhotos, true);

    if (editorPhotos.length < 12) {
      message.textContent = '';
    }
  } catch (error) {
    console.error(error);
    message.textContent = '写真を読み込めませんでした。';
  } finally {
    editorLoading = false;
    $('editor-save').disabled = false;
    event.target.value = '';
  }
});

$('editor-save').addEventListener('click', () => {
  if (!editorCountryId || editorLoading) return;

  const id = editorCountryId;
  const start = $('editor-start').value;
  const end = $('editor-end').value;
  const city = $('editor-city').value.trim();
  const diary = $('editor-text').value.trim();
  const message = $('editor-message');

  const days = calculateDays(start, end);

  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    message.textContent =
      '旅行開始日と終了日を正しく入力してください。';
    return;
  }

  if (!diary) {
    message.textContent = '日記の本文を入力してください。';
    $('editor-text').focus();
    return;
  }

  const now = new Date().toISOString();

  const newTrip = {
    start,
    end,
    city,
    diary,
    photo: editorPhotos[0] || '',
    photos: [...editorPhotos],
    createdAt: now,
    updatedAt: now
  };

  const oldRecords = [...getTripRecords(id)];
  const oldVisited = [...visitedCountries];

  trips[id] = [...oldRecords, newTrip];

  if (!visitedCountries.includes(id)) {
    visitedCountries.push(id);
  }

  if (!saveData()) {
    trips[id] = oldRecords;
    visitedCountries = oldVisited;
    message.textContent =
      '保存できませんでした。写真の容量や枚数を減らしてください。';
    return;
  }

  refreshAll();
  openDiaryViewer(id, newTrip);
});

function closeDiaryViewer() {
  if (editorLoading) {
    alert('写真の読み込みが終わるまでお待ちください。');
    return;
  }

  if (editorCountryId &&
      !confirm('保存せずに日記を閉じますか？')) {
    return;
  }

  editorCountryId = null;
  hideModal(diaryViewer);
}

$('close-diary-viewer').addEventListener(
  'click', closeDiaryViewer
);

diaryViewer.addEventListener('click', event => {
  if (event.target === diaryViewer) closeDiaryViewer();
});

function getUpdatedDate(trip) {
  return trip.updatedAt || trip.createdAt || trip.start || '';
}

function getSortedTrips() {
  const entries = [];

  Object.entries(trips).forEach(([id, records]) => {
    if (!Array.isArray(records)) return;
    records.forEach((trip, index) => {
      if (trip && typeof trip === 'object') {
        entries.push({ id, trip, index });
      }
    });
  });

  entries.sort((a, b) => {
    switch (travelSortMode) {
      case 'updated-old':
        return getUpdatedDate(a.trip)
          .localeCompare(getUpdatedDate(b.trip));
      case 'trip-new':
        return (b.trip.start || '')
          .localeCompare(a.trip.start || '');
      case 'trip-old':
        return (a.trip.start || '')
          .localeCompare(b.trip.start || '');
      case 'az':
        return getCountryName(a.id)
          .localeCompare(getCountryName(b.id), 'en');
      case 'za':
        return getCountryName(b.id)
          .localeCompare(getCountryName(a.id), 'en');
      default:
        return getUpdatedDate(b.trip)
          .localeCompare(getUpdatedDate(a.trip));
    }
  });

  return entries;
}

$('travel-sort-select').addEventListener('change', event => {
  travelSortMode = event.target.value;
  renderHomeTrips();
});

function renderHomeTrips() {
  const homeList = $('home-trip-list');
  homeList.replaceChildren();

  const entries = getSortedTrips();

  if (!entries.length) {
    homeList.appendChild(makeElement(
      'p', 'home-trip-empty',
      'まだ旅行日記がありません。地図から国を選んで、最初の思い出を追加しよう！'
    ));
    return;
  }

  entries.forEach(({ id, trip }) => {
    const card = makeElement('article', 'home-trip-card');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label',
      getCountryName(id) + 'の日記を読む');

    const firstPhoto = tripPhotos(trip)[0];

    if (firstPhoto) {
      const image = document.createElement('img');
      image.className = 'home-trip-image';
      image.src = firstPhoto;
      image.alt = getCountryName(id) + 'の旅行写真';
      image.loading = 'lazy';
      card.appendChild(image);
    } else {
      card.appendChild(makeElement(
        'div', 'home-trip-placeholder', '✈️'
      ));
    }

    const body = makeElement('div', 'home-trip-body');

    body.appendChild(makeElement(
      'h3', 'home-trip-country', getCountryName(id)
    ));

    body.appendChild(makeElement(
      'p', 'home-trip-date',
      `${trip.start || ''} ～ ${trip.end || ''}`
    ));

    if (trip.city) {
      body.appendChild(makeElement(
        'p', 'home-trip-city', '📍 ' + trip.city
      ));
    }

    if (trip.diary) {
      body.appendChild(makeElement(
        'p', 'home-trip-diary', trip.diary
      ));
    }

    body.appendChild(makeElement(
      'span', 'home-trip-more', 'View Memories →'
    ));

    card.appendChild(body);

    const open = () => openDiaryViewer(id, trip);
    card.addEventListener('click', open);

    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    homeList.appendChild(card);
  });
}

function applyView() {
  if (!svgRoot) return;
  svgRoot.setAttribute('viewBox',
    `${currentView.x} ${currentView.y} ${currentView.w} ${currentView.h}`);
}

function limitView() {
  currentView.x = Math.max(originalView.x,
    Math.min(currentView.x,
      originalView.x + originalView.w - currentView.w));

  currentView.y = Math.max(originalView.y,
    Math.min(currentView.y,
      originalView.y + originalView.h - currentView.h));
}

function zoomMap(factor) {
  if (!svgRoot) return;

  const width = Math.max(originalView.w / 8,
    Math.min(originalView.w, currentView.w * factor));

  const height = width * originalView.h / originalView.w;
  const centerX = currentView.x + currentView.w / 2;
  const centerY = currentView.y + currentView.h / 2;

  currentView = {
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height
  };

  limitView();
  applyView();
}

$('zoom-in').addEventListener('click', () => zoomMap(.75));
$('zoom-out').addEventListener('click', () => zoomMap(1.25));
$('zoom-reset').addEventListener('click', () => {
  currentView = { ...originalView };
  applyView();
});

function zoomToCountry(id) {
  if (!svgRoot) return;

  const shapes = countryGroups.get(id);
  if (!shapes || !shapes.length) return;

  let target = null;
  let largestArea = -1;

  shapes.forEach(shape => {
    try {
      const box = shape.getBBox();
      const area = box.width * box.height;
      if (area > largestArea) {
        largestArea = area;
        target = box;
      }
    } catch (error) {
      console.warn(error);
    }
  });

  if (!target) return;

  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;

  const desiredWidth = Math.max(
    target.width * 2.2,
    target.height * 2.2 *
      (originalView.w / originalView.h)
  );

  const width = Math.max(originalView.w / 8,
    Math.min(originalView.w, desiredWidth));

  const height = width * originalView.h / originalView.w;

  currentView = {
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height
  };

  limitView();
  applyView();
}

function initializeMap() {
  if (mapInitialized || !mapObject) return;

  const svgDocument = mapObject.contentDocument;
  if (!svgDocument) {
    console.error('地図を読み込めません。Live Serverで開いてください。');
    return;
  }

  svgRoot = svgDocument.documentElement;

  if (!svgRoot || svgRoot.tagName.toLowerCase() !== 'svg') {
    return;
  }

  const viewBox = svgRoot.viewBox.baseVal;

  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    originalView = {
      x: viewBox.x,
      y: viewBox.y,
      w: viewBox.width,
      h: viewBox.height
    };
  }

  currentView = { ...originalView };
  applyView();

  countryGroups = new Map();
  countryNames = new Map();

  const shapes = [...svgDocument.querySelectorAll('path')];
  const nameToId = new Map();

  shapes.forEach(shape => {
    const id = shape.getAttribute('id');
    const name = shape.getAttribute('name');
    if (id && name) {
      nameToId.set(name.trim().toLowerCase(), id);
    }
  });

  shapes.forEach(shape => {
    const id = shape.getAttribute('id');
    const name = shape.getAttribute('name');

    const title =
      shape.querySelector('title')?.textContent?.trim() ||
      shape.getAttribute('aria-label') ||
      shape.getAttribute('data-name') || '';

    const className = shape.getAttribute('class') || '';

    const countryName =
      name || title ||
      (className.toLowerCase() !== 'country' ? className : '') ||
      id;

    if (!countryName) return;

    const countryId =
      (id && name ? id : null) ||
      nameToId.get(countryName.trim().toLowerCase()) ||
      id || countryName;

    const displayName = SHORT_NAMES[countryName] || countryName;

    if (!countryNames.has(countryId) || (id && name)) {
      countryNames.set(countryId, displayName);
    }

    if (!countryGroups.has(countryId)) {
      countryGroups.set(countryId, []);
    }

    countryGroups.get(countryId).push(shape);
    shape.style.cursor = 'pointer';

    shape.addEventListener('click', event => {
      if (suppressClick) {
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      openCountryMenu(countryId, getCountryName(countryId));
    });
  });

  mapInitialized = true;
  refreshAll();

  svgRoot.style.cursor = 'grab';
  svgRoot.style.touchAction = 'none';

  svgRoot.addEventListener('wheel', event => {
    event.preventDefault();
    zoomMap(event.deltaY < 0 ? .85 : 1.15);
  }, { passive: false });

  svgRoot.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    dragState = {
      x: event.clientX,
      y: event.clientY,
      viewX: currentView.x,
      viewY: currentView.y,
      moved: false
    };
  });

  svgRoot.addEventListener('pointermove', event => {
    if (!dragState) return;

    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;

    if (Math.hypot(dx, dy) > 4) dragState.moved = true;
    if (!dragState.moved) return;

    const bounds = svgRoot.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / currentView.w,
      bounds.height / currentView.h
    );

    if (!scale) return;

    currentView.x = dragState.viewX - dx / scale;
    currentView.y = dragState.viewY - dy / scale;

    limitView();
    applyView();
    svgRoot.style.cursor = 'grabbing';
  });

  function stopDragging() {
    if (!dragState) return;

    if (dragState.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }

    dragState = null;
    svgRoot.style.cursor = 'grab';
  }

  svgRoot.addEventListener('pointerup', stopDragging);
  svgRoot.addEventListener('pointercancel', stopDragging);
}

const searchInput = $('country-search-input');
const searchResults = $('country-search-results');

function getSearchableCountries() {
  return [...countryNames.entries()]
    .filter(([id, name]) =>
      id && name && name.trim().toLowerCase() !== 'country'
    )
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function renderSearchResults() {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.replaceChildren();

  if (!query) {
    searchResults.hidden = true;
    return;
  }

  const matches = getSearchableCountries()
    .filter(country =>
      country.name.toLowerCase().includes(query)
    ).slice(0, 12);

  if (!matches.length) {
    searchResults.appendChild(makeElement(
      'p', 'country-search-empty', 'No countries found'
    ));
  }

  matches.forEach(country => {
    const button = makeElement(
      'button', 'country-search-result'
    );
    button.type = 'button';

    button.appendChild(makeElement(
      'span', '', country.name
    ));

    if (isVisited(country.id)) {
      button.appendChild(makeElement(
        'span', 'country-search-status', 'Visited'
      ));
    }

    button.addEventListener('click', () => {
      searchInput.value = country.name;
      searchResults.hidden = true;
      zoomToCountry(country.id);
      openCountryMenu(country.id, country.name);
    });

    searchResults.appendChild(button);
  });

  searchResults.hidden = false;
}

searchInput.addEventListener('input', renderSearchResults);

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) renderSearchResults();
});

searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    searchResults.hidden = true;
    searchInput.blur();
  }

  if (event.key === 'Enter') {
    const first = searchResults.querySelector(
      '.country-search-result'
    );

    if (first && !searchResults.hidden) {
      event.preventDefault();
      first.click();
    }
  }
});

document.addEventListener('click', event => {
  if (!event.target.closest('.country-search')) {
    searchResults.hidden = true;
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;

  if (!diaryViewer.hidden) closeDiaryViewer();
  else if (!travelModal.hidden) closeTravelModal();
  else if (!colorModal.hidden) closeColorModal();
  else if (!promptModal.hidden) closeCountryMenu();
});

/* INITIALIZATION */

if (mapObject) {
  mapObject.addEventListener('load', initializeMap);

  if (mapObject.contentDocument &&
      mapObject.contentDocument.readyState === 'complete') {
    initializeMap();
  }
}

updateStats();
renderHomeTrips();

console.log('TRAVEL LOG is ready!');