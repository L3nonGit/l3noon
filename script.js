/* Agsysten Calendar App - script.js */
(function () {
  const STORAGE_KEY = 'agsysten_events_v1';
  const SETTINGS_KEY = 'agsysten_settings_v1';

  const ViewMap = {
    dayGridmonth: 'dayGridMonth',
    timeGridweek: 'timeGridWeek',
    timeGriday: 'timeGridDay',
    listweek: 'listWeek'
  };

  // Category mapping used for sidebar filters
  const SidebarCategoryMap = {
    'Meu calendário': 'meu',
    'Trabalho': 'trabalho',
    'Pessoal': 'pessoal',
    'Feriados': 'feriados'
  };

  const defaultSettings = { theme: 'light', userType: 'gestor', activeCalendars: ['meu', 'trabalho', 'pessoal', 'feriados'] };

  let settings = loadSettings();
  applyTheme(settings.theme);

  // DOM refs
  const calendarEl = document.getElementById('calendar');
  const miniCalendarEl = document.getElementById('miniCalendar');
  const viewButtons = document.querySelectorAll('.view-btn');
  const themeToggle = document.getElementById('themeToggle');
  const createEventBtn = document.querySelector('.create-event-btn');
  const searchInput = document.querySelector('.search-box input');
  const sidebarItems = document.querySelectorAll('.calendar-item');
  const userTypeButtons = document.querySelectorAll('.user-type-btn');

  // Modal refs
  const modal = document.getElementById('eventModal');
  const modalTitle = document.getElementById('modalTitle');
  const btnCloseModal = document.querySelector('#eventModal .close');
  const btnCancel = document.getElementById('cancelEvent');
  const btnDelete = document.getElementById('deleteEvent');
  const form = document.getElementById('eventForm');
  const inputTitle = document.getElementById('eventTitle');
  const inputStart = document.getElementById('eventStart');
  const inputEnd = document.getElementById('eventEnd');
  const inputDescription = document.getElementById('eventDescription');
  const inputColor = document.getElementById('eventColor');

  let mainCalendar = null;
  let miniCalendar = null;
  let currentEditingId = null;
  let currentSelectionStart = null;
  let currentSelectionEnd = null;
  let currentSearch = '';

  // Initialize
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    // Theme at start
    applyTheme(settings.theme);
    reflectUserTypeUI();

    // Load events (seed from JSON + user storage)
    const seedEvents = await loadSeedEvents();
    const userEvents = loadUserEvents();
    const merged = mergeEvents(seedEvents, userEvents);

    // Setup FullCalendar instances
    mainCalendar = new FullCalendar.Calendar(calendarEl, buildMainCalendarOptions(merged));
    mainCalendar.render();

    miniCalendar = new FullCalendar.Calendar(miniCalendarEl, buildMiniCalendarOptions());
    miniCalendar.render();

    // Wire UI events
    wireViewButtons();
    wireThemeToggle();
    wireSidebarCalendars();
    wireUserTypeSelector();
    wireSearch();
    wireCreateButton();

    // Close modal handlers
    btnCloseModal.addEventListener('click', hideModal);
    btnCancel.addEventListener('click', hideModal);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideModal(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });

    // Form submit
    form.addEventListener('submit', onSubmitEvent);
    btnDelete.addEventListener('click', onDeleteEvent);

    // Reflect initial filters in sidebar
    reflectSidebarActiveStates();
  }

  function buildMainCalendarOptions(initialEvents) {
    return {
      initialView: 'dayGridMonth',
      headerToolbar: false,
      height: 'auto',
      selectable: true,
      editable: true,
      navLinks: true,
      weekNumbers: false,
      nowIndicator: true,
      events: initialEvents,
      dateClick: (info) => {
        if (!canCreate()) return;
        currentEditingId = null;
        currentSelectionStart = info.date;
        currentSelectionEnd = new Date(info.date.getTime() + 60 * 60 * 1000);
        openModal('Novo Evento');
      },
      select: (info) => {
        if (!canCreate()) return;
        currentEditingId = null;
        currentSelectionStart = info.start;
        currentSelectionEnd = info.end;
        openModal('Novo Evento');
      },
      eventClick: (info) => {
        const ev = info.event;
        currentEditingId = ev.id;
        currentSelectionStart = null;
        currentSelectionEnd = null;
        openModal('Editar Evento', ev);
      },
      eventDrop: ({ event }) => {
        upsertEventFromCalendarEvent(event);
      },
      eventResize: ({ event }) => {
        upsertEventFromCalendarEvent(event);
      },
      datesSet: (arg) => {
        // Sync mini calendar title/month
        miniCalendar.gotoDate(arg.start);
      },
      eventDidMount: (arg) => {
        // Tooltip via title attr
        if (arg.event.extendedProps.description) {
          arg.el.title = arg.event.extendedProps.description;
        }
      }
    };
  }

  function buildMiniCalendarOptions() {
    return {
      initialView: 'dayGridMonth',
      height: 'auto',
      headerToolbar: { left: 'prev', center: 'title', right: 'next' },
      selectable: true,
      dateClick: (info) => {
        mainCalendar.gotoDate(info.date);
      }
    };
  }

  function wireViewButtons() {
    viewButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.view || '';
        const mapped = ViewMap[raw] || 'dayGridMonth';
        mainCalendar.changeView(mapped);
        viewButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  function wireThemeToggle() {
    themeToggle.addEventListener('click', () => {
      settings.theme = settings.theme === 'light' ? 'dark' : 'light';
      saveSettings();
      applyTheme(settings.theme);
    });
  }

  function wireSearch() {
    searchInput.addEventListener('input', () => {
      currentSearch = (searchInput.value || '').toLowerCase();
      refreshEvents();
    });
  }

  function wireCreateButton() {
    if (createEventBtn) {
      createEventBtn.addEventListener('click', () => {
        if (!canCreate()) return;
        const start = new Date();
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        currentEditingId = null;
        currentSelectionStart = start;
        currentSelectionEnd = end;
        openModal('Novo Evento');
      });
    }
  }

  function wireSidebarCalendars() {
    sidebarItems.forEach((item) => {
      item.addEventListener('click', () => {
        const label = (item.querySelector('span')?.textContent || '').trim();
        const key = SidebarCategoryMap[label];
        if (!key) return;
        const idx = settings.activeCalendars.indexOf(key);
        if (idx >= 0) settings.activeCalendars.splice(idx, 1);
        else settings.activeCalendars.push(key);
        saveSettings();
        reflectSidebarActiveStates();
        refreshEvents();
      });
    });
  }

  function wireUserTypeSelector() {
    userTypeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        userTypeButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type || 'gestor';
        settings.userType = type;
        saveSettings();
        reflectUserTypeUI();
      });
    });
    // Reflect initial UI state based on saved settings
    userTypeButtons.forEach((btn) => {
      if ((btn.dataset.type || 'gestor') === settings.userType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function reflectUserTypeUI() {
    const isFuncionario = settings.userType === 'funcionario';
    // Funcionário: não pode criar/excluir
    if (createEventBtn) createEventBtn.style.display = isFuncionario ? 'none' : 'inline-flex';
    // Also disable selection/edit features visually by cursor style (hard enforcement in handlers)
    calendarEl.style.pointerEvents = 'auto';
  }

  function reflectSidebarActiveStates() {
    sidebarItems.forEach((item) => {
      const label = (item.querySelector('span')?.textContent || '').trim();
      const key = SidebarCategoryMap[label];
      if (!key) return;
      if (settings.activeCalendars.includes(key)) item.classList.add('active');
      else item.classList.remove('active');
    });
  }

  function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
  }

  function canCreate() {
    return settings.userType === 'gestor';
  }

  function canDelete() {
    return settings.userType === 'gestor';
  }

  function openModal(title, fcEvent) {
    modalTitle.textContent = title;
    // Pre-fill fields
    if (fcEvent) {
      inputTitle.value = fcEvent.title || '';
      inputStart.value = toLocalInputValue(fcEvent.start);
      inputEnd.value = toLocalInputValue(fcEvent.end || new Date(fcEvent.start.getTime() + 60 * 60 * 1000));
      inputDescription.value = fcEvent.extendedProps?.description || '';
      inputColor.value = fcEvent.backgroundColor || fcEvent.borderColor || '#4285f4';
      btnDelete.style.display = canDelete() ? 'inline-flex' : 'none';
    } else {
      const start = currentSelectionStart || new Date();
      const end = currentSelectionEnd || new Date(start.getTime() + 60 * 60 * 1000);
      inputTitle.value = '';
      inputStart.value = toLocalInputValue(start);
      inputEnd.value = toLocalInputValue(end);
      inputDescription.value = '';
      inputColor.value = '#4285f4';
      btnDelete.style.display = 'none';
    }

    modal.classList.add('show');
  }

  function hideModal() {
    modal.classList.remove('show');
    currentEditingId = null;
    currentSelectionStart = null;
    currentSelectionEnd = null;
    form.reset();
  }

  function onSubmitEvent(e) {
    e.preventDefault();
    const title = inputTitle.value.trim();
    const start = new Date(inputStart.value);
    const end = new Date(inputEnd.value);
    const description = inputDescription.value.trim();
    const color = inputColor.value || '#4285f4';

    if (!title || isNaN(start) || isNaN(end) || end <= start) {
      alert('Verifique o título e o período (fim deve ser maior que o início).');
      return;
    }

    const category = inferCategoryFromColor(color);

    const eventData = {
      id: currentEditingId || generateId(),
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      description,
      color,
      category
    };

    upsertUserEvent(eventData);
    refreshEvents();
    hideModal();
  }

  function onDeleteEvent() {
    if (!canDelete()) return;
    if (!currentEditingId) return;
    if (!confirm('Tem certeza que deseja excluir este evento?')) return;
    deleteUserEvent(currentEditingId);
    refreshEvents();
    hideModal();
  }

  function upsertEventFromCalendarEvent(fcEvent) {
    // Only allow editing user-created events, but for simulation we'll upsert as user event
    const data = {
      id: fcEvent.id || generateId(),
      title: fcEvent.title,
      start: fcEvent.start?.toISOString(),
      end: fcEvent.end?.toISOString(),
      description: fcEvent.extendedProps?.description || '',
      color: fcEvent.backgroundColor || '#4285f4',
      category: fcEvent.extendedProps?.category || inferCategoryFromColor(fcEvent.backgroundColor || '#4285f4')
    };
    upsertUserEvent(data);
  }

  // Storage helpers
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaultSettings };
      return { ...defaultSettings, ...JSON.parse(raw) };
    } catch { return { ...defaultSettings }; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  async function loadSeedEvents() {
    try {
      const res = await fetch('events.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return Array.isArray(data?.events) ? data.events : [];
    } catch (err) {
      // Fallback seed
      return [
        {
          id: 'seed-1',
          title: 'Reunião de Planejamento',
          start: '2025-08-10T09:00:00',
          end: '2025-08-10T10:00:00',
          description: 'Sprint planning com a equipe',
          color: '#4285f4',
          category: 'trabalho'
        },
        {
          id: 'seed-2',
          title: 'Consulta Médica',
          start: '2025-08-12T15:00:00',
          end: '2025-08-12T16:00:00',
          description: 'Clínica Central',
          color: '#ea4335',
          category: 'pessoal'
        },
        {
          id: 'seed-3',
          title: 'Feriado Nacional',
          start: '2025-09-07',
          end: '2025-09-08',
          description: 'Independência do Brasil',
          color: '#9c27b0',
          category: 'feriados'
        }
      ];
    }
  }

  function loadUserEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function saveUserEvents(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }

  function mergeEvents(seed, user) {
    // Prefer user events when ids collide
    const byId = new Map();
    seed.forEach((e) => byId.set(String(e.id), { ...e }));
    user.forEach((e) => byId.set(String(e.id), { ...e }));
    return Array.from(byId.values());
  }

  function getFilteredEvents() {
    const seed = []; // will be replaced after first fetch; keep empty here
    const user = loadUserEvents();
    // We need the latest seed that calendar loaded initially. We'll grab from calendar eventSource as truth.
    const current = mainCalendar.getEvents().map(evtToData);

    // Merge current (which includes both) with user again to ensure latest user edits
    const merged = mergeEvents(current, user);

    // Apply filters (category + search)
    return merged.filter((e) => {
      if (settings.activeCalendars.length && !settings.activeCalendars.includes(e.category || 'meu')) return false;
      if (currentSearch) {
        const hay = [e.title, e.description].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(currentSearch)) return false;
      }
      return true;
    });
  }

  function refreshEvents() {
    const filtered = getFilteredEvents();
    mainCalendar.removeAllEvents();
    filtered.forEach((e) => mainCalendar.addEvent(dataToCalendarEvent(e)));
  }

  function upsertUserEvent(eventData) {
    const all = loadUserEvents();
    const idx = all.findIndex((e) => String(e.id) === String(eventData.id));
    if (idx >= 0) all[idx] = eventData; else all.push(eventData);
    saveUserEvents(all);
  }

  function deleteUserEvent(id) {
    const all = loadUserEvents().filter((e) => String(e.id) !== String(id));
    saveUserEvents(all);
  }

  // Utils
  function toLocalInputValue(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function generateId() {
    return 'e_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function inferCategoryFromColor(color) {
    const c = (color || '').toLowerCase();
    if (c === '#4285f4') return 'trabalho';
    if (c === '#ea4335') return 'pessoal';
    if (c === '#34a853') return 'meu';
    if (c === '#fbbc04') return 'meu';
    if (c === '#9c27b0') return 'feriados';
    return 'meu';
  }

  function evtToData(evt) {
    return {
      id: evt.id,
      title: evt.title,
      start: evt.start?.toISOString(),
      end: evt.end?.toISOString(),
      description: evt.extendedProps?.description || '',
      color: evt.backgroundColor || '#4285f4',
      category: evt.extendedProps?.category || inferCategoryFromColor(evt.backgroundColor || '#4285f4')
    };
  }

  function dataToCalendarEvent(data) {
    return {
      id: data.id,
      title: data.title,
      start: data.start,
      end: data.end,
      backgroundColor: data.color,
      borderColor: data.color,
      extendedProps: {
        description: data.description,
        category: data.category || 'meu'
      }
    };
  }
})();