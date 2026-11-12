const messages = document.querySelector('#messages');
const form = document.querySelector('form');
const input = document.querySelector('input');
const suggestions = document.querySelector('#suggestions');
const commands = new Map();
let builtins = [];
let matches = [];
const templates = new Map();
const history = [];
let historyIndex = 0;
let hideTimer;
let fadeTimer;
let closeTimer;
let openedAt = 0;
let activeFilter = 'all';
const filterButtons = [...document.querySelectorAll('nav button[data-filter]')];

// /me /do /try i komunikaty systemowe widac na kazdej zakladce
function isRowHidden(row, filter) {
    if (row.dataset.rp === 'true' || row.dataset.category === 'system') return false;
    return filter !== 'all' && row.dataset.category !== filter;
}

// kody kolorow FiveM (^1, ^*, ^r ...) z innych zasobow nie sa juz pokazywane doslownie
function cleanPart(value) {
    return String(value ?? '').replace(/\^[0-9*_~=r]/g, '');
}

function setActiveFilter(filter) {
    const valid = filterButtons.some((button) => button.dataset.filter === filter);
    if (!valid) return;
    activeFilter = filter;
    // zmiana zakladki nie kasuje juz wpisanego tekstu
    input.placeholder = filter === 'ooc' ? 'Napisz lokalną wiadomość OOC'
        : filter === 'admin' ? 'Opisz problem dla administracji'
        : 'Napisz lokalnie lub wpisz /komendę';
    filterButtons.forEach((button) => {
        const selected = button.dataset.filter === filter;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    messages.querySelectorAll('.row').forEach((row) => {
        row.hidden = isRowHidden(row, filter);
    });
    updateSuggestions();
}

function cycleFilter() {
    const index = filterButtons.findIndex((button) => button.dataset.filter === activeFilter);
    const next = (index + 1) % filterButtons.length;
    setActiveFilter(filterButtons[next].dataset.filter);
}


let selectedSuggestion = -1;
let draft = '';
let lastSent = { text: '', at: 0 };
const TRY_ROLL_MS = 900; // czas "losowania" /try - wspolny dla czatu i dymku

// Zjazd na sam dol historii: od razu, potem jeszcze raz po klatce
// i po zakonczeniu animacji wysokosci (przy otwieraniu historia rosnie).
function scrollToBottom() {
    const jump = () => {
        const prev = messages.style.scrollBehavior;
        messages.style.scrollBehavior = 'auto';
        messages.scrollTop = messages.scrollHeight;
        messages.style.scrollBehavior = prev;
    };
    jump();
    requestAnimationFrame(jump);
}

// czy historia jest przewinieta na sam dol (z malym zapasem)
function atBottom() {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
}

function showMessages(stick = true) {
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    // historia pojawia sie i znika jako calosc (jedna warstwa, tylko przezroczystosc)
    if (messages.style.display === 'none') {
        messages.classList.add('is-fading');
        messages.style.display = 'flex';
        void messages.offsetWidth;
    }
    messages.classList.remove('is-fading');
    // przy otwartym czacie nie sciagaj na dol kogos, kto czyta starsze wiadomosci (PageUp)
    if (stick) scrollToBottom();
    if (form.hidden) {
        hideTimer = setTimeout(() => {
            if (!form.hidden) return;
            messages.classList.add('is-fading');
            fadeTimer = setTimeout(() => {
                if (form.hidden) messages.style.display = 'none';
            }, 480);
        }, 5000);
    }
}

function addMessage(message) {
    const data = typeof message === 'string' ? { args: [message] } : message;
    if (!Array.isArray(data?.args)) return;
    const row = document.createElement('div');
    row.className = 'row';
    const labelText = cleanPart(data.label).trim();
    const label = labelText.toUpperCase();
    row.dataset.category = ['OOC', 'LOOC'].includes(label) ? 'ooc' : label === 'REPORT' ? 'admin' : label === 'SYSTEM' ? 'system' : 'other';
    row.dataset.rp = ['ME', 'DO', 'TRY'].includes(label) ? 'true' : 'false';
    row.dataset.label = label;
    row.hidden = isRowHidden(row, activeFilter);
    const color = data.color;
    const accent = Array.isArray(color) && color.length === 3 && color.every(Number.isFinite)
        ? 'rgb(' + color.join(',') + ')' : '#94a3b8';
    row.style.setProperty('--accent', accent);

    if (labelText) {
        const label = document.createElement('strong');
        label.textContent = labelText;
        row.append(label);
    }
    const args = Array.isArray(data.args) ? data.args.map(cleanPart) : [];
    const template = data.template || templates.get(data.templateId);
    // puste argumenty (np. bez autora) nie zostawiaja juz samego ": " na poczatku
    let text = args.filter((part) => part.trim() !== '').join(': ');
    if (typeof template === 'string' && /\{\d+\}/.test(template)) {
        text = cleanPart(template.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
            .replace(/\{(\d+)\}/g, (_, index) => args[Number(index)] ?? ''));
    }
    if (!text.trim() && !labelText) return;
    row.append(document.createTextNode(text));
    // /try: to samo co w dymku nad glowa i w tym samym czasie - najpierw kostka, po 0,9 s wynik
    if (label === 'TRY' && (data.result === 'ok' || data.result === 'fail')) {
        const chip = document.createElement('span');
        chip.className = 'try-result is-rolling';
        chip.textContent = '🎲';
        row.append(chip);
        row.style.setProperty('--accent', '#40e0d0');
        setTimeout(() => {
            chip.className = 'try-result is-' + data.result;
            chip.textContent = data.result === 'ok' ? '✓ Udane' : '✗ Nieudane';
            row.style.setProperty('--accent', accent);
        }, TRY_ROLL_MS);
    }
    // po wejsciu wiadomosc "osiada" - jej animacje nie odpalaja sie juz ponownie
    setTimeout(() => row.classList.add('settled'), 1800);

    // wiadomosc, ktora wlasnie wyslales, dostaje dodatkowy "wjazd z dolu" i poswiate
    if (lastSent.text && Date.now() - lastSent.at < 2500 && text.includes(lastSent.text)) {
        row.classList.add('is-own');
        lastSent = { text: '', at: 0 };
    }

    const stick = form.hidden || atBottom();
    messages.append(row);
    if (messages.childElementCount > 100) messages.firstElementChild.remove();
    showMessages(stick);

}

function updateSuggestions() {
    const prefix = input.value.toLowerCase();
    const command = prefix.split(/\s/, 1)[0];
    const entries = new Map();
    for (const entry of builtins) {
        if (!entries.has(entry.name)) entries.set(entry.name, entry);
    }
    for (const [name, entry] of commands) entries.set(name, entry);

    matches = [];
    if (command.startsWith('/')) {
        matches = prefix === command
            ? [...entries.values()].filter((entry) => entry.name.toLowerCase().startsWith(command)).sort((a, b) => a.name.localeCompare(b.name))
            : [...entries.values()].filter((entry) => entry.name.toLowerCase() === command);
    }

    suggestions.replaceChildren();
    suggestions.scrollTop = 0;
    if (selectedSuggestion >= matches.length) selectedSuggestion = -1;
    for (const [index, entry] of matches.entries()) {
        const line = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = entry.name;
        const params = Array.isArray(entry.params)
            ? entry.params.filter((param) => param?.name).map((param) => '[' + param.name + ']').join(' ')
            : '';
        line.append(name);
        if (params) line.append(' ' + params);
        if (entry.help) { const help = document.createElement('em'); help.textContent = entry.help; line.append(help); }

        line.style.setProperty('--i', Math.min(index, 8));
        if (index === selectedSuggestion) line.classList.add('is-selected');
        suggestions.append(line);
    }
}
function submissionMode(text) {
    // komendy dzialaja na kazdej zakladce (wczesniej na LOOC/ADM np. "/e" szlo jako tekst)
    if (text.startsWith('/')) return 'command';
    if (activeFilter === 'admin') return 'report';
    return 'ooc';
}

function close(text = '') {
    if (form.hidden || form.classList.contains('is-closing')) return;
    const mode = submissionMode(text);
    form.classList.add('is-closing');
    clearTimeout(closeTimer);
    // tekst, ramka pola i wysokosc historii zostaja do konca animacji -
    // wczesniej znikaly od razu i zamykanie wygladalo na zbugowane
    input.readOnly = true;
    matches = [];
    suggestions.classList.add('is-leaving');
    closeTimer = setTimeout(() => {
        form.hidden = true;
        form.classList.remove('is-closing', 'is-sending');
        suggestions.classList.remove('is-leaving');
        document.body.classList.remove('chat-open');
        input.value = '';
        input.readOnly = false;
        input.blur();
        updateSuggestions();
        showMessages();
    }, 180);
    fetch('https://' + GetParentResourceName() + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
    }).catch(console.error);
}

window.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;
    switch (data.action) {
        case 'overhead': renderOverhead(data.entries); break;
        case 'visibility':
            document.body.classList.toggle('ui-hidden', Boolean(data.hidden));
            if (data.hidden) {
                clearTimeout(closeTimer);
                form.classList.remove('is-closing');
                input.readOnly = false;
                suggestions.classList.remove('is-leaving');
                if (!form.hidden) {
                    form.hidden = true;
                    document.body.classList.remove('chat-open');
                    input.value = '';
                    // bez tego historia zostawala na ekranie na stale po zamknieciu
                    // czatu przez inny interfejs (ekwipunek, pauza)
                    showMessages();
                }
            }
            break;
        case 'open':
            clearTimeout(closeTimer);
            form.classList.remove('is-closing', 'is-sending');
            input.readOnly = false;
            suggestions.classList.remove('is-leaving');
            selectedSuggestion = -1;
            draft = '';
            form.hidden = false;
            document.body.classList.add('chat-open');
            openedAt = Date.now();
            requestAnimationFrame(() => {
                if (!form.hidden && Date.now() - openedAt < 120 && /^[a-ząćęłńóśźż]$/i.test(input.value)) {
                    input.value = '';
                    updateSuggestions();
                }
            });
            historyIndex = history.length;
            updateSuggestions();
            showMessages();
            input.focus();
            break;
        case 'message': addMessage(data.message); break;
        case 'clear':
            clearTimeout(hideTimer);
            clearTimeout(fadeTimer);
            messages.replaceChildren();
            messages.classList.remove('is-fading');
            if (form.hidden) messages.style.display = 'none';
            break;
        case 'builtins': builtins = Array.isArray(data.suggestions) ? data.suggestions : []; updateSuggestions(); break;
        case 'suggest':
            if (typeof data.name === 'string') {
                commands.set(data.name, { name: data.name, help: data.help, params: data.params });
                updateSuggestions();
            }
            break;
        case 'remove': commands.delete(data.name); updateSuggestions(); break;
        case 'template': templates.set(data.id, data.html); break;
    }
});

input.addEventListener('input', () => {
    // Litera z klawisza otwierajacego czat (domyslnie T) potrafi wpasc do pola,
    // bo fokus przychodzi zanim gra skonczy obsluge klawisza - czyscimy ja.
    if (Date.now() - openedAt < 80 && /^[a-ząćęłńóśźż]$/i.test(input.value)) {
        input.value = '';
    }
    selectedSuggestion = -1;
    historyIndex = history.length; // pisanie konczy przegladanie historii
    updateSuggestions();
});
input.addEventListener('keydown', (event) => {
    // Autouzupelnianie komend: Ctrl+Spacja (Tab zmienia zakladki).
    if (event.code === 'Space' && event.ctrlKey) {
        event.preventDefault();
        if (matches.length && !/\s/.test(input.value)) {
            input.value = matches[Math.max(0, selectedSuggestion)].name + ' ';
            selectedSuggestion = -1;
            updateSuggestions();
        }
        return;
    }
    if (event.key === 'Enter' && selectedSuggestion >= 0 && matches[selectedSuggestion] && !/\s/.test(input.value)) {
        // Enter na zaznaczonej komendzie wpisuje ja zamiast wysylac
        event.preventDefault();
        input.value = matches[selectedSuggestion].name + ' ';
        selectedSuggestion = -1;
        updateSuggestions();
        return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? -1 : 1;

    // lista komend widoczna -> strzalki chodza po liscie
    // (ale nie w trakcie przegladania historii - wczesniej np. "/e" z historii "wiezilo" strzalki)
    const browsingHistory = historyIndex !== history.length;
    if (!browsingHistory && matches.length > 1 && !/\s/.test(input.value)) {
        selectedSuggestion = (selectedSuggestion + step + matches.length) % matches.length;
        const lines = suggestions.children;
        [...lines].forEach((line, i) => line.classList.toggle('is-selected', i === selectedSuggestion));
        lines[selectedSuggestion]?.scrollIntoView({ block: 'nearest' });
        return;
    }

    // w przeciwnym razie historia wyslanych wiadomosci (strzalka w dol wraca do tego, co pisales)
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + step));
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
    selectedSuggestion = -1;
    updateSuggestions();
});

// Przechwytuj klawisze na poziomie okna, nawet gdy input straci focus.
document.addEventListener('keydown', (event) => {
    if (!chatActive()) return;
    if (event.key === 'Tab') {
        event.preventDefault();
        if (!event.shiftKey) cycleFilter(); // Shift+Tab nie zmienia zakladek.
        input.focus({ preventScroll: true });
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        // przewijanie historii stronami
        event.preventDefault();
        const page = Math.max(40, messages.clientHeight - 36);
        messages.scrollBy({ top: event.key === 'PageUp' ? -page : page, behavior: 'smooth' });
    } else if (event.key === 'Escape') {
        event.preventDefault();
        close('');
    } else if (event.key === 'Enter' && event.target !== input && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
    }
}, true);

// Klikniecie poza polem wpisywania nie odbiera mozliwosci pisania.
// Fokus wraca TYLKO gdy czat jest otwarty i nikt inny (np. menu txAdmin) go nie przejal -
// wczesniej czat odbieral klawiature innym interfejsom.
function chatActive() {
    return !form.hidden && !form.classList.contains('is-closing') && !document.body.classList.contains('ui-hidden');
}
input.addEventListener('blur', () => {
    setTimeout(() => {
        if (chatActive() && document.hasFocus()) input.focus({ preventScroll: true });
    }, 0);
});

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) {
        history.push(text);
        if (history.length > 40) history.shift();
        // do rozpoznania wlasnej wiadomosci, gdy wroci z serwera (bez /komendy)
        lastSent = { text: text.replace(/^\/\S+\s*/, '').slice(0, 60), at: Date.now() };
    }
    draft = '';
    selectedSuggestion = -1;
    close(text);
});

filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
        setActiveFilter(button.dataset.filter);
        input.focus({ preventScroll: true });
    });
});

setActiveFilter(activeFilter);


const overheadRoot = document.getElementById('overhead');
const overheadNodes = new Map();

const OVERHEAD_GRACE = 220;
let overheadSweepTimer;

function renderOverhead(entries) {
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    const alive = new Set();
    for (const entry of entries.slice(0, 64)) {
        if (!entry || !['me', 'do', 'try'].includes(entry.mode) || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
        const id = String(entry.id);
        alive.add(id);
        const dimmed = entry.visible === false || entry.leaving === true;
        let node = overheadNodes.get(id);
        if (!node) {
            node = document.createElement('div');
            node.className = 'rp-overhead';
            const line = document.createElement('span');
            line.className = 'rp-overhead-line';
            const badge = document.createElement('b');
            badge.className = 'rp-overhead-badge';
            const text = document.createElement('span');
            text.className = 'rp-overhead-text';
            node.append(line, badge, text);
            overheadRoot.append(node);
            overheadNodes.set(id, node);
            const age = Number.isFinite(entry.age) ? entry.age : 0;
            node.dataset.born = String(now - age);
            if (entry.mode === 'try') node.classList.add(age < TRY_ROLL_MS ? 'is-rolling' : 'is-revealed');
            if (dimmed) node.classList.add('no-enter');
        }
        // za sciana / za daleko / konczy sie czas: gasnie, ale dalej podaza za postacia
        node.classList.toggle('is-hidden', dimmed);
        node.dataset.seen = String(now);
        node.classList.toggle('rp-overhead-do', entry.mode === 'do');
        node.classList.toggle('rp-overhead-ok', entry.mode === 'try' && entry.success === true);
        node.classList.toggle('rp-overhead-fail', entry.mode === 'try' && entry.success !== true);
        node.querySelector('.rp-overhead-badge').textContent = entry.mode.toUpperCase();
        const text = String(entry.text || '');
        const short = text.length > 60 ? text.slice(0, 60).trimEnd() + '…' : text;
        let shown = short;
        if (entry.mode === 'try') {
            // "losowanie": przez 0.9 s kreci sie kostka, potem wynik
            // (wiek liczony od pojawienia sie wpisu w grze, wiec dymek nie losuje drugi raz)
            const rolling = now - Number(node.dataset.born || 0) < TRY_ROLL_MS;
            if (!rolling && node.classList.contains('is-rolling')) {
                node.classList.remove('is-rolling');
                node.classList.add('is-revealed');
            }
            shown = short + (rolling ? '  🎲' : entry.success ? '  ✓ Udane' : '  ✗ Nieudane');
        }
        const textNode = node.querySelector('.rp-overhead-text');
        if (textNode.textContent !== shown) textNode.textContent = shown;
        const stack = Math.max(0, Math.min(2, Number(entry.stack) || 0));
        // przesuniecie w stosie dochodzi plynnie (nowy dymek nie "przeskakuje" starszych)
        const tick = performance.now();
        const dt = Math.min(100, tick - (node._tick || tick));
        node._tick = tick;
        const current = typeof node._stack === 'number' ? node._stack : stack;
        node._stack = Math.abs(stack - current) < 0.01 ? stack : current + (stack - current) * (1 - Math.exp(-dt / 70));
        // pozycja przez transform (bez przeliczania ukladu strony co klatke)
        const px = (Math.max(0, Math.min(1, entry.x)) * window.innerWidth).toFixed(1);
        const py = (Math.max(0, Math.min(1, entry.y)) * window.innerHeight).toFixed(1);
        node.style.transform = 'translate3d(' + px + 'px, ' + py + 'px, 0) translate(-50%, calc(-100% - ' + (38 + node._stack * 48).toFixed(1) + 'px)) scale(.85)';
        node.classList.toggle('rp-overhead-stacked', stack > 0);
    }
    sweepOverhead(alive, now);
}

// Dymek, ktorego na chwile zabraklo (obrot kamery, mrugniecie widocznosci),
// zostaje przez krotki czas zamiast znikac i wjezdzac od nowa.
function sweepOverhead(alive, now) {
    clearTimeout(overheadSweepTimer);
    let pending = false;
    for (const [id, node] of overheadNodes) {
        if (alive.has(id)) continue;
        if (now - Number(node.dataset.seen || 0) < OVERHEAD_GRACE) { pending = true; continue; }
        overheadNodes.delete(id);
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 260);
    }
    if (pending) overheadSweepTimer = setTimeout(() => sweepOverhead(new Set(), Date.now()), OVERHEAD_GRACE);
}
