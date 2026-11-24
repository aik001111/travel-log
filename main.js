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
  'United Republic of Tanzania': 'Tanzania',
  'Lao PDR': 'Laos',
  'Dem. Rep. Korea': 'North Korea',
  'Macedonia': 'North Macedonia',
  'Swaziland': 'Eswatini'
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

if (!Array.isArray(visitedCountries)) {
  visitedCountries = [];
}

if (!trips || typeof trips !== 'object' || Array.isArray(trips)) {
  trips = {};
}

if (!countryColors || typeof countryColors !== 'object' || Array.isArray(countryColors)) {
  countryColors = {};
}

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
        if (old[index] === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, old[index]);
        }
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

let originalView = {
  x: 0,
  y: 0,
  w: 2000,
  h: 857
};

let currentView = { ...originalView };
let dragState = null;
let suppressClick = false;

function makeElement(tag, className = '', content) {
  const element = document.createElement(tag);
  element.className = className;

  if (content !== undefined) {
    element.textContent = content;
  }

  return element;
}

function getCountryName(id) {
  return countryNames.get(id) || id;
}

function getTripRecords(id) {
  return Array.isArray(trips[id]) ? trips[id] : [];
}

function isVisited(id) {
  return visitedCountries.includes(id) ||
    getTripRecords(id).length > 0;
}

function getVisitedIds() {
  const ids = new Set(visitedCountries);

  Object.entries(trips).forEach(([id, records]) => {
    if (Array.isArray(records) && records.length) {
      ids.add(id);
    }
  });

  return ids;
}

function updateBodyLock() {
  document.body.classList.toggle(
    'modal-open',
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

/* DATE CALCULATION */

function parseDateUTC(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return NaN;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);

  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }

  return date.getTime();
}

function calculateDays(start, end) {
  const a = parseDateUTC(start);
  const b = parseDateUTC(end);

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return NaN;
  }

  return Math.round((b - a) / 86400000) + 1;
}

function totalTravelDays() {
  const unique = new Set();

  Object.values(trips).forEach(records => {
    if (!Array.isArray(records)) return;

    records.forEach(trip => {
      const start = parseDateUTC(trip.start);
      const days = calculateDays(trip.start, trip.end);

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(days) ||
        days < 1 ||
        days > 3650
      ) {
        return;
      }

      for (let i = 0; i < days; i++) {
        unique.add(start + i * 86400000);
      }
    });
  });

  return unique.size;
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
    ? 'View Memories'
    : 'Add to My Map';

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
  if (event.target === promptModal) {
    closeCountryMenu();
  }
});

$('prompt-yes').addEventListener('click', () => {
  const id = activeCountryId;
  const name = activeCountryName;

  if (!id) return;

  const visited = isVisited(id);
  closeCountryMenu();

  if (visited) {
    openTravelModal(id, name);
  } else {
    openColorModal(id, name);
  }
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

  if (id) {
    openColorModal(id, name);
  }
});

function openColorModal(id, name) {
  colorCountryId = id;
  colorCountryName = name;

  selectedColor = countryColors[id] || COLORS[0];

  $('color-country').textContent = name;

  $('color-save').textContent = isVisited(id)
    ? 'Update Color'
    : 'Save Color';

  document.querySelectorAll('.country-color-option')
    .forEach(button => {
      button.classList.toggle(
        'selected',
        button.dataset.color === selectedColor
      );
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
          option.classList.toggle('selected', option === button);
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

  if (!visitedCountries.includes(id)) {
    visitedCountries.push(id);
  }

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
  if (event.target === colorModal) {
    closeColorModal();
  }
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

    if (oldTrips !== undefined) {
      trips[id] = oldTrips;
    }

    alert('削除できませんでした。');
    return false;
  }

  refreshAll();
  return true;
}

$('prompt-delete').addEventListener('click', () => {
  if (
    activeCountryId &&
    removeCountry(activeCountryId, activeCountryName)
  ) {
    closeCountryMenu();
  }
});

$('modal-delete-country').addEventListener('click', () => {
  if (
    selectedCountryId &&
    removeCountry(selectedCountryId, selectedCountryName)
  ) {
    closeTravelModal();
  }
});

let editorTripIndex = null;

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
  if (event.target === travelModal) {
    closeTravelModal();
  }
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

  const create = makeElement(
    'button', 'save-button', '＋ Create New Memories'
  );

  create.type = 'button';

  create.addEventListener('click', () => {
    closeTravelModal();
    openDiaryEditor(id, getCountryName(id));
  });

  list.appendChild(create);

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
      card.appendChild(makeElement(
        'p', '', '📍 ' + trip.city
      ));
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

    const edit = makeElement(
      'button', 'trip-view-button', 'Edit Diary'
    );

    edit.type = 'button';

    edit.addEventListener('click', () => {
      closeTravelModal();
      openDiaryEditor(id, getCountryName(id), index);
    });

    const remove = makeElement(
      'button', 'delete-trip', 'Delete'
    );

    remove.type = 'button';

    remove.addEventListener('click', () => {
      if (!confirm('この旅行日記を削除しますか？')) {
        return;
      }

      const old = [...getTripRecords(id)];

      trips[id].splice(index, 1);

      if (!trips[id].length) {
        delete trips[id];
      }

      if (!saveData()) {
        trips[id] = old;
        alert('削除できませんでした。');
        return;
      }

      renderTrips();
      refreshAll();
    });

    actions.append(view, edit, remove);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function compressPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('写真を読み込めませんでした。'));
    };

    reader.onload = () => {
      const image = new Image();

      image.onerror = () => {
        reject(new Error('画像を開けませんでした。'));
      };

      image.onload = () => {
        const ratio = Math.min(
          1, 900 / Math.max(image.width, image.height)
        );

        const canvas = document.createElement('canvas');

        canvas.width = Math.max(
          1, Math.round(image.width * ratio)
        );

        canvas.height = Math.max(
          1, Math.round(image.height * ratio)
        );

        const context = canvas.getContext('2d');

        if (!context) {
          reject(new Error('画像処理に失敗しました。'));
          return;
        }

        context.drawImage(
          image, 0, 0, canvas.width, canvas.height
        );

        resolve(canvas.toDataURL('image/jpeg', 0.65));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

const diaryEditButton = makeElement(
  'button', 'diary-editor-save', 'Edit Diary'
);

diaryEditButton.type = 'button';
diaryEditButton.id = 'diary-edit-button';
diaryEditButton.hidden = true;

$('editor-save').insertAdjacentElement(
  'afterend', diaryEditButton
);

function setDiaryEditMode(editing) {
  [
    'editor-dates',
    'editor-city-wrap',
    'editor-text-wrap',
    'editor-photo-control',
    'editor-photo-count',
    'editor-message',
    'editor-save'
  ].forEach(id => {
    $(id).hidden = !editing;
  });

  [
    'viewer-date',
    'viewer-city',
    'viewer-text'
  ].forEach(id => {
    $(id).hidden = editing;
  });

  diaryEditButton.hidden = editing;
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

      placeholder.appendChild(
        makeElement('span', '', '✈')
      );

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

function openDiaryEditor(id, name, tripIndex = null) {
  const existingTrip = tripIndex !== null
    ? getTripRecords(id)[tripIndex]
    : null;

  if (tripIndex !== null && !existingTrip) {
    alert('旅行日記が見つかりませんでした。');
    return;
  }

  editorCountryId = id;
  editorTripIndex = tripIndex;

  editorPhotos = existingTrip
    ? [...tripPhotos(existingTrip)]
    : [];

  editorLoading = false;

  $('viewer-country').textContent =
    name || getCountryName(id);

  applyDiaryColor(id);

  $('editor-start').value = existingTrip?.start || '';
  $('editor-end').value = existingTrip?.end || '';
  $('editor-city').value = existingTrip?.city || '';
  $('editor-text').value = existingTrip?.diary || '';

  $('editor-photos').value = '';
  $('editor-message').textContent = '';
  $('editor-save').disabled = false;

  $('editor-save').textContent = existingTrip
    ? 'Save Changes'
    : 'Save My Memories';

  setDiaryEditMode(true);
  renderDiaryPhotos(editorPhotos, true);
  showModal(diaryViewer);
}

function openDiaryViewer(id, trip) {
  if (!trip) return;

  editorCountryId = null;
  editorTripIndex = null;
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

  const index = getTripRecords(id).indexOf(trip);

  diaryEditButton.hidden = index < 0;

  diaryEditButton.onclick = () => {
    if (index < 0) return;

    openDiaryEditor(id, getCountryName(id), index);
  };

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
    let limitReached = false;

    for (const file of files) {
      if (editorPhotos.length >= 12) {
        limitReached = true;
        break;
      }

      if (!file.type.startsWith('image/')) {
        continue;
      }

      const photo = await compressPhoto(file);
      editorPhotos.push(photo);
    }

    message.textContent = limitReached
      ? '写真は最大12枚まで追加できます。'
      : '';

  } catch (error) {
    console.error(error);
    message.textContent = '写真を読み込めませんでした。';

  } finally {
    renderDiaryPhotos(editorPhotos, true);

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

  const oldRecords = [...getTripRecords(id)];
  const oldVisited = [...visitedCountries];

  const editing = editorTripIndex !== null;

  const existingTrip = editing
    ? oldRecords[editorTripIndex]
    : null;

  if (editing && !existingTrip) {
    message.textContent =
      '編集する旅行日記が見つかりませんでした。';

    return;
  }

  const newTrip = {
    ...existingTrip,
    start,
    end,
    city,
    diary,
    photo: editorPhotos[0] || '',
    photos: [...editorPhotos],
    createdAt: existingTrip?.createdAt || now,
    updatedAt: now
  };

  if (editing) {
    trips[id] = [...oldRecords];
    trips[id][editorTripIndex] = newTrip;

  } else {
    trips[id] = [...oldRecords, newTrip];
  }

  if (!visitedCountries.includes(id)) {
    visitedCountries.push(id);
  }

  if (!saveData()) {
    if (oldRecords.length) {
      trips[id] = oldRecords;
    } else {
      delete trips[id];
    }

    visitedCountries = oldVisited;

    message.textContent =
      '保存できませんでした。写真の容量や枚数を減らしてください。';

    return;
  }

  editorTripIndex = null;

  refreshAll();
  openDiaryViewer(id, newTrip);
});

function closeDiaryViewer() {
  if (editorLoading) {
    alert('写真の読み込みが終わるまでお待ちください。');
    return;
  }

  if (
    editorCountryId &&
    !confirm('保存せずに日記を閉じますか？')
  ) {
    return;
  }

  editorCountryId = null;
  editorTripIndex = null;
  editorPhotos = [];

  hideModal(diaryViewer);
}

$('close-diary-viewer').addEventListener(
  'click', closeDiaryViewer
);

diaryViewer.addEventListener('click', event => {
  if (event.target === diaryViewer) {
    closeDiaryViewer();
  }
});

function getUpdatedDate(trip) {
  return trip.updatedAt ||
    trip.createdAt ||
    trip.start ||
    '';
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

    card.setAttribute(
      'aria-label',
      getCountryName(id) + 'の日記を読む'
    );

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


    const open = () => {
      openDiaryViewer(id, trip);
    };

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

const searchInput = $('country-search-input');
const searchResults = $('country-search-results');

const SEARCH_ALIASES = {
  'VA': [
    'Vatican', 'Vatican City', 'Holy See',
    'バチカン', 'バチカン市国'
  ],

  'SG': ['Singapore', 'シンガポール'],
  'LI': ['Liechtenstein', 'リヒテンシュタイン'],
  'MC': ['Monaco', 'モナコ'],
  'SM': ['San Marino', 'サンマリノ'],
  'AD': ['Andorra', 'アンドラ'],
  'KI': ['Kiribati', 'キリバス'],

  'PS': [
    'Palestine', 'State of Palestine', 'パレスチナ'
  ],

  'United States': [
    'USA', 'US', 'America', 'アメリカ'
  ],

  'United Kingdom': [
    'UK', 'Britain', 'Great Britain', 'イギリス'
  ],

  'Japan': ['JP', '日本'],
  'BR': ['Brazil', 'Brasil', 'ブラジル'],
  'KR': ['South Korea', 'Korea', '韓国'],
  'KP': ['North Korea', '北朝鮮'],
  'Russian Federation': ['Russia', 'ロシア'],
  'VN': ['Vietnam', 'Viet Nam', 'ベトナム'],
  'CZ': ['Czechia', 'Czech Republic', 'チェコ'],
  'Turkey': ['Turkey', 'Türkiye', 'トルコ']
};

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getSearchableCountries() {
  return [...countryNames.entries()]

    .filter(([id, name]) =>
      id &&
      name &&
      name.trim().toLowerCase() !== 'country'
    )

    .map(([id, name]) => ({ id, name }))

    .sort((a, b) =>
      a.name.localeCompare(b.name, 'en')
    );
}

function countryMatchesSearch(country, query) {
  const aliases = SEARCH_ALIASES[country.id] || [];

  const names = [
    country.name,
    country.id,
    ...aliases
  ];

  return names.some(name =>
    normalizeSearch(name).includes(query)
  );
}

function renderSearchResults() {
  const query = normalizeSearch(searchInput.value);

  searchResults.replaceChildren();

  if (!query) {
    searchResults.hidden = true;
    return;
  }

  const matches = getSearchableCountries()

    .filter(country =>
      countryMatchesSearch(country, query)
    )

    .sort((a, b) => {
      const aName = normalizeSearch(a.name);
      const bName = normalizeSearch(b.name);

      const aExact = aName === query;
      const bExact = bName === query;

      if (aExact !== bExact) {
        return aExact ? -1 : 1;
      }

      const aStarts = aName.startsWith(query);
      const bStarts = bName.startsWith(query);

      if (aStarts !== bStarts) {
        return aStarts ? -1 : 1;
      }

      return a.name.localeCompare(b.name, 'en');
    })

    .slice(0, 12);


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
      const status = makeElement(
        'span', 'country-search-status', 'Visited'
      );

      status.style.color =
        countryColors[country.id] || VISITED_COLOR;

      button.appendChild(status);
    }

    button.addEventListener('click', () => {
      searchInput.value = country.name;
      searchResults.hidden = true;
      searchInput.blur();

      zoomToCountry(country.id);

      openCountryMenu(
        country.id, country.name
      );
    });

    searchResults.appendChild(button);
  });

  searchResults.hidden = false;
}

searchInput.addEventListener(
  'input', renderSearchResults
);

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) {
    renderSearchResults();
  }
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

  if (!diaryViewer.hidden) {
    closeDiaryViewer();

  } else if (!travelModal.hidden) {
    closeTravelModal();

  } else if (!colorModal.hidden) {
    closeColorModal();

  } else if (!promptModal.hidden) {
    closeCountryMenu();
  }
});

const ISO_COUNTRIES = `
AD AE AF AG AL AM AO AR AT AU AZ
BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ
CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ
DE DJ DK DM DO DZ
EC EE EG ER ES ET
FI FJ FM FR
GA GB GD GE GH GM GN GQ GR GT GW GY
HN HR HT HU
ID IE IL IN IQ IR IS IT
JM JO JP
KE KG KH KI KM KN KP KR KW KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ
NA NE NG NI NL NO NP NR NZ
OM
PA PE PG PH PK PL PS PT PW PY
QA
RO RS RU RW
SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ
TD TG TH TJ TL TM TN TO TR TT TV TZ
UA UG US UY UZ
VA VC VE VN VU
WS
YE
ZA ZM ZW
`.trim().split(/\s+/);

const englishNames = new Intl.DisplayNames(
  ['en'], { type: 'region' }
);

const japaneseNames = new Intl.DisplayNames(
  ['ja'], { type: 'region' }
);

const officialNames = {
  VA: 'Vatican City',
  PS: 'Palestine',
  US: 'United States',
  GB: 'United Kingdom',
  KR: 'South Korea',
  KP: 'North Korea',
  RU: 'Russia',
  CZ: 'Czech Republic',
  TR: 'Turkey',
  CV: 'Cape Verde',
  CI: "Côte d'Ivoire",
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  FM: 'Micronesia',
  SZ: 'Eswatini',
  TL: 'Timor-Leste'
};

const countryCodeLookup = new Map();
const registeredCountryIds = new Map();

function normalizeCountryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

ISO_COUNTRIES.forEach(code => {
  [
    code,
    englishNames.of(code),
    officialNames[code]
  ].filter(Boolean).forEach(name => {
    countryCodeLookup.set(
      normalizeCountryName(name), code
    );
  });
});

const extraCountryNames = {
  'Russian Federation': 'RU',
  'United States of America': 'US',
  'Republic of Korea': 'KR',
  'Korea, Republic of': 'KR',
  'Democratic Republic of Korea': 'KP',
  "Democratic People's Republic of Korea": 'KP',
  'Viet Nam': 'VN',
  'Czechia': 'CZ',
  'Swaziland': 'SZ',
  'Macedonia': 'MK',
  'Brunei Darussalam': 'BN',
  'Lao PDR': 'LA',
  "Lao People's Democratic Republic": 'LA',
  'United Republic of Tanzania': 'TZ',
  'Federated States of Micronesia': 'FM',
  'Micronesia, Federated States of': 'FM',
  'Holy See': 'VA',
  'State of Palestine': 'PS',
  'Palestinian Territories': 'PS',
  'West Bank': 'PS',
  'Gaza Strip': 'PS',
  'Congo': 'CG',
  'Congo, Dem. Rep.': 'CD',
  'Democratic Republic of Congo': 'CD',
  'Republic of Congo': 'CG',
  'Ivory Coast': 'CI',
  'Cabo Verde': 'CV',
  'East Timor': 'TL',
  'The Bahamas': 'BS',
  'The Gambia': 'GM',
  'Türkiye': 'TR',
  'Sao Tome and Principe': 'ST',
  'Saint Vincent and the Grenadines': 'VC',
  'Saint Kitts and Nevis': 'KN',
  'Saint Lucia': 'LC'
};

Object.entries(extraCountryNames)
  .forEach(([name, code]) => {
    countryCodeLookup.set(
      normalizeCountryName(name), code
    );
  });

function resolveCountryCode(value) {
  return countryCodeLookup.get(
    normalizeCountryName(value)
  ) || null;
}

function updateStats() {
  const visitedCodes = new Set();

  getVisitedIds().forEach(id => {
    const code =
      resolveCountryCode(id) ||
      resolveCountryCode(getCountryName(id));

    if (code) {
      visitedCodes.add(code);
    }
  });

  const count = visitedCodes.size;

  $('country-count').textContent = count;

  $('world-percent').textContent =
    ((count / WORLD_COUNTRIES) * 100)
      .toFixed(2) + '%';

  $('travel-days').textContent = totalTravelDays();
}

function applyMapView() {
  if (!svgRoot) return;

  svgRoot.setAttribute(
    'viewBox',
    [
      currentView.x,
      currentView.y,
      currentView.w,
      currentView.h
    ].join(' ')
  );
}

function resetMapView() {
  currentView = { ...originalView };
  applyMapView();
}

function zoomMap(factor, centerX, centerY) {
  if (!svgRoot) return;

  const newWidth = Math.max(
    originalView.w / 40,
    Math.min(originalView.w, currentView.w * factor)
  );

  const ratio = newWidth / currentView.w;
  const newHeight = currentView.h * ratio;

  const x = centerX ??
    currentView.x + currentView.w / 2;

  const y = centerY ??
    currentView.y + currentView.h / 2;

  currentView = {
    x: x - (x - currentView.x) * ratio,
    y: y - (y - currentView.y) * ratio,
    w: newWidth,
    h: newHeight
  };

  applyMapView();
}

$('zoom-in')?.addEventListener(
  'click', () => zoomMap(0.75)
);

$('zoom-out')?.addEventListener(
  'click', () => zoomMap(1.25)
);

$('zoom-reset')?.addEventListener(
  'click', resetMapView
);

function zoomToCountry(id) {
  const shapes = countryGroups.get(id);

  if (!shapes?.length) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  shapes.forEach(shape => {
    try {
      const bounds = shape.getBBox();

      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);

      maxX = Math.max(
        maxX, bounds.x + bounds.width
      );

      maxY = Math.max(
        maxY, bounds.y + bounds.height
      );

    } catch (error) {
      console.warn(error);
    }
  });

  if (!Number.isFinite(minX)) return;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const aspect =
    originalView.w / originalView.h;

  const width = Math.min(
    originalView.w,
    Math.max(
      80,
      (maxX - minX) * 2,
      (maxY - minY) * 2 * aspect
    )
  );

  const height = width / aspect;

  currentView = {
    x: centerX - width / 2,
    y: centerY - height / 2,
    w: width,
    h: height
  };

  applyMapView();
}

function registerCountryShape(shape, id, name) {
  if (!id || !name) return;

  countryNames.set(id, name);

  if (!countryGroups.has(id)) {
    countryGroups.set(id, []);
  }

  countryGroups.get(id).push(shape);

  const code =
    resolveCountryCode(id) ||
    resolveCountryCode(name);

  if (code) {
    registeredCountryIds.set(code, id);
  }

  shape.style.cursor = 'pointer';

  shape.setAttribute('aria-label', name);
  shape.setAttribute('tabindex', '0');

  shape.addEventListener('click', event => {
    if (suppressClick) return;

    event.stopPropagation();

    openCountryMenu(id, getCountryName(id));
  });

  shape.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();

      openCountryMenu(id, getCountryName(id));
    }
  });
}

function createCountryMarker(
  id, name, x, y, radius = 2.5
) {
  const marker =
    svgRoot.ownerDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    );

  marker.setAttribute('cx', x);
  marker.setAttribute('cy', y);
  marker.setAttribute('r', radius);

  marker.setAttribute('data-country', id);
  marker.setAttribute('data-name', name);

  marker.setAttribute(
    'class', 'country micro-marker'
  );

  marker.setAttribute('stroke', '#ffffff');
  marker.setAttribute('stroke-width', '0.8');

  marker.setAttribute(
    'vector-effect', 'non-scaling-stroke'
  );

  svgRoot.appendChild(marker);

  registerCountryShape(marker, id, name);
}

function addSmallCountryMarkers() {
  countryGroups.forEach((shapes, id) => {
    if (!shapes.length) return;

    if (
      shapes.some(shape =>
        shape.tagName.toLowerCase() === 'circle'
      )
    ) {
      return;
    }

    let largestShape = null;
    let largestArea = 0;

    shapes.forEach(shape => {
      try {
        const bounds = shape.getBBox();

        const area =
          bounds.width * bounds.height;

        if (area > largestArea) {
          largestArea = area;
          largestShape = bounds;
        }

      } catch (error) {
        console.warn(error);
      }
    });

    if (!largestShape) return;

    if (
      largestShape.width <= 10 &&
      largestShape.height <= 10
    ) {
      createCountryMarker(
        id,
        getCountryName(id),
        largestShape.x + largestShape.width / 2,
        largestShape.y + largestShape.height / 2,
        2.5
      );
    }
  });
}

function registerAllCountries() {
  ISO_COUNTRIES.forEach(code => {
    const existingId =
      registeredCountryIds.get(code);

    const name =
      officialNames[code] || englishNames.of(code);

    const id = existingId || code;

    if (!countryNames.has(id)) {
      countryNames.set(id, name);
    }

    if (!countryGroups.has(id)) {
      countryGroups.set(id, []);
    }

    registeredCountryIds.set(code, id);

    SEARCH_ALIASES[id] = [
      ...(SEARCH_ALIASES[id] || []),
      ...(SEARCH_ALIASES[code] || []),
      code,
      name,
      englishNames.of(code),
      japaneseNames.of(code)
    ];
  });
}

function migrateCountryData() {
  const oldIds = new Set([
    ...visitedCountries,
    ...Object.keys(trips),
    ...Object.keys(countryColors)
  ]);

  const oldVisited = [...visitedCountries];
  const oldTrips = { ...trips };
  const oldColors = { ...countryColors };

  let changed = false;

  oldIds.forEach(oldId => {
    const code = resolveCountryCode(oldId);

    if (!code) return;

    const newId =
      registeredCountryIds.get(code);

    if (!newId || newId === oldId) return;

    if (visitedCountries.includes(oldId)) {
      visitedCountries =
        visitedCountries.filter(id => id !== oldId);

      visitedCountries.push(newId);
    }

    if (trips[oldId]) {
      trips[newId] = [
        ...getTripRecords(newId),
        ...getTripRecords(oldId)
      ];

      delete trips[oldId];
    }

    if (countryColors[oldId]) {
      if (!countryColors[newId]) {
        countryColors[newId] = countryColors[oldId];
      }

      delete countryColors[oldId];
    }

    changed = true;
  });

  visitedCountries = [
    ...new Set(visitedCountries)
  ];

  if (changed && !saveData()) {
    visitedCountries = oldVisited;
    trips = oldTrips;
    countryColors = oldColors;

    console.warn('Country data migration failed.');
  }
}

function getSVGPoint(x, y) {
  const point = svgRoot.createSVGPoint();

  point.x = x;
  point.y = y;

  const matrix = svgRoot.getScreenCTM();

  return matrix
    ? point.matrixTransform(matrix.inverse())
    : point;
}

function setupMapControls() {
  svgRoot.style.touchAction = 'none';

  const pointers = new Map();

  let previousPinchDistance = null;
  let gestureMoved = false;

  svgRoot.addEventListener(
    'wheel',
    event => {
      event.preventDefault();

      const point = getSVGPoint(
        event.clientX, event.clientY
      );

      zoomMap(
        event.deltaY < 0 ? 0.85 : 1.15,
        point.x,
        point.y
      );
    },
    { passive: false }
  );

  svgRoot.addEventListener('pointerdown', event => {
    if (
      event.pointerType === 'mouse' &&
      event.button !== 0
    ) {
      return;
    }

    if (!pointers.size) {
      gestureMoved = false;
      suppressClick = false;
    }

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    dragState = {
      x: event.clientX,
      y: event.clientY,
      viewX: currentView.x,
      viewY: currentView.y
    };

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];

      previousPinchDistance = Math.hypot(
        a.x - b.x, a.y - b.y
      );

      gestureMoved = true;
      suppressClick = true;
    }
  });

  svgRoot.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];

      const distance = Math.hypot(
        a.x - b.x, a.y - b.y
      );

      const center = getSVGPoint(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2
      );

      if (previousPinchDistance && distance > 0) {
        zoomMap(
          previousPinchDistance / distance,
          center.x,
          center.y
        );
      }

      previousPinchDistance = distance;

      gestureMoved = true;
      suppressClick = true;

      return;
    }

    if (!dragState) return;

    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      gestureMoved = true;
      suppressClick = true;
    }

    if (!gestureMoved) return;

    const matrix = svgRoot.getScreenCTM();

    if (!matrix) return;

    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);

    currentView.x =
      dragState.viewX - dx / scaleX;

    currentView.y =
      dragState.viewY - dy / scaleY;

    applyMapView();
  });

  function stopPointer(event) {
    pointers.delete(event.pointerId);

    previousPinchDistance = null;

    if (pointers.size === 1) {
      const remaining =
        [...pointers.values()][0];

      dragState = {
        x: remaining.x,
        y: remaining.y,
        viewX: currentView.x,
        viewY: currentView.y
      };

      return;
    }

    dragState = null;

    if (gestureMoved) {
      suppressClick = true;

      setTimeout(() => {
        suppressClick = false;
      }, 300);
    }
  }

  svgRoot.ownerDocument.addEventListener(
    'pointerup', stopPointer
  );

  svgRoot.ownerDocument.addEventListener(
    'pointercancel', stopPointer
  );
}

function initializeMap() {
  if (mapInitialized || !mapObject) return;

  const svgDocument = mapObject.contentDocument;

  if (!svgDocument) return;

  svgRoot = svgDocument.querySelector('svg');

  if (!svgRoot) return;

  mapInitialized = true;

  const viewBox = svgRoot.viewBox.baseVal;

  if (viewBox.width && viewBox.height) {
    originalView = {
      x: viewBox.x,
      y: viewBox.y,
      w: viewBox.width,
      h: viewBox.height
    };
  }

  currentView = { ...originalView };

  countryGroups = new Map();
  countryNames = new Map();

  registeredCountryIds.clear();

  const shapes = [
    ...svgRoot.querySelectorAll(
      'path, circle[data-country]'
    )
  ];

  const nameToId = new Map();

  shapes.forEach(shape => {
    const id = shape.getAttribute('id');

    const name =
      shape.getAttribute('name') ||
      shape.getAttribute('data-name');

    if (id && name) {
      nameToId.set(
        normalizeCountryName(name), id
      );
    }
  });


  shapes.forEach(shape => {
    if (
      shape.closest('defs, clipPath, mask, pattern')
    ) {
      return;
    }

    const rawId = shape.getAttribute('id');

    const rawCountry =
      shape.getAttribute('data-country');

    const rawName =
      shape.getAttribute('name') ||
      shape.getAttribute('data-name') ||
      shape.getAttribute('aria-label') ||
      shape.querySelector('title')?.textContent ||
      rawCountry ||
      rawId;

    if (!rawName) return;

    const code =
      resolveCountryCode(rawId) ||
      resolveCountryCode(rawCountry) ||
      resolveCountryCode(rawName);

    const name = code
      ? (officialNames[code] || englishNames.of(code))
      : (SHORT_NAMES[rawName] || rawName);

    const id =
      registeredCountryIds.get(code) ||
      nameToId.get(normalizeCountryName(rawName)) ||
      rawId ||
      rawCountry ||
      rawName;

    registerCountryShape(shape, id, name);
  });


  registerAllCountries();

  migrateCountryData();

  addSmallCountryMarkers();

  setupMapControls();

  refreshAll();


  const missingMapCountries =
    ISO_COUNTRIES.filter(code => {
      const id = registeredCountryIds.get(code);

      return !countryGroups.get(id)?.length;
    });

  console.log(
    'Registered countries:',
    registeredCountryIds.size
  );

  console.log(
    'Expected countries:',
    WORLD_COUNTRIES
  );

  console.log(
    'Countries without map shapes:',
    missingMapCountries
  );

  console.log('TRAVEL LOG is ready!');
}


if (mapObject) {
  mapObject.addEventListener('load', initializeMap);

  if (
    mapObject.contentDocument &&
    mapObject.contentDocument.readyState === 'complete'
  ) {
    initializeMap();
  }
}
/* DIARY TOP ACTION BUTTONS */

const topDiaryEdit = $('diary-edit');
const topDiaryDelete = $('diary-delete');
const topDiaryCancel = $('diary-cancel');

let currentDiaryId = null;
let currentDiaryRecord = null;

/* SHOW ACTION BUTTONS */

function updateDiaryActions(mode) {
  topDiaryEdit.hidden = mode !== 'view';
  topDiaryDelete.hidden = mode !== 'view';
  topDiaryCancel.hidden = mode !== 'edit';

  diaryEditButton.hidden = true;
}

/* EXTEND DIARY VIEWER */

const originalOpenDiaryViewer = openDiaryViewer;

openDiaryViewer = function(id, trip) {
  originalOpenDiaryViewer(id, trip);

  currentDiaryId = id;
  currentDiaryRecord = trip;

  updateDiaryActions('view');
};

/* EXTEND DIARY EDITOR */

const originalOpenDiaryEditor = openDiaryEditor;

openDiaryEditor = function(id, name, tripIndex = null) {
  if (
    tripIndex !== null &&
    !getTripRecords(id)[tripIndex]
  ) {
    return;
  }

  originalOpenDiaryEditor(id, name, tripIndex);

  currentDiaryId = id;

  currentDiaryRecord = tripIndex !== null
    ? getTripRecords(id)[tripIndex]
    : null;

  updateDiaryActions(
    tripIndex !== null ? 'edit' : 'create'
  );
};

/* EDIT SAVED DIARY */

topDiaryEdit.addEventListener('click', () => {
  if (!currentDiaryId || !currentDiaryRecord) return;

  const index = getTripRecords(currentDiaryId)
    .indexOf(currentDiaryRecord);

  if (index < 0) return;

  openDiaryEditor(
    currentDiaryId,
    getCountryName(currentDiaryId),
    index
  );
});

/* CANCEL EDITING */

topDiaryCancel.addEventListener('click', () => {
  if (editorLoading) return;

  if (!currentDiaryId || !currentDiaryRecord) return;

  if (!confirm('Discard unsaved changes?')) return;

  openDiaryViewer(
    currentDiaryId,
    currentDiaryRecord
  );
});

/* DELETE SAVED DIARY */

topDiaryDelete.addEventListener('click', () => {
  if (!currentDiaryId || !currentDiaryRecord) return;

  const id = currentDiaryId;
  const records = getTripRecords(id);
  const index = records.indexOf(currentDiaryRecord);

  if (index < 0) return;

  const confirmed = confirm(
    'Are you sure you want to delete this memory?'
  );

  if (!confirmed) return;

  const oldRecords = [...records];

  trips[id] = records.filter((_, i) => i !== index);

  if (!trips[id].length) {
    delete trips[id];
  }

  if (!saveData()) {
    trips[id] = oldRecords;
    alert('Failed to delete this memory.');
    return;
  }

  currentDiaryId = null;
  currentDiaryRecord = null;

  editorCountryId = null;
  editorTripIndex = null;
  editorPhotos = [];

  hideModal(diaryViewer);

  refreshAll();
});